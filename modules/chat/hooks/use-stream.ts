'use client';

import { useEffect, useRef, useState } from 'react';
import { AsyncEventQueue } from '@/lib/async-event-queue';
import type { ActiveDocument, StreamBlock, StreamEvent, StreamStatus } from '@/lib/schema/stream';
import type {
    CbStatusChangedMessage,
    ChatMessageCreatedMessage,
    ModelChangedMessage,
    ServerMessage,
    StreamEventMessage,
    StreamStartedMessage,
    StreamStatusMessage,
    SubscribeResponse,
    SubscribeResponseStreaming,
} from '@/lib/schema/ws-protocol';
import { ServerMsg } from '@/lib/schema/ws-protocol';
import { chunkText, TokenDrip } from '@/lib/token-drip';
import { useWebsocket } from '@/lib/websocket/provider';
import type { ArtifactContextValue } from '@/modules/artifacts/providers/artifact-provider';
import { getLatestArtifactContent } from '@/modules/artifacts/utils';
import type { Artifact } from '@/modules/chat/types';

// ============================================================================
// TYPES
// ============================================================================

type StreamingDoc = { artifactId: string; content: string; version: number; isPECP?: boolean };

type StreamingState = {
    blocks: StreamBlock[];
    currentTextBlockId: string | null;
    currentReasoningBlockId: string | null;
    streamingDocs: Map<string, StreamingDoc>;
};

export type ToolDocumentDecision = {
    action: 'approve' | 'reject';
    artifactKey: string;
    version: number;
};

export type UseStreamOptions = {
    /** Artifact context for document side-effects. If omitted, activeDocuments are tracked but no artifact provider calls are made. */
    artifactContext?: Pick<ArtifactContextValue, 'getArtifact' | 'getStore' | 'addArtifact' | 'updateArtifact'>;
    /** Called on WS reconnect — consumer provides refetch logic (e.g., reload messages) */
    onReconnect?: () => void;
    /** Called when stream reaches a terminal status (done, aborted, error), potentially carrying terminal data payload */
    onDone?: (
        status: StreamStatus,
        terminalEvent?: StreamEvent & { type: 'done' | 'done_ext' },
        agentMessageId?: string,
    ) => void;
    /** Called when a document stream starts */
    onDocumentStart?: () => void;
    /** Called when an artifact should be opened for preview */
    onArtifactOpen?: (artifactId: string, version: number) => void;
    /** Fetch artifact from API when not available in store (needed for edit mode) */
    fetchArtifact?: (artifactKey: string, version: number) => Promise<Artifact | null>;
    /** Revalidate artifact from API after changes */
    revalidateArtifact?: (keyId: string, version: number) => void;
    /** Called when stream_started fires with the new agentMessageId and userMessageId */
    onStreamStarted?: (
        agentMessageId: string,
        userMessageId: string,
        tempId?: string,
        streamType?: 'chat' | 'summary',
    ) => void;
    /** Called when a terminal tool completes (e.g. generate_summary) via done event */
    onTerminalTool?: (toolName: string) => void;
    /** Called when a new chat message is created and broadcast */
    onMessageCreated?: (message: unknown, tempId?: string) => void;
    /** Called once when the initial subscribe_response arrives — useful for clearing stale generating state */
    onSubscribeResponse?: (
        status: 'idle' | 'streaming' | 'stale',
        selectedModel: string | null,
        completionBriefStatus: string | null,
    ) => void;
    /** Called when approve_document/reject_document tool completes during stream (for project flow redirect) */
    onToolDocumentDecision?: (decision: ToolDocumentDecision) => Promise<void>;
    /** Called when the chat's selected model is changed (via WS broadcast) */
    onModelChanged?: (model: string) => void;
    /** Called when the Completion Brief status changes (via UG broadcast) */
    onCbStatusChanged?: (status: string) => void;
};

export type UseStreamReturn = {
    blocks: StreamBlock[];
    activeDocuments: ActiveDocument[];
    status: StreamStatus | 'idle';
    displayStatus: string | null;
    agentMessageId: string | null;
    /** Set when a summary stream is active (streamType: 'summary' on stream_started or subscribe_response snapshot) */
    streamType: 'chat' | 'summary' | null;
    error: string | null;
    /** True when a safety_retract event was received — message content has been wiped */
    isRetracted: boolean;
    abort: () => void;
    sendAction: (type: string, payload?: unknown) => void;
};

// ============================================================================
// HELPERS
// ============================================================================

function resolveParentVersion(ac: Pick<ArtifactContextValue, 'getStore'>, parentId: string) {
    const versions = ac.getStore()[parentId];
    if (!versions) return null;
    const keys = Object.keys(versions);
    if (!keys.length) return null;
    const maxKey = keys.reduce((a, b) => (Number(b) > Number(a) ? b : a));
    return (Number(maxKey) || maxKey) as number | 'latest';
}

function createStreamingState(): StreamingState {
    return {
        blocks: [],
        currentTextBlockId: null,
        currentReasoningBlockId: null,
        streamingDocs: new Map(),
    };
}

function initFromSnapshot(snapshot: SubscribeResponseStreaming['snapshot']): StreamingState {
    const state = createStreamingState();
    state.blocks = snapshot.blocks;

    // Infer tracking IDs from existing blocks
    const lastText = [...snapshot.blocks].reverse().find((b) => b.type === 'text');
    if (lastText) state.currentTextBlockId = lastText.id;
    const lastReasoning = [...snapshot.blocks].reverse().find((b) => b.type === 'reasoning');
    if (lastReasoning) state.currentReasoningBlockId = lastReasoning.id;

    // Populate streamingDocs from activeDocuments
    for (const doc of snapshot.activeDocuments) {
        state.streamingDocs.set(doc.name, {
            artifactId: doc.name,
            content: doc.content,
            version: doc.pendingVersion,
        });
    }

    return state;
}

// ============================================================================
// HOOK
// ============================================================================

export function useStream(domain: string, id: string | null, opts: UseStreamOptions = {}): UseStreamReturn {
    const ws = useWebsocket();

    // Stable ref to latest opts (avoids stale closures in event handlers)
    const optsRef = useRef(opts);
    optsRef.current = opts;

    // Stream state
    const [blocks, setBlocks] = useState<StreamBlock[]>([]);
    const [activeDocuments, setActiveDocuments] = useState<ActiveDocument[]>([]);
    const [status, setStatus] = useState<StreamStatus | 'idle'>('idle');
    const [displayStatus, setDisplayStatus] = useState<string | null>(null);
    const [agentMessageId, setAgentMessageId] = useState<string | null>(null);
    const [streamType, setStreamType] = useState<'chat' | 'summary' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isRetracted, setIsRetracted] = useState(false);
    const ownedAgentMessageIdRef = useRef<string | null>(null);

    // Mutable streaming state (mutated in place, then flushed to React state)
    const stateRef = useRef<StreamingState>(createStreamingState());
    const documentQueueRef = useRef<AsyncEventQueue<{ type: string; payload: any }> | null>(null);
    const pendingDocumentDecisionsRef = useRef<Map<string, ToolDocumentDecision>>(new Map());

    const flushDocumentDecisions = (callback: NonNullable<UseStreamOptions['onToolDocumentDecision']>) => {
        if (pendingDocumentDecisionsRef.current.size === 0) return;
        const decisions = [...pendingDocumentDecisionsRef.current.values()];
        pendingDocumentDecisionsRef.current.clear();
        for (const decision of decisions) {
            callback(decision).catch(console.error);
        }
    };

    // ---- Token drips (adaptive rAF — proportional drain + TPS tracking) ----

    // Text / reasoning drip
    type DripItem = { blockId: string; text: string; blockType: 'text' | 'reasoning' };
    const applyDrip = (item: DripItem) => {
        const s = stateRef.current;
        let idx = s.blocks.findIndex((b) => b.id === item.blockId);
        if (idx === -1) {
            s.blocks.push({ id: item.blockId, type: item.blockType, content: '' });
            idx = s.blocks.length - 1;
        }
        if (s.blocks[idx].type === item.blockType) {
            s.blocks[idx] = { ...s.blocks[idx], content: s.blocks[idx].content + item.text } as StreamBlock;
        }
    };
    const dripRef = useRef(new TokenDrip<DripItem>(applyDrip, () => setBlocks([...stateRef.current.blocks])));
    const enqueueDrip = (blockId: string, text: string, blockType: 'text' | 'reasoning') => {
        const chunks = chunkText(text);
        if (chunks.length === 1) {
            dripRef.current.enqueue({ blockId, text: chunks[0], blockType });
        } else {
            dripRef.current.enqueue(chunks.map((t) => ({ blockId, text: t, blockType })));
        }
    };

    // Document delta drip (same adaptive smoothing for artifact content)
    type DocDripItem = { name: string; content: string };
    const applyDocDrip = (item: DocDripItem) => {
        const doc = stateRef.current.streamingDocs.get(item.name);
        if (!doc) return;
        doc.content += item.content;
        const ac = optsRef.current.artifactContext;
        if (doc.isPECP) {
            ac?.updateArtifact(doc.artifactId, { pecpContent: doc.content }, doc.version);
        } else {
            ac?.updateArtifact(doc.artifactId, { proposedVersion: { content: doc.content } }, doc.version);
        }
    };
    const docDripRef = useRef(new TokenDrip<DocDripItem>(applyDocDrip, () => flushActiveDocuments()));

    // Flush mutable state to React state (rAF-coalesced for rapid deltas)
    const flushRaf = useRef(0);
    const flush = () => {
        if (!flushRaf.current) {
            flushRaf.current = requestAnimationFrame(() => {
                flushRaf.current = 0;
                setBlocks([...stateRef.current.blocks]);
            });
        }
    };

    const flushDocsRaf = useRef(0);
    const flushActiveDocuments = () => {
        if (!flushDocsRaf.current) {
            flushDocsRaf.current = requestAnimationFrame(() => {
                flushDocsRaf.current = 0;
                const docs: ActiveDocument[] = [];
                for (const [name, doc] of stateRef.current.streamingDocs) {
                    docs.push({
                        name,
                        title: name,
                        mode: 'create',
                        pendingVersion: doc.version,
                        content: doc.content,
                    });
                }
                setActiveDocuments(docs);
            });
        }
    };

    /**
     * Synchronous flush — cancels any pending rAF and pushes blocks/docs NOW.
     * MUST be called before any terminal status change (done/error/aborted) so
     * that setBlocks + setStatus land in the same React 18 batch. Without this,
     * the rAF-deferred setBlocks fires in a later frame, and the consumer sees
     * status='done' with stale (incomplete) blocks for one render cycle.
     */
    const flushSync = () => {
        dripRef.current.drain();
        docDripRef.current.drain();
        if (flushRaf.current) {
            cancelAnimationFrame(flushRaf.current);
            flushRaf.current = 0;
        }
        setBlocks([...stateRef.current.blocks]);

        if (flushDocsRaf.current) {
            cancelAnimationFrame(flushDocsRaf.current);
            flushDocsRaf.current = 0;
        }
        const docs: ActiveDocument[] = [];
        for (const [name, doc] of stateRef.current.streamingDocs) {
            docs.push({
                name,
                title: name,
                mode: 'create',
                pendingVersion: doc.version,
                content: doc.content,
            });
        }
        setActiveDocuments(docs);
    };

    // ========================================================================
    // DOCUMENT EVENT HANDLER (async, sequential via queue)
    // ========================================================================

    const handleDocumentEvent = async (event: { type: string; payload: any }) => {
        const { type, payload } = event;
        const s = stateRef.current;
        const o = optsRef.current;
        const ac = o.artifactContext;

        switch (type) {
            case 'document_start': {
                if (payload.isPECP && payload.parentDocument && ac) {
                    const parentId = payload.parentDocument;
                    const ver = resolveParentVersion(ac, parentId);
                    if (ver != null) {
                        s.streamingDocs.set(payload.name, {
                            artifactId: parentId,
                            content: '',
                            version: ver as number,
                            isPECP: true,
                        });
                        ac.updateArtifact(parentId, { pecpContent: '', isStreaming: true }, ver);
                        o.onArtifactOpen?.(parentId, typeof ver === 'number' ? ver : 1);
                    }
                    break;
                }

                const artifactId = payload.name;
                const now = new Date().toISOString();
                o.onDocumentStart?.();

                if (payload.mode === 'create') {
                    s.streamingDocs.set(artifactId, { artifactId, content: '', version: 1 });

                    ac?.addArtifact(
                        {
                            id: artifactId,
                            key: payload.name,
                            title: payload.title,
                            version: 1,
                            proposedVersion: {
                                id: '',
                                version: 1,
                                content: '',
                                status: 'proposed',
                                documentType: payload.documentType,
                                isInternal: payload.isInternal,
                                createdAt: now,
                                updatedAt: now,
                            },
                            createdAt: now,
                            updatedAt: now,
                            isStreaming: true,
                            isUpdating: false,
                            isLoading: false,
                            progress: 0,
                        },
                        1,
                    );

                    if (!payload.isInternal) {
                        o.onArtifactOpen?.(artifactId, 1);
                    }
                } else if (payload.mode === 'edit') {
                    const loadedVersion = payload.loadedVersion ?? 1;
                    let existingArtifact = ac?.getArtifact(artifactId, loadedVersion) ?? null;

                    if (!existingArtifact && o.fetchArtifact) {
                        existingArtifact = await o.fetchArtifact(artifactId, loadedVersion);
                    }

                    const newVersion = loadedVersion + 1;
                    const loadedContent = existingArtifact ? (getLatestArtifactContent(existingArtifact) ?? '') : '';

                    s.streamingDocs.set(artifactId, { artifactId, content: loadedContent, version: newVersion });

                    ac?.addArtifact(
                        {
                            id: artifactId,
                            key: payload.name,
                            title: payload.title,
                            version: newVersion,
                            currentVersion: loadedContent
                                ? {
                                      id: '',
                                      version: loadedVersion,
                                      content: loadedContent,
                                      status: 'approved',
                                      createdAt: now,
                                      updatedAt: now,
                                  }
                                : undefined,
                            proposedVersion: {
                                id: '',
                                version: newVersion,
                                content: loadedContent,
                                status: 'proposed',
                                documentType: payload.documentType,
                                isInternal: payload.isInternal,
                                createdAt: now,
                                updatedAt: now,
                            },
                            createdAt: now,
                            updatedAt: now,
                            isStreaming: true,
                            isUpdating: true,
                            progress: 0,
                        },
                        newVersion,
                    );

                    if (!payload.isInternal) {
                        o.onArtifactOpen?.(artifactId, newVersion);
                    }
                }

                flushActiveDocuments();
                break;
            }

            case 'document_delta': {
                if (s.streamingDocs.has(payload.name)) {
                    const chunks = chunkText(payload.content);
                    if (chunks.length === 1) {
                        docDripRef.current.enqueue({ name: payload.name, content: chunks[0] });
                    } else {
                        docDripRef.current.enqueue(chunks.map((c) => ({ name: payload.name, content: c })));
                    }
                }
                break;
            }

            case 'document_edit': {
                // Flush pending drip deltas before applying edits
                docDripRef.current.drain();
                const doc = s.streamingDocs.get(payload.name);
                if (doc && payload.edits) {
                    // Forward iteration: AppliedEdit coords are post-prev-edits.
                    let lines = doc.content.split('\n');
                    for (const edit of payload.edits) {
                        const rangeStart = Math.max(0, edit.startLine - 1);
                        const rangeEnd = Math.min(lines.length, edit.endLine);
                        const replacement = edit.newContent.split('\n');
                        lines = [
                            ...lines.slice(0, rangeStart),
                            ...replacement,
                            ...lines.slice(rangeEnd),
                        ];
                    }
                    doc.content = lines.join('\n');

                    ac?.updateArtifact(
                        doc.artifactId,
                        { proposedVersion: { content: doc.content }, isUpdating: false, isStreaming: false },
                        doc.version,
                    );
                    o.revalidateArtifact?.(doc.artifactId, doc.version);
                    flushActiveDocuments();
                }
                break;
            }

            case 'document_progress': {
                const doc = s.streamingDocs.get(payload.name);
                if (doc) {
                    ac?.updateArtifact(doc.artifactId, { progress: payload.progress }, doc.version);
                }
                break;
            }

            case 'document_complete': {
                docDripRef.current.drain();
                const doc = s.streamingDocs.get(payload.name);
                if (!doc) break;

                if (doc.isPECP) {
                    ac?.updateArtifact(doc.artifactId, { isStreaming: false }, doc.version);
                    s.streamingDocs.delete(payload.name);
                    flushActiveDocuments();
                    break;
                }

                ac?.updateArtifact(
                    doc.artifactId,
                    {
                        isStreaming: false,
                        isUpdating: false,
                        progress: 100,
                        version: doc.version,
                        proposedVersion: { version: doc.version, status: 'proposed' },
                    },
                    doc.version,
                );

                s.streamingDocs.delete(payload.name);
                o.revalidateArtifact?.(doc.artifactId, doc.version);
                flushActiveDocuments();
                break;
            }
            default:
                // TODO log?
                break;
        }
    };

    // ========================================================================
    // MAIN SUBSCRIPTION EFFECT
    // ========================================================================

    useEffect(() => {
        if (!id) return;

        const topic = `${domain}:${id}`;

        // Reset all state for new topic
        stateRef.current = createStreamingState();
        dripRef.current.dispose();
        docDripRef.current.dispose();
        documentQueueRef.current = new AsyncEventQueue(handleDocumentEvent);
        setBlocks([]);
        setActiveDocuments([]);
        setStatus('idle');
        setDisplayStatus(null);
        setAgentMessageId(null);
        setStreamType(null);
        setError(null);
        setIsRetracted(false);
        ownedAgentMessageIdRef.current = null;

        // Subscribe (ref-counted in WS client)
        const unsub = ws.subscribe(topic);

        // Track initial connection for reconnect detection
        let isFirstConnect = !ws.connected;

        // ----- message handler -----
        const onMessage = (msg: ServerMessage & { rid?: string }) => {
            if (!('topic' in msg) || (msg as any).topic !== topic) return;

            const s = stateRef.current;
            const o = optsRef.current;

            switch (msg.type) {
                // ==============================================================
                // SUBSCRIBE RESPONSE
                // ==============================================================
                case ServerMsg.SubscribeResponse: {
                    const resp = msg as SubscribeResponse;
                    if (resp.status === 'streaming') {
                        const sr = resp as SubscribeResponseStreaming;
                        const ownedAgentMessageId = ownedAgentMessageIdRef.current;

                        if (sr.snapshot.status !== 'streaming' && sr.snapshot.status !== 'pending_approval') {
                            ownedAgentMessageIdRef.current = null;
                            setStatus('idle');
                            setAgentMessageId(null);
                            setStreamType(null);
                            setDisplayStatus(null);
                            o.onSubscribeResponse?.(
                                'idle',
                                resp.selectedModel ?? null,
                                resp.completionBriefStatus ?? null,
                            );
                            break;
                        }

                        if (ownedAgentMessageId && sr.agentMessageId !== ownedAgentMessageId) {
                            o.onSubscribeResponse?.(
                                'streaming',
                                resp.selectedModel ?? null,
                                resp.completionBriefStatus ?? null,
                            );
                            break;
                        }

                        ownedAgentMessageIdRef.current = sr.agentMessageId;
                        stateRef.current = initFromSnapshot(sr.snapshot);
                        setBlocks([...sr.snapshot.blocks]);
                        setActiveDocuments(sr.snapshot.activeDocuments);
                        setStatus(sr.snapshot.status);
                        setAgentMessageId(sr.agentMessageId);
                        setStreamType(sr.streamType ?? null);
                        setDisplayStatus(sr.snapshot.displayStatus ?? null);

                        // Initialize artifact state from snapshot activeDocuments
                        if (o.artifactContext && sr.snapshot.activeDocuments.length > 0) {
                            const now = new Date().toISOString();
                            for (const doc of sr.snapshot.activeDocuments) {
                                o.artifactContext.addArtifact(
                                    {
                                        id: doc.name,
                                        key: doc.name,
                                        title: doc.title,
                                        version: doc.pendingVersion,
                                        proposedVersion: {
                                            id: '',
                                            version: doc.pendingVersion,
                                            content: doc.content,
                                            status: 'proposed',
                                            documentType: doc.documentType,
                                            isInternal: doc.isInternal,
                                            createdAt: now,
                                            updatedAt: now,
                                        },
                                        ...(doc.loadedVersion && doc.mode === 'edit'
                                            ? {
                                                  currentVersion: {
                                                      id: '',
                                                      version: doc.loadedVersion,
                                                      content: '',
                                                      status: 'approved',
                                                      createdAt: now,
                                                      updatedAt: now,
                                                  },
                                              }
                                            : {}),
                                        createdAt: now,
                                        updatedAt: now,
                                        isStreaming: true,
                                        isUpdating: doc.mode === 'edit',
                                        isLoading: false,
                                        progress: doc.progress ?? 0,
                                    },
                                    doc.pendingVersion,
                                );
                            }
                        }

                        documentQueueRef.current = new AsyncEventQueue(handleDocumentEvent);
                        o.onSubscribeResponse?.(
                            'streaming',
                            resp.selectedModel ?? null,
                            resp.completionBriefStatus ?? null,
                        );
                    } else {
                        // idle or stale — no active stream
                        ownedAgentMessageIdRef.current = null;
                        setStatus('idle');
                        setAgentMessageId(null);
                        setStreamType(null);
                        setDisplayStatus(null);
                        o.onSubscribeResponse?.('idle', resp.selectedModel ?? null, resp.completionBriefStatus ?? null);
                    }
                    break;
                }

                // ==============================================================
                // MESSAGE CREATED
                // ==============================================================
                case ServerMsg.MessageCreated: {
                    const { message, tempId } = msg as ChatMessageCreatedMessage;
                    o.onMessageCreated?.(message, tempId);
                    break;
                }

                // ==============================================================
                // MODEL CHANGED
                // ==============================================================
                case ServerMsg.ModelChanged: {
                    const { model } = msg as ModelChangedMessage;
                    o.onModelChanged?.(model);
                    break;
                }

                // ==============================================================
                // COMPLETION BRIEF STATUS CHANGED
                // ==============================================================
                case ServerMsg.CbStatusChanged: {
                    const { status: cbStatus } = msg as CbStatusChangedMessage;
                    o.onCbStatusChanged?.(cbStatus);
                    break;
                }

                // ==============================================================
                // STREAM STARTED (new response within existing subscription)
                // ==============================================================
                case ServerMsg.StreamStarted: {
                    const started = msg as StreamStartedMessage;
                    ownedAgentMessageIdRef.current = started.agentMessageId;
                    stateRef.current = createStreamingState();
                    documentQueueRef.current = new AsyncEventQueue(handleDocumentEvent);
                    setBlocks([]);
                    setActiveDocuments([]);
                    setStatus('streaming');
                    setDisplayStatus(null);
                    setError(null);
                    setIsRetracted(false);
                    setAgentMessageId(started.agentMessageId);
                    setStreamType(started.streamType ?? null);
                    o.onStreamStarted?.(
                        started.agentMessageId,
                        started.userMessageId ?? '',
                        started.tempId,
                        started.streamType,
                    );
                    break;
                }

                // ==============================================================
                // STREAM EVENT (live event during streaming)
                // ==============================================================
                case ServerMsg.StreamEvent: {
                    const { event, agentMessageId: eventAgentMessageId } = msg as StreamEventMessage;
                    if (eventAgentMessageId !== ownedAgentMessageIdRef.current) {
                        break;
                    }

                    switch (event.type) {
                        // ----- Text -----
                        case 'delta': {
                            if (!event.text) break;
                            const blockIdToUse = event.blockId || s.currentTextBlockId || `text-${Date.now()}`;
                            if (s.currentTextBlockId !== blockIdToUse) {
                                s.currentTextBlockId = blockIdToUse;
                            }
                            enqueueDrip(blockIdToUse, event.text, 'text');
                            break;
                        }

                        // ----- Reasoning -----
                        case 'reasoning_start': {
                            const id = event.blockId || s.currentReasoningBlockId || `reasoning-${Date.now()}`;
                            s.currentReasoningBlockId = id;
                            if (s.blocks.findIndex((b) => b.id === id) === -1) {
                                s.blocks.push({ id, type: 'reasoning', content: '' });
                            }
                            flush();
                            break;
                        }
                        case 'reasoning_delta': {
                            const text = event.text || event.content;
                            if (!text) break;
                            const blockIdToUse =
                                event.blockId || s.currentReasoningBlockId || `reasoning-${Date.now()}`;
                            if (s.currentReasoningBlockId !== blockIdToUse) {
                                s.currentReasoningBlockId = blockIdToUse;
                            }
                            enqueueDrip(blockIdToUse, text, 'reasoning');
                            break;
                        }
                        case 'reasoning_done': {
                            const blockIdToUse = event.blockId || s.currentReasoningBlockId;
                            if (blockIdToUse && event.durationMs !== undefined) {
                                const idx = s.blocks.findIndex((b) => b.id === blockIdToUse);
                                if (idx !== -1 && s.blocks[idx].type === 'reasoning') {
                                    s.blocks[idx] = { ...s.blocks[idx], durationMs: event.durationMs } as StreamBlock;
                                    flush();
                                }
                            }
                            s.currentReasoningBlockId = null;
                            break;
                        }

                        // ----- Tool calls -----
                        case 'tool_start': {
                            s.blocks.push({
                                id: event.id || `tool-${Date.now()}`,
                                type: 'tool_call',
                                content: '',
                                toolName: event.tool,
                                toolInput: {},
                                toolCallId: event.id,
                            });
                            flush();
                            break;
                        }
                        case 'tool_result': {
                            const idx = s.blocks.findIndex((b) => b.type === 'tool_call' && b.toolCallId === event.id);
                            if (idx !== -1 && s.blocks[idx].type === 'tool_call') {
                                const result =
                                    typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
                                s.blocks[idx] = {
                                    ...s.blocks[idx],
                                    content: result,
                                    toolOutput: result,
                                    toolSuccess: event.success,
                                } as StreamBlock;
                                flush();
                            }

                            // Handle approve_document / reject_document tool results
                            if (event.success === true) {
                                try {
                                    const parsed =
                                        typeof event.result === 'string' ? JSON.parse(event.result) : event.result;
                                    if (parsed?.name && parsed?.version) {
                                        o.revalidateArtifact?.(parsed.name, parsed.version);

                                        // Queue document decision for flush on stream done
                                        const matchedBlock = idx !== -1 ? s.blocks[idx] : undefined;
                                        const toolName =
                                            matchedBlock?.type === 'tool_call' ? matchedBlock.toolName : undefined;
                                        if (toolName === 'approve_document' || toolName === 'reject_document') {
                                            pendingDocumentDecisionsRef.current.set(event.id, {
                                                action: toolName === 'approve_document' ? 'approve' : 'reject',
                                                artifactKey: parsed.name,
                                                version: parsed.version,
                                            });
                                        }
                                    }
                                } catch {
                                    // ignore parse errors
                                }
                            }
                            break;
                        }

                        // ----- Search & citations -----
                        case 'search_start': {
                            s.blocks.push({
                                id: event.blockId || `search-${Date.now()}`,
                                type: 'search',
                                content: event.query,
                                searchQuery: event.query,
                            });
                            flush();
                            break;
                        }
                        case 'search_results': {
                            const idx = s.blocks.findIndex((b) => b.id === event.blockId && b.type === 'search');
                            if (idx !== -1 && s.blocks[idx].type === 'search') {
                                s.blocks[idx] = {
                                    ...s.blocks[idx],
                                    resultCount: event.resultCount,
                                    isComplete: true,
                                } as StreamBlock;
                                flush();
                            }
                            break;
                        }
                        case 'citation': {
                            const idx = s.blocks.findIndex(
                                (b) => b.id === event.parentTextBlockId && b.type === 'text',
                            );
                            if (idx !== -1 && s.blocks[idx].type === 'text') {
                                const textBlock = s.blocks[idx];
                                s.blocks[idx] = {
                                    ...textBlock,
                                    citations: [
                                        ...(textBlock.citations || []),
                                        {
                                            url: event.url,
                                            title: event.title,
                                            cited_text: event.citedText,
                                            start_index: event.startIndex,
                                            end_index: event.endIndex,
                                            provider: 'anthropic',
                                        },
                                    ],
                                } as StreamBlock;
                                flush();
                            }
                            break;
                        }

                        // ----- Documents (queued for async processing) -----
                        case 'document_start':
                            documentQueueRef.current?.push({ type: event.type, payload: event });
                            break;
                        case 'document_delta':
                        case 'document_edit':
                        case 'document_progress':
                        case 'document_complete':
                            documentQueueRef.current?.push({ type: event.type, payload: event });
                            break;

                        // ----- Status & terminal -----
                        case 'status_update':
                            setDisplayStatus(event.status);
                            break;

                        case 'error':
                            if (!event.soft) {
                                flushSync();
                                setError(event.error);
                            }
                            break;

                        case 'done':
                            // Synchronous flush so setBlocks + setStatus('done') land
                            // in the same React batch — prevents stale-blocks-on-done.
                            flushSync();
                            if (event.error) setError(event.error);
                            if (event.outputType === 'tool' && event.outputTool) o.onTerminalTool?.(event.outputTool);
                            setDisplayStatus(null);
                            // Don't override aborted/error — stream_status is authoritative
                            setStatus((prev) => (prev === 'aborted' || prev === 'error' ? prev : 'done'));
                            if (o.onToolDocumentDecision) flushDocumentDecisions(o.onToolDocumentDecision);
                            o.onDone?.('done', event, eventAgentMessageId);
                            break;

                        case 'done_ext':
                            o.onDone?.('done', event, eventAgentMessageId);
                            break;

                        case 'safety_retract':
                            // Safety leak detected — wipe streamed text and flag as retracted.
                            // Keep streamingDocs intact so the abort cleanup effect can
                            // remove transient artifacts and close the side panel.
                            stateRef.current.blocks = [];
                            dripRef.current.dispose();
                            docDripRef.current.dispose();
                            flushSync();
                            setIsRetracted(true);
                            break;

                        case 'created':
                            // No-op — handled by WS protocol (stream_started, POST response)
                            break;
                        default:
                            // TODO log?
                            break;
                    }
                    break;
                }

                // ==============================================================
                // STREAM STATUS (lifecycle transition)
                // ==============================================================
                case ServerMsg.StreamStatus: {
                    const sm = msg as StreamStatusMessage;
                    if (sm.agentMessageId !== ownedAgentMessageIdRef.current) {
                        break;
                    }
                    const isTerminal = sm.status === 'done' || sm.status === 'aborted' || sm.status === 'error';
                    if (isTerminal) flushSync();

                    setStatus(sm.status);
                    setAgentMessageId(sm.agentMessageId);

                    if (isTerminal) {
                        ownedAgentMessageIdRef.current = null;
                        setDisplayStatus(null);
                        o.onDone?.(sm.status, undefined, sm.agentMessageId);
                    }
                    break;
                }
                default:
                    // TODO log?
                    break;
            }
        };

        // ----- reconnection handler -----
        const onConnected = () => {
            if (isFirstConnect) {
                isFirstConnect = false;
                return;
            }
            optsRef.current.onReconnect?.();
        };

        ws.on('message', onMessage);
        ws.on('connected', onConnected);

        return () => {
            ws.off('message', onMessage);
            ws.off('connected', onConnected);
            unsub();
            dripRef.current.dispose();
            docDripRef.current.dispose();
            if (flushRaf.current) cancelAnimationFrame(flushRaf.current);
            if (flushDocsRaf.current) cancelAnimationFrame(flushDocsRaf.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- optsRef handles opts freshness, handleDocumentEvent is stable via ref
    }, [ws, domain, id]);

    // ========================================================================
    // ACTIONS
    // ========================================================================

    const abort = () => {
        if (!id) return;
        ws.sendAction(`${domain}:${id}`, 'abort');
    };

    const sendAction = (type: string, payload?: unknown) => {
        if (!id) return;
        ws.sendAction(`${domain}:${id}`, type, payload);
    };

    return {
        blocks,
        activeDocuments,
        status,
        displayStatus,
        agentMessageId,
        streamType,
        error,
        isRetracted,
        abort,
        sendAction,
    };
}
