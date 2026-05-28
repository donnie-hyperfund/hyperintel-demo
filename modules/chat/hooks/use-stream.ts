'use client';

import { useEffect, useRef, useState } from 'react';
import { capturePostHogEvent } from '@/lib/analytics/posthog-browser';
import { AsyncEventQueue } from '@/lib/async-event-queue';
import { IS_PROD } from '@/lib/config';
import type { ActiveDocument, PendingDecision, StreamBlock, StreamEvent, StreamStatus } from '@/lib/schema/stream';
import { DECISION_DISMISSED_SENTINEL } from '@/lib/schema/stream';
import type {
    CbStatusChangedMessage,
    ChatMessageCreatedMessage,
    ModelChangedMessage,
    ServerMessage,
    StreamStartedMessage,
    SubscribeResponse,
    SubscribeResponseStreaming,
    TopicMessage,
} from '@/lib/schema/ws-protocol';
import { ClientAction, ServerMsg } from '@/lib/schema/ws-protocol';
import { chunkText, TokenDrip } from '@/lib/token-drip';
import { useWebsocket } from '@/lib/websocket/provider';
import type { ApprovalAction } from '@/modules/artifacts/processing/types';
import type { ArtifactUpdate, VersionKey } from '@/modules/artifacts/providers/artifact-provider';
import { useArtifactStreamMonitor } from '@/modules/artifacts/streaming/artifact-stream-monitor-provider';
import { getPreviousArtifactVersion } from '@/modules/artifacts/streaming/versions';
import { getLatestArtifactVersionContent, getLatestArtifactVersionTitle } from '@/modules/artifacts/utils';
import type { Artifact } from '@/modules/chat/types';

// ============================================================================
// TYPES
// ============================================================================

type StreamingDoc = {
    artifactKey: string;
    artifactId: string;
    content: string;
    version: number;
    title?: string;
    mode?: ActiveDocument['mode'];
    loadedVersion?: number;
    documentType?: ActiveDocument['documentType'];
    isInternal?: boolean;
    sourceVersion?: number;
    progress?: number;
};

type StreamingSummary = {
    /** Parent artifact key (== document name). */
    artifactKey: string;
    /** Persisted ArtifactEntity id. */
    artifactId: string;
    /** Parent version number — used to look up the right entry in the artifact store. */
    version: number;
    content: string;
};

type SubscribeGapDiagnostics = {
    buffered: number;
    droppedSeqDuplicates: number;
    droppedSnapshotDuplicates: number;
    seqRegressions: number;
    skippedSnapshotStreamStarted: number;
};

type StreamingState = {
    blocks: StreamBlock[];
    currentTextBlockId: string | null;
    currentReasoningBlockId: string | null;
    streamingDocs: Map<string, StreamingDoc>;
    /** Map keyed by versionId → phase-transition stream state. */
    streamingSummaries: Map<string, StreamingSummary>;
};

type ScopedArtifactActions = {
    getArtifact: (id: string, version?: VersionKey) => Artifact | null;
    getStore: () => Record<string, Record<string, Artifact>>;
    addArtifact: (artifact: Artifact, version?: VersionKey) => void;
    updateArtifact: (id: string, updates: ArtifactUpdate, version?: VersionKey, options?: { merge?: boolean }) => void;
};

type StreamSessionAnalytics = {
    agentMessageId: string;
    startedAt: number;
    eventCount: number;
    streamType: 'chat' | 'phase_transition' | null;
};

export type ToolDocumentDecision = {
    action: ApprovalAction;
    artifactKey: string;
    version: number;
};

export type UseStreamOptions = {
    /** Artifact context for document side-effects. If omitted, activeDocuments are tracked but no artifact provider calls are made. */
    artifactContext?: ScopedArtifactActions;
    /** Called on WS reconnect — consumer provides refetch logic (e.g., reload messages) */
    onReconnect?: () => void;
    /** Called when stream reaches a terminal status (done, aborted, error), potentially carrying terminal data payload */
    onDone?: (
        status: StreamStatus,
        terminalEvent?: StreamEvent & { type: 'done' | 'done_ext' },
        agentMessageId?: string,
    ) => void;
    /** Called when a document stream starts */
    onDocumentStart?: (info: { artifactKey: string; artifactName: string; version: number }) => void;
    /** Called when a document stream completes (success or abort) */
    onDocumentComplete?: (artifactId: string) => void;
    /** Location metadata stamped on background streams for the status bar */
    streamLocation?: {
        chatType?: 'phase' | 'company' | 'stakeholder';
        projectId?: string;
        projectName?: string | null;
        phaseName?: string | null;
        phaseIndex?: number | null;
    };
    /** Called when an artifact should be opened for preview */
    onArtifactOpen?: (target: { artifactId: string; artifactKey: string; version: number }) => void;
    /** Fetch artifact from API when not available in store (needed for edit mode) */
    fetchArtifact?: (artifactKey: string, version: number) => Promise<Artifact | null>;
    /** Revalidate artifact from API after changes */
    revalidateArtifact?: (target: { artifactId?: string; artifactKey: string; version: number }) => void;
    /** Called when stream_started fires with the new agentMessageId and userMessageId */
    onStreamStarted?: (
        agentMessageId: string,
        userMessageId: string,
        tempId?: string,
        streamType?: 'chat' | 'phase_transition',
    ) => void;
    /** Called when a terminal tool completes (e.g. start_phase_transition) via done event */
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

/** What the user submitted for a pending decision — kept around until the backend confirms via `decision_resolved`. */
export type DecisionSubmission = { value: string; freeText?: string };

export type UseStreamReturn = {
    blocks: StreamBlock[];
    activeDocuments: ActiveDocument[];
    /** User-decision prompts currently awaiting the user's click. */
    pendingDecisions: PendingDecision[];
    /** Submissions in flight — keyed by toolCallId. Cleared on `decision_resolved` or terminal status. */
    submittingDecisions: Record<string, DecisionSubmission>;
    status: StreamStatus | 'idle';
    displayStatus: string | null;
    agentMessageId: string | null;
    /** Set when a phase-transition stream is active. */
    streamType: 'chat' | 'phase_transition' | null;
    error: string | null;
    /** True when a safety_retract event was received — message content has been wiped */
    isRetracted: boolean;
    abort: () => void;
    sendAction: (type: string, payload?: unknown) => void;
    /**
     * Resolve a pending decision card. Pass `freeText` when the user typed a
     * custom "Other" answer (in that case `value` should be the Other sentinel).
     */
    selectDecision: (toolCallId: string, value: string, freeText?: string) => void;
    /** Dismiss a pending decision without picking — agent gets the cancelled path. */
    dismissDecision: (toolCallId: string) => void;
};

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Live `_seq` more than this far below `lastAppliedSeq` is treated as a server-side
 * sequence reset (e.g. `broadcastSeq` reloaded from a stale-low persisted value after
 * a DO crash between persist windows). A regression of more than one step never
 * happens in healthy delivery, so the tolerance stays at 1.
 *
 * Only consulted by `shouldApplySeq` on live messages — the subscribe buffer flush
 * does its own explicit `_seq <= seqHigh` drop so snapshot-covered duplicates never
 * reach this path.
 */
const SEQ_REGRESSION_TOLERANCE = 1;
const ENABLE_SUBSCRIBE_GAP_DIAGNOSTICS = !IS_PROD;

// ============================================================================
// HELPERS
// ============================================================================

function extractMsgSeq(msg: { type?: string; _seq?: unknown }): number | undefined {
    if (msg.type !== ServerMsg.StreamEvent && msg.type !== ServerMsg.StreamStatus) return undefined;
    return typeof msg._seq === 'number' ? msg._seq : undefined;
}

function createSubscribeGapDiagnostics(): SubscribeGapDiagnostics {
    return {
        buffered: 0,
        droppedSeqDuplicates: 0,
        droppedSnapshotDuplicates: 0,
        seqRegressions: 0,
        skippedSnapshotStreamStarted: 0,
    };
}

function isTopicMessage(msg: ServerMessage & { rid?: string }): msg is TopicMessage & { rid?: string } {
    return 'topic' in msg;
}

function createStreamingState(): StreamingState {
    return {
        blocks: [],
        currentTextBlockId: null,
        currentReasoningBlockId: null,
        streamingDocs: new Map(),
        streamingSummaries: new Map(),
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

    // Populate streamingDocs / streamingSummaries from activeDocuments
    for (const doc of snapshot.activeDocuments) {
        const artifactKey = doc.name;
        state.streamingDocs.set(doc.artifactId, {
            artifactKey,
            artifactId: doc.artifactId,
            content: doc.content,
            version: doc.pendingVersion,
            title: doc.title,
            mode: doc.mode,
            loadedVersion: doc.loadedVersion,
            documentType: doc.documentType,
            isInternal: doc.isInternal,
            sourceVersion: doc.loadedVersion,
            progress: doc.progress,
        });
        if (doc.summaryVersionId && doc.summaryInternal !== undefined) {
            state.streamingSummaries.set(doc.summaryVersionId, {
                artifactKey,
                artifactId: doc.artifactId,
                version: doc.pendingVersion,
                content: doc.summaryInternal,
            });
        }
    }

    return state;
}

// ============================================================================
// HOOK
// ============================================================================

export function useStream(domain: string, id: string | null, opts: UseStreamOptions = {}): UseStreamReturn {
    const ws = useWebsocket();
    const streamMonitor = useArtifactStreamMonitor();

    // Stable ref to latest opts (avoids stale closures in event handlers)
    const optsRef = useRef(opts);
    optsRef.current = opts;

    // Stream state
    const [blocks, setBlocks] = useState<StreamBlock[]>([]);
    const [activeDocuments, setActiveDocuments] = useState<ActiveDocument[]>([]);
    const [pendingDecisions, setPendingDecisions] = useState<PendingDecision[]>([]);
    const [submittingDecisions, setSubmittingDecisions] = useState<Record<string, DecisionSubmission>>({});
    const [status, setStatus] = useState<StreamStatus | 'idle'>('idle');
    const [displayStatus, setDisplayStatus] = useState<string | null>(null);
    const [agentMessageId, setAgentMessageId] = useState<string | null>(null);
    const [streamType, setStreamType] = useState<'chat' | 'phase_transition' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isRetracted, setIsRetracted] = useState(false);
    const ownedAgentMessageIdRef = useRef<string | null>(null);

    // Mutable streaming state (mutated in place, then flushed to React state)
    const stateRef = useRef<StreamingState>(createStreamingState());
    const documentQueueRef = useRef<AsyncEventQueue<{ type: string; payload: any }> | null>(null);
    const pendingDocumentDecisionsRef = useRef<Map<string, ToolDocumentDecision>>(new Map());
    const streamTerminalRef = useRef(false);
    const subscribeStartedAtRef = useRef<number | null>(null);
    const streamSessionRef = useRef<StreamSessionAnalytics | null>(null);

    // Subscribe buffer state — buffers live events while SubscribeResponse is pending
    const subscribePendingRef = useRef(false);
    const preSnapshotBufferRef = useRef<(ServerMessage & { rid?: string })[]>([]);
    const isFlushingSubscribeBufferRef = useRef(false);
    const lastAppliedSeqRef = useRef(new Map<string, number>());
    const subscribeGapDiagnosticsRef = useRef(createSubscribeGapDiagnostics());

    const captureSubscribeDiagnostic = (
        event: string,
        properties: Record<string, string | number | boolean | null | undefined>,
    ) => {
        if (!ENABLE_SUBSCRIBE_GAP_DIAGNOSTICS) return;
        capturePostHogEvent(event, {
            domain,
            topic_id: id,
            ...properties,
        });
    };

    const shouldApplySeq = (agentMessageId: string, seq: number | undefined): boolean => {
        if (seq === undefined) return true;
        const lastSeq = lastAppliedSeqRef.current.get(agentMessageId);
        if (lastSeq !== undefined) {
            if (seq < lastSeq - SEQ_REGRESSION_TOLERANCE) {
                // Server-side seq reset (DO crash between persist windows reloaded a
                // stale-low broadcastSeq). Treat as a fresh sequence space for this id.
                subscribeGapDiagnosticsRef.current.seqRegressions += 1;
                if (ENABLE_SUBSCRIBE_GAP_DIAGNOSTICS) {
                    console.debug(
                        `[use-stream] seq regression for ${agentMessageId}: _seq=${seq}, lastApplied=${lastSeq}. Resetting.`,
                    );
                    captureSubscribeDiagnostic('stream_seq_regression', {
                        agent_message_id: agentMessageId,
                        seq,
                        last_seq: lastSeq,
                        tolerance: SEQ_REGRESSION_TOLERANCE,
                    });
                }
                lastAppliedSeqRef.current.delete(agentMessageId);
            } else if (seq <= lastSeq) {
                subscribeGapDiagnosticsRef.current.droppedSeqDuplicates += 1;
                if (ENABLE_SUBSCRIBE_GAP_DIAGNOSTICS) {
                    console.debug('[use-stream] dropped duplicate stream message', {
                        agentMessageId,
                        seq,
                        lastSeq,
                        droppedSeqDuplicates: subscribeGapDiagnosticsRef.current.droppedSeqDuplicates,
                    });
                    captureSubscribeDiagnostic('stream_seq_duplicate_dropped', {
                        agent_message_id: agentMessageId,
                        seq,
                        last_seq: lastSeq,
                        dropped_seq_duplicates: subscribeGapDiagnosticsRef.current.droppedSeqDuplicates,
                    });
                }
                return false;
            } else if (seq > lastSeq + 1) {
                capturePostHogEvent('stream_seq_gap_detected', {
                    domain,
                    topic_id: id,
                    agent_message_id: agentMessageId,
                    last_seq: lastSeq,
                    expected_seq: lastSeq + 1,
                    seq,
                    source: isFlushingSubscribeBufferRef.current ? 'subscribe_buffer' : 'live',
                });
            }
        }
        lastAppliedSeqRef.current.set(agentMessageId, seq);
        return true;
    };

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
    type DocDripItem = { artifactId: string; content: string };
    const applyDocDrip = (item: DocDripItem) => {
        const doc = stateRef.current.streamingDocs.get(item.artifactId);
        if (!doc) return;
        doc.content += item.content;
        const ac = optsRef.current.artifactContext;
        // Drop the "waiting" state once deltas actually appear — content is now visibly streaming.
        ac?.updateArtifact(
            doc.artifactId,
            { proposedVersion: { content: doc.content }, isUpdating: false },
            doc.version,
        );
    };
    const docDripRef = useRef(new TokenDrip<DocDripItem>(applyDocDrip, () => flushActiveDocuments()));

    // Internal-summary delta drip — same adaptive smoothing used for artifact content.
    type SummaryDripItem = { versionId: string; content: string };
    const applySummaryDrip = (item: SummaryDripItem) => {
        const summary = stateRef.current.streamingSummaries.get(item.versionId);
        if (!summary) return;
        summary.content += item.content;
        const ac = optsRef.current.artifactContext;
        ac?.updateArtifact(
            summary.artifactId,
            {
                summaryStreaming: summary.content,
                isSummaryStreaming: true,
                proposedVersion: { summaryInternal: summary.content },
            },
            summary.version,
        );
    };
    const summaryDripRef = useRef(new TokenDrip<SummaryDripItem>(applySummaryDrip, () => flushActiveDocuments()));

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
                for (const doc of stateRef.current.streamingDocs.values()) {
                    docs.push({
                        artifactId: doc.artifactId,
                        name: doc.artifactKey,
                        title: doc.title ?? doc.artifactKey,
                        mode: doc.mode ?? 'create',
                        pendingVersion: doc.version,
                        loadedVersion: doc.loadedVersion,
                        content: doc.content,
                        documentType: doc.documentType,
                        isInternal: doc.isInternal,
                        progress: doc.progress,
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
        summaryDripRef.current.drain();
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
        for (const doc of stateRef.current.streamingDocs.values()) {
            docs.push({
                artifactId: doc.artifactId,
                name: doc.artifactKey,
                title: doc.title ?? doc.artifactKey,
                mode: doc.mode ?? 'create',
                pendingVersion: doc.version,
                loadedVersion: doc.loadedVersion,
                content: doc.content,
                documentType: doc.documentType,
                isInternal: doc.isInternal,
                progress: doc.progress,
            });
        }
        setActiveDocuments(docs);
    };

    const clearStreamingFlags = () => {
        const ac = optsRef.current.artifactContext;
        if (!ac) {
            stateRef.current.streamingSummaries.clear();
            return;
        }

        for (const summary of stateRef.current.streamingSummaries.values()) {
            ac.updateArtifact(summary.artifactId, { isStreaming: false, isSummaryStreaming: false }, summary.version);
        }
        stateRef.current.streamingSummaries.clear();
    };

    const startStreamSessionAnalytics = (
        nextAgentMessageId: string,
        nextStreamType: 'chat' | 'phase_transition' | null,
    ) => {
        const current = streamSessionRef.current;
        if (current?.agentMessageId === nextAgentMessageId) return;
        streamSessionRef.current = {
            agentMessageId: nextAgentMessageId,
            startedAt: performance.now(),
            eventCount: 0,
            streamType: nextStreamType,
        };
    };

    const captureSubscribeCompleted = (
        responseStatus: SubscribeResponse['status'],
        responseAgentMessageId?: string,
        responseStreamType?: 'chat' | 'phase_transition' | null,
    ) => {
        const startedAt = subscribeStartedAtRef.current;
        if (startedAt === null) return;
        subscribeStartedAtRef.current = null;
        capturePostHogEvent('subscribe_completed', {
            domain,
            topic_id: id,
            status: responseStatus,
            agent_message_id: responseAgentMessageId,
            stream_type: responseStreamType,
            subscribe_latency_ms: performance.now() - startedAt,
        });
    };

    const captureStreamSessionEnded = (finalStatus: StreamStatus, finalAgentMessageId?: string) => {
        const session = streamSessionRef.current;
        if (!session) return;
        streamSessionRef.current = null;
        capturePostHogEvent('stream_session_ended', {
            domain,
            topic_id: id,
            agent_message_id: finalAgentMessageId ?? session.agentMessageId,
            stream_type: session.streamType,
            status: finalStatus,
            duration_ms: performance.now() - session.startedAt,
            event_count: session.eventCount,
            duplicates_dropped: 0,
        });
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
                const artifactKey = payload.name;
                const artifactId = payload.artifactId;
                if (!artifactId) break;
                const now = new Date().toISOString();
                const startVersion =
                    payload.pendingVersion ??
                    (payload.mode === 'create' ? 1 : (payload.nextVersion ?? (payload.loadedVersion ?? 1) + 1));
                const previousVersion = getPreviousArtifactVersion(startVersion);
                o.onDocumentStart?.({ artifactKey, artifactName: payload.title, version: startVersion });
                if (id && o.streamLocation) {
                    streamMonitor.register({
                        chatId: id,
                        location: { domain: domain as 'chat' | 'intake', ...o.streamLocation },
                        artifactId,
                        artifactKey,
                        artifactName: payload.title,
                        version: startVersion,
                        ...(payload.isInternal !== undefined ? { isInternal: payload.isInternal } : {}),
                        ...(payload.mode ? { mode: payload.mode } : {}),
                        ...(payload.loadedVersion !== undefined ? { loadedVersion: payload.loadedVersion } : {}),
                        ...(previousVersion !== undefined ? { previousVersion } : {}),
                        source: 'local',
                    });
                }

                if (payload.mode === 'create') {
                    s.streamingDocs.set(artifactId, {
                        artifactKey,
                        artifactId,
                        content: '',
                        version: startVersion,
                        title: payload.title,
                        mode: 'create',
                        documentType: payload.documentType,
                        isInternal: payload.isInternal,
                    });

                    ac?.addArtifact(
                        {
                            id: artifactId,
                            key: payload.name,
                            version: startVersion,
                            proposedVersion: {
                                id: '',
                                version: startVersion,
                                title: payload.title,
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
                            sourceChatId: id ?? undefined,
                        },
                        startVersion,
                    );

                    if (!payload.isInternal) {
                        o.onArtifactOpen?.({ artifactId, artifactKey, version: startVersion });
                    }
                } else if (payload.mode === 'edit' || payload.mode === 'replace') {
                    const isInternal = !!payload.isInternal;
                    const loadedVersion = payload.loadedVersion ?? 1;
                    let existingArtifact = ac?.getArtifact(artifactId, loadedVersion) ?? null;

                    if (!existingArtifact && o.fetchArtifact) {
                        existingArtifact = await o.fetchArtifact(artifactKey, loadedVersion);
                    }

                    const newVersion = startVersion;
                    const previousVersionForUpdate = getPreviousArtifactVersion(newVersion);
                    const loadedContent =
                        !isInternal && existingArtifact
                            ? (getLatestArtifactVersionContent(existingArtifact) ?? '')
                            : '';
                    const existingTitle = existingArtifact ? getLatestArtifactVersionTitle(existingArtifact) : '';
                    const draftContent = payload.mode === 'replace' ? '' : loadedContent;

                    s.streamingDocs.set(artifactId, {
                        artifactKey,
                        artifactId,
                        content: draftContent,
                        version: newVersion,
                        title: payload.title,
                        mode: payload.mode,
                        loadedVersion,
                        documentType: payload.documentType,
                        isInternal,
                    });

                    if (isInternal && previousVersionForUpdate !== undefined) {
                        if (!ac?.getArtifact(artifactId, previousVersionForUpdate) && o.fetchArtifact) {
                            await o.fetchArtifact(artifactKey, previousVersionForUpdate);
                        }
                        ac?.updateArtifact(artifactId, { isUpdating: true }, previousVersionForUpdate);
                    }

                    ac?.addArtifact(
                        {
                            id: artifactId,
                            key: payload.name,
                            version: newVersion,
                            currentVersion: loadedContent
                                ? {
                                      id: '',
                                      version: loadedVersion,
                                      title: existingTitle,
                                      content: loadedContent,
                                      status: 'approved',
                                      createdAt: now,
                                      updatedAt: now,
                                  }
                                : undefined,
                            proposedVersion: {
                                id: '',
                                version: newVersion,
                                title: payload.title,
                                content: draftContent,
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
                            sourceChatId: id ?? undefined,
                        },
                        newVersion,
                    );

                    if (!payload.isInternal) {
                        o.onArtifactOpen?.({ artifactId, artifactKey, version: newVersion });
                    }
                }

                flushActiveDocuments();
                break;
            }

            case 'document_delta': {
                if (payload.artifactId && s.streamingDocs.has(payload.artifactId)) {
                    const chunks = chunkText(payload.content);
                    if (chunks.length === 1) {
                        docDripRef.current.enqueue({ artifactId: payload.artifactId, content: chunks[0] });
                    } else {
                        docDripRef.current.enqueue(
                            chunks.map((contentChunk) => ({ artifactId: payload.artifactId, content: contentChunk })),
                        );
                    }
                }
                break;
            }

            case 'document_edit': {
                // Flush pending drip deltas before applying edits
                docDripRef.current.drain();
                const doc = payload.artifactId ? s.streamingDocs.get(payload.artifactId) : undefined;
                if (doc && payload.edits) {
                    // Applied edits are emitted in replay-safe order.
                    let lines = doc.content.split('\n');
                    for (const edit of payload.edits) {
                        const rangeStart = Math.max(0, edit.startLine - 1);
                        const rangeEnd = Math.min(lines.length, edit.endLine);
                        const replacement = edit.newContent.split('\n');
                        lines = [...lines.slice(0, rangeStart), ...replacement, ...lines.slice(rangeEnd)];
                    }
                    doc.content = lines.join('\n');

                    ac?.updateArtifact(
                        doc.artifactId,
                        { proposedVersion: { content: doc.content }, isUpdating: false, isStreaming: false },
                        doc.version,
                    );
                    o.revalidateArtifact?.({
                        artifactId: doc.artifactId,
                        artifactKey: doc.artifactKey,
                        version: doc.version,
                    });
                    flushActiveDocuments();
                }
                break;
            }

            case 'document_progress': {
                const doc = payload.artifactId ? s.streamingDocs.get(payload.artifactId) : undefined;
                if (doc) {
                    doc.progress = payload.progress;
                    ac?.updateArtifact(doc.artifactId, { progress: payload.progress }, doc.version);
                }
                break;
            }

            case 'document_complete': {
                docDripRef.current.drain();
                const doc = payload.artifactId ? s.streamingDocs.get(payload.artifactId) : undefined;
                if (!doc) break;

                if (payload.action === 'aborted' || payload.status === 'aborted') {
                    ac?.updateArtifact(
                        doc.artifactId,
                        {
                            isStreaming: false,
                            isUpdating: false,
                            progress: 0,
                        },
                        doc.version,
                    );
                    const previousVersion = getPreviousArtifactVersion(doc.version);
                    if (previousVersion !== undefined) {
                        ac?.updateArtifact(doc.artifactId, { isUpdating: false }, previousVersion);
                    }

                    s.streamingDocs.delete(doc.artifactId);
                    if (id) streamMonitor.unregister(id, doc.artifactId);
                    o.onDocumentComplete?.(doc.artifactId);
                    flushActiveDocuments();
                    break;
                }

                // For internal docs, the auto-generated summary is produced *inside*
                // finalize_document BEFORE the tool returns — so the SSE order on the
                // wire is: summary_start, summary_delta..., summary_complete, then this
                // document_complete event. By now phase-transition state has already been
                // settled by summary_complete (or never started for non-internal docs).
                // Don't touch summaryStreaming / isSummaryStreaming here, and only
                // clear isStreaming once everything has actually finished.
                const completionUpdates: ArtifactUpdate = {
                    isStreaming: false,
                    isUpdating: false,
                    progress: 100,
                    version: doc.version,
                    proposedVersion: {
                        version: doc.version,
                        status: payload.status ?? 'proposed',
                    },
                };

                ac?.updateArtifact(doc.artifactId, completionUpdates, doc.version);

                const previousVersion = getPreviousArtifactVersion(doc.version);
                if (previousVersion !== undefined) {
                    ac?.updateArtifact(doc.artifactId, { isUpdating: false }, previousVersion);
                }

                s.streamingDocs.delete(doc.artifactId);
                if (id) streamMonitor.unregister(id, doc.artifactId);
                o.onDocumentComplete?.(doc.artifactId);
                o.revalidateArtifact?.({
                    artifactId: doc.artifactId,
                    artifactKey: doc.artifactKey,
                    version: doc.version,
                });
                flushActiveDocuments();
                break;
            }

            case 'summary_start': {
                if (!payload.versionId || !payload.artifactId || !payload.name) break;
                const artifactKey = payload.name;
                s.streamingSummaries.set(payload.versionId, {
                    artifactKey,
                    artifactId: payload.artifactId,
                    version: payload.version,
                    content: '',
                });
                ac?.updateArtifact(
                    payload.artifactId,
                    {
                        summaryStreaming: '',
                        isSummaryStreaming: true,
                        isStreaming: true,
                        proposedVersion: { summaryInternal: '' },
                    },
                    payload.version,
                );
                if (id) {
                    streamMonitor.markSummaryStarted({
                        chatId: id,
                        artifactId: payload.artifactId,
                        artifactKey,
                        version: payload.version,
                    });
                }
                o.onArtifactOpen?.({ artifactId: payload.artifactId, artifactKey, version: payload.version });
                flushActiveDocuments();
                break;
            }

            case 'summary_delta': {
                if (!payload.versionId) break;
                if (!s.streamingSummaries.has(payload.versionId)) break;
                const chunks = chunkText(payload.content);
                if (chunks.length === 1) {
                    summaryDripRef.current.enqueue({ versionId: payload.versionId, content: chunks[0] });
                } else {
                    summaryDripRef.current.enqueue(chunks.map((c) => ({ versionId: payload.versionId, content: c })));
                }
                break;
            }

            case 'summary_complete': {
                summaryDripRef.current.drain();
                if (!payload.versionId) break;
                const summary = s.streamingSummaries.get(payload.versionId);
                if (!summary) break;
                const finalContent = payload.content ?? summary.content;
                ac?.updateArtifact(
                    summary.artifactId,
                    {
                        summaryStreaming: finalContent,
                        isSummaryStreaming: false,
                        isStreaming: false,
                        proposedVersion: { summaryInternal: finalContent },
                    },
                    summary.version,
                );
                o.revalidateArtifact?.({
                    artifactId: summary.artifactId,
                    artifactKey: summary.artifactKey,
                    version: summary.version,
                });
                s.streamingSummaries.delete(payload.versionId);
                flushActiveDocuments();
                break;
            }
            default:
                // TODO log?
                break;
        }

        if (streamTerminalRef.current) {
            clearStreamingFlags();
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
        summaryDripRef.current.dispose();
        documentQueueRef.current = new AsyncEventQueue(handleDocumentEvent);
        setBlocks([]);
        setActiveDocuments([]);
        setPendingDecisions([]);
        setSubmittingDecisions({});
        setStatus('idle');
        setDisplayStatus(null);
        setAgentMessageId(null);
        setStreamType(null);
        setError(null);
        setIsRetracted(false);
        ownedAgentMessageIdRef.current = null;
        streamTerminalRef.current = false;
        subscribeStartedAtRef.current = performance.now();
        streamSessionRef.current = null;
        subscribePendingRef.current = true;
        preSnapshotBufferRef.current = [];
        isFlushingSubscribeBufferRef.current = false;
        lastAppliedSeqRef.current.clear();
        subscribeGapDiagnosticsRef.current = createSubscribeGapDiagnostics();

        // Track initial connection for reconnect detection
        let isFirstConnect = !ws.connected;

        // ----- message handler -----
        const onMessage = (msg: ServerMessage & { rid?: string }) => {
            if (!isTopicMessage(msg) || msg.topic !== topic) return;

            if (subscribePendingRef.current && msg.type !== ServerMsg.SubscribeResponse) {
                preSnapshotBufferRef.current.push(msg);
                subscribeGapDiagnosticsRef.current.buffered += 1;
                return;
            }

            // Replay buffered topic messages after a SubscribeResponse has been processed.
            // Three kinds of events are dropped during flush:
            //  1. `_seq <= seqHigh` — snapshot-covered stream-content duplicates
            //  2. `stream_started` for the already-active stream — snapshot already initialized it,
            //     replaying it would blow away restored state
            //  3. (implicit via onMessage) live dedup on `shouldApplySeq` for anything that passes
            // Stream-content events are flushed in ascending `_seq` order; lifecycle events
            // without `_seq` keep arrival order and go first.
            const flushSubscribeBuffer = (seqHigh?: number) => {
                subscribePendingRef.current = false;
                const buf = preSnapshotBufferRef.current;
                preSnapshotBufferRef.current = [];
                const snapshotStreamId = ownedAgentMessageIdRef.current;
                const diagnostics = subscribeGapDiagnosticsRef.current;
                buf.sort((a, b) => {
                    const sa = extractMsgSeq(a as { type?: string; _seq?: unknown });
                    const sb = extractMsgSeq(b as { type?: string; _seq?: unknown });
                    if (sa === undefined && sb === undefined) return 0;
                    if (sa === undefined) return -1;
                    if (sb === undefined) return 1;
                    return sa - sb;
                });
                isFlushingSubscribeBufferRef.current = true;
                try {
                    for (const b of buf) {
                        if (seqHigh !== undefined) {
                            const seq = extractMsgSeq(b as { type?: string; _seq?: unknown });
                            if (seq !== undefined && seq <= seqHigh) {
                                diagnostics.droppedSnapshotDuplicates += 1;
                                continue;
                            }
                        }
                        if (
                            b.type === ServerMsg.StreamStarted &&
                            snapshotStreamId !== null &&
                            (b as StreamStartedMessage).agentMessageId === snapshotStreamId
                        ) {
                            diagnostics.skippedSnapshotStreamStarted += 1;
                            continue;
                        }
                        onMessage(b);
                    }
                } finally {
                    isFlushingSubscribeBufferRef.current = false;
                }
                if (ENABLE_SUBSCRIBE_GAP_DIAGNOSTICS) {
                    const replayed =
                        buf.length - diagnostics.droppedSnapshotDuplicates - diagnostics.skippedSnapshotStreamStarted;
                    console.debug('[use-stream] subscribe gap diagnostics', {
                        topic,
                        seqHigh,
                        buffered: diagnostics.buffered,
                        droppedSnapshotDuplicates: diagnostics.droppedSnapshotDuplicates,
                        droppedSeqDuplicates: diagnostics.droppedSeqDuplicates,
                        seqRegressions: diagnostics.seqRegressions,
                        skippedSnapshotStreamStarted: diagnostics.skippedSnapshotStreamStarted,
                        replayed,
                    });
                    captureSubscribeDiagnostic('stream_subscribe_buffer_flushed', {
                        seq_high: seqHigh,
                        buffered: diagnostics.buffered,
                        dropped_snapshot_duplicates: diagnostics.droppedSnapshotDuplicates,
                        dropped_seq_duplicates: diagnostics.droppedSeqDuplicates,
                        seq_regressions: diagnostics.seqRegressions,
                        skipped_snapshot_stream_started: diagnostics.skippedSnapshotStreamStarted,
                        replayed,
                    });
                }
            };

            const s = stateRef.current;
            const o = optsRef.current;

            switch (msg.type) {
                // ==============================================================
                // SUBSCRIBE RESPONSE
                // ==============================================================
                case ServerMsg.SubscribeResponse: {
                    if (!subscribePendingRef.current) break;
                    const resp = msg as SubscribeResponse;
                    let flushSeqHigh: number | undefined;
                    if (resp.status === 'streaming') {
                        const sr = resp as SubscribeResponseStreaming;
                        captureSubscribeCompleted('streaming', sr.agentMessageId, sr.streamType ?? null);
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
                            flushSubscribeBuffer();
                            break;
                        }

                        if (ownedAgentMessageId && sr.agentMessageId !== ownedAgentMessageId) {
                            o.onSubscribeResponse?.(
                                'streaming',
                                resp.selectedModel ?? null,
                                resp.completionBriefStatus ?? null,
                            );
                            flushSubscribeBuffer();
                            break;
                        }

                        ownedAgentMessageIdRef.current = sr.agentMessageId;
                        startStreamSessionAnalytics(sr.agentMessageId, sr.streamType ?? null);
                        stateRef.current = initFromSnapshot(sr.snapshot);
                        setBlocks([...sr.snapshot.blocks]);
                        setActiveDocuments(sr.snapshot.activeDocuments);
                        setPendingDecisions(sr.snapshot.pendingDecisions ?? []);
                        setStatus(sr.snapshot.status);
                        setAgentMessageId(sr.agentMessageId);
                        setStreamType(sr.streamType ?? null);
                        setDisplayStatus(sr.snapshot.displayStatus ?? null);

                        lastAppliedSeqRef.current.set(sr.agentMessageId, sr.seqHigh);
                        flushSeqHigh = sr.seqHigh;

                        // Initialize artifact state from snapshot activeDocuments
                        if (o.artifactContext && sr.snapshot.activeDocuments.length > 0) {
                            const now = new Date().toISOString();
                            for (const doc of sr.snapshot.activeDocuments) {
                                // Fail-closed: only show content when isInternal is explicitly false.
                                const snapshotContent = doc.isInternal === false ? doc.content : '';
                                const hasSummary =
                                    doc.summaryInternal !== undefined || doc.summaryVersionId !== undefined;
                                const previousVersion = getPreviousArtifactVersion(doc.pendingVersion);
                                if (
                                    doc.isInternal &&
                                    (doc.mode === 'edit' || doc.mode === 'replace') &&
                                    previousVersion !== undefined
                                ) {
                                    if (o.artifactContext.getArtifact(doc.artifactId, previousVersion)) {
                                        o.artifactContext.updateArtifact(
                                            doc.artifactId,
                                            { isUpdating: true },
                                            previousVersion,
                                        );
                                    } else if (o.fetchArtifact) {
                                        void o.fetchArtifact(doc.name, previousVersion).then(() => {
                                            o.artifactContext?.updateArtifact(
                                                doc.artifactId,
                                                { isUpdating: true },
                                                previousVersion,
                                            );
                                        });
                                    }
                                }
                                // Diff base for non-internal edit/replace reconnects.
                                // Edit: DO carries loadedContent on the snapshot (also needed for replay correctness).
                                // Replace: DO doesn't carry loadedContent (no replay correctness need); fall back to cached artifact (e.g., user was viewing it pre-disconnect) and async-fetch only if uncached.
                                let baseContent = doc.loadedContent ?? '';
                                if (
                                    !baseContent &&
                                    doc.mode === 'replace' &&
                                    doc.loadedVersion &&
                                    doc.isInternal === false
                                ) {
                                    const cached = o.artifactContext.getArtifact(doc.artifactId, doc.loadedVersion);
                                    if (cached) {
                                        baseContent = getLatestArtifactVersionContent(cached) ?? '';
                                    }
                                }

                                o.artifactContext.addArtifact(
                                    {
                                        id: doc.artifactId,
                                        key: doc.name,
                                        version: doc.pendingVersion,
                                        proposedVersion: {
                                            id: '',
                                            version: doc.pendingVersion,
                                            title: doc.title,
                                            content: snapshotContent,
                                            status: 'proposed',
                                            documentType: doc.documentType,
                                            isInternal: doc.isInternal,
                                            ...(hasSummary ? { summaryInternal: doc.summaryInternal ?? '' } : {}),
                                            createdAt: now,
                                            updatedAt: now,
                                        },
                                        ...(doc.loadedVersion && (doc.mode === 'edit' || doc.mode === 'replace')
                                            ? {
                                                  currentVersion: {
                                                      id: '',
                                                      version: doc.loadedVersion,
                                                      title: doc.title,
                                                      content: baseContent,
                                                      status: 'approved',
                                                      createdAt: now,
                                                      updatedAt: now,
                                                  },
                                              }
                                            : {}),
                                        createdAt: now,
                                        updatedAt: now,
                                        isStreaming: true,
                                        ...(hasSummary
                                            ? { summaryStreaming: doc.summaryInternal ?? '', isSummaryStreaming: true }
                                            : {}),
                                        isUpdating: doc.mode === 'edit' || doc.mode === 'replace',
                                        isLoading: false,
                                        progress: doc.progress ?? 0,
                                        sourceChatId: id ?? undefined,
                                    },
                                    doc.pendingVersion,
                                );

                                if (id && o.streamLocation) {
                                    streamMonitor.register({
                                        chatId: id,
                                        location: { domain: domain as 'chat' | 'intake', ...o.streamLocation },
                                        artifactId: doc.artifactId,
                                        artifactKey: doc.name,
                                        artifactName: doc.title,
                                        version: doc.pendingVersion,
                                        ...(doc.isInternal !== undefined ? { isInternal: doc.isInternal } : {}),
                                        mode: doc.mode,
                                        ...(doc.loadedVersion !== undefined
                                            ? { loadedVersion: doc.loadedVersion }
                                            : {}),
                                        ...(previousVersion !== undefined ? { previousVersion } : {}),
                                        hasSummary,
                                        source: 'local',
                                    });
                                }

                                // Replace cold-reconnect: no DO loadedContent and not in cache → fetch the version being replaced for diff UI. Skipped for internal (API redacts anyway, and we trust producer-side suppression).
                                if (
                                    !baseContent &&
                                    doc.mode === 'replace' &&
                                    doc.loadedVersion &&
                                    doc.isInternal === false &&
                                    o.fetchArtifact
                                ) {
                                    const loadedVersion = doc.loadedVersion;
                                    const docName = doc.name;
                                    const artifactId = doc.artifactId;
                                    const pendingVersion = doc.pendingVersion;
                                    void o.fetchArtifact(docName, loadedVersion).then((artifact) => {
                                        if (!artifact) return;
                                        const fetched = getLatestArtifactVersionContent(artifact);
                                        if (typeof fetched !== 'string') return;
                                        const updatedAt = new Date().toISOString();
                                        o.artifactContext?.updateArtifact(
                                            artifactId,
                                            {
                                                currentVersion: {
                                                    id: '',
                                                    version: loadedVersion,
                                                    content: fetched,
                                                    status: 'approved',
                                                    createdAt: now,
                                                    updatedAt,
                                                },
                                            },
                                            pendingVersion,
                                        );
                                    });
                                }

                                if (!doc.isInternal || hasSummary) {
                                    o.onArtifactOpen?.({
                                        artifactId: doc.artifactId,
                                        artifactKey: doc.name,
                                        version: doc.pendingVersion,
                                    });
                                }
                            }
                        }

                        documentQueueRef.current = new AsyncEventQueue(handleDocumentEvent);

                        if (sr.replayStatus === 'failed') {
                            console.warn('[use-stream] subscribe snapshot may be stale (replayStatus: failed)', {
                                agentMessageId: sr.agentMessageId,
                                seqHigh: sr.seqHigh,
                            });
                            captureSubscribeDiagnostic('stream_subscribe_replay_failed', {
                                agent_message_id: sr.agentMessageId,
                                seq_high: sr.seqHigh,
                                stream_type: sr.streamType ?? null,
                            });
                        }

                        o.onSubscribeResponse?.(
                            'streaming',
                            resp.selectedModel ?? null,
                            resp.completionBriefStatus ?? null,
                        );
                    } else {
                        captureSubscribeCompleted(resp.status);
                        ownedAgentMessageIdRef.current = null;
                        setStatus('idle');
                        setAgentMessageId(null);
                        setStreamType(null);
                        setDisplayStatus(null);
                        o.onSubscribeResponse?.(
                            resp.status,
                            resp.selectedModel ?? null,
                            resp.completionBriefStatus ?? null,
                        );
                    }
                    flushSubscribeBuffer(flushSeqHigh);
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
                    setPendingDecisions([]);
                    setSubmittingDecisions({});
                    setStatus('streaming');
                    setDisplayStatus(null);
                    setError(null);
                    setIsRetracted(false);
                    setAgentMessageId(started.agentMessageId);
                    setStreamType(started.streamType ?? null);
                    streamTerminalRef.current = false;
                    startStreamSessionAnalytics(started.agentMessageId, started.streamType ?? null);
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
                    const { event, agentMessageId: eventAgentMessageId } = msg;
                    if (eventAgentMessageId !== ownedAgentMessageIdRef.current) {
                        break;
                    }
                    if (!shouldApplySeq(eventAgentMessageId, msg._seq)) {
                        break;
                    }
                    if (streamSessionRef.current?.agentMessageId === eventAgentMessageId) {
                        streamSessionRef.current.eventCount += 1;
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
                        case 'tool_call_complete': {
                            const idx = s.blocks.findIndex((b) => b.type === 'tool_call' && b.toolCallId === event.id);
                            if (idx !== -1 && s.blocks[idx].type === 'tool_call') {
                                s.blocks[idx] = {
                                    ...s.blocks[idx],
                                    toolInput: event.input,
                                } as StreamBlock;
                                flush();
                            }
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
                                        o.revalidateArtifact?.({ artifactKey: parsed.name, version: parsed.version });

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

                        // ----- Internal-document summary (auto-generated PECP) -----
                        case 'summary_start':
                        case 'summary_delta':
                        case 'summary_complete':
                            documentQueueRef.current?.push({ type: event.type, payload: event });
                            break;

                        // ----- User decision prompts -----
                        case 'decision_prompt': {
                            setPendingDecisions((prev) => {
                                if (prev.some((d) => d.toolCallId === event.toolCallId)) return prev;
                                return [
                                    ...prev,
                                    {
                                        toolCallId: event.toolCallId,
                                        question: event.question,
                                        options: event.options,
                                        context: event.context,
                                    },
                                ];
                            });
                            break;
                        }
                        case 'decision_resolved':
                            setPendingDecisions((prev) => prev.filter((d) => d.toolCallId !== event.toolCallId));
                            setSubmittingDecisions((prev) => {
                                if (!(event.toolCallId in prev)) return prev;
                                const { [event.toolCallId]: _dropped, ...rest } = prev;
                                return rest;
                            });
                            break;

                        // ----- Status & terminal -----
                        case 'status_update':
                            setDisplayStatus(event.status);
                            break;

                        case 'error':
                            if (!event.soft) {
                                streamTerminalRef.current = true;
                                flushSync();
                                clearStreamingFlags();
                                setError(event.error);
                                captureStreamSessionEnded('error', eventAgentMessageId);
                            }
                            break;

                        case 'done':
                            // Synchronous flush so setBlocks + setStatus('done') land
                            // in the same React batch — prevents stale-blocks-on-done.
                            streamTerminalRef.current = true;
                            flushSync();
                            clearStreamingFlags();
                            if (event.error) setError(event.error);
                            if (event.outputType === 'tool' && event.outputTool) o.onTerminalTool?.(event.outputTool);
                            setDisplayStatus(null);
                            // Don't override aborted/error — stream_status is authoritative
                            setStatus((prev) => (prev === 'aborted' || prev === 'error' ? prev : 'done'));
                            if (o.onToolDocumentDecision) flushDocumentDecisions(o.onToolDocumentDecision);
                            o.onDone?.('done', event, eventAgentMessageId);
                            captureStreamSessionEnded('done', eventAgentMessageId);
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
                            summaryDripRef.current.dispose();
                            streamTerminalRef.current = true;
                            flushSync();
                            clearStreamingFlags();
                            setPendingDecisions([]);
                            setSubmittingDecisions({});
                            setIsRetracted(true);
                            captureStreamSessionEnded('aborted', eventAgentMessageId);
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
                    if (msg.agentMessageId !== ownedAgentMessageIdRef.current) {
                        break;
                    }
                    if (!shouldApplySeq(msg.agentMessageId, msg._seq)) {
                        break;
                    }
                    const isTerminal = msg.status === 'done' || msg.status === 'aborted' || msg.status === 'error';
                    if (isTerminal) {
                        streamTerminalRef.current = true;
                        flushSync();
                        clearStreamingFlags();
                    }

                    setStatus(msg.status);
                    setAgentMessageId(msg.agentMessageId);

                    if (isTerminal) {
                        ownedAgentMessageIdRef.current = null;
                        setDisplayStatus(null);
                        setPendingDecisions([]);
                        setSubmittingDecisions({});
                        o.onDone?.(msg.status, undefined, msg.agentMessageId);
                        captureStreamSessionEnded(msg.status, msg.agentMessageId);
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
                if (subscribePendingRef.current) {
                    ws.send({ action: ClientAction.Subscribe, topic });
                }
                return;
            }
            // On reconnect, `resubscribeAll` (base) may or may not re-send for this topic —
            // in the SharedWebsocketClient follower case, ref-counting can skip the WS
            // Subscribe entirely. Force-send to guarantee a fresh SubscribeResponse, then
            // buffer everything that arrives until it lands.
            subscribePendingRef.current = true;
            preSnapshotBufferRef.current = [];
            lastAppliedSeqRef.current.clear();
            subscribeGapDiagnosticsRef.current = createSubscribeGapDiagnostics();
            ws.send({ action: ClientAction.Subscribe, topic });
            optsRef.current.onReconnect?.();
        };

        ws.on('message', onMessage);
        ws.on('connected', onConnected);

        const wasMonitoredInBackground = streamMonitor.isMonitoring(id);

        // Subscribe (ref-counted in WS client). If a background monitor already
        // owns the topic, this increments the local ref count without sending a
        // new subscribe frame. After releasing the monitor, explicitly ask for a
        // fresh snapshot so this hook can reconcile stale DB active-stream state.
        const unsub = ws.subscribe(topic);
        streamMonitor.release(id);
        if (ws.connected) {
            ws.send({ action: ClientAction.Subscribe, topic });
        } else if (wasMonitoredInBackground) {
            ws.refreshSubscription(topic);
        }

        return () => {
            ws.off('message', onMessage);
            ws.off('connected', onConnected);
            if (stateRef.current.streamingDocs.size > 0) {
                docDripRef.current.drain();
                streamMonitor.takeover(id);
            }
            unsub();
            dripRef.current.dispose();
            docDripRef.current.dispose();
            summaryDripRef.current.dispose();
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

    const selectDecision = (toolCallId: string, value: string, freeText?: string) => {
        if (!id) return;
        const submission: DecisionSubmission = freeText ? { value, freeText } : { value };
        setSubmittingDecisions((prev) => ({ ...prev, [toolCallId]: submission }));
        const payload: { toolCallId: string; value: string; freeText?: string } = { toolCallId, value };
        if (freeText) payload.freeText = freeText;
        ws.sendAction(`${domain}:${id}`, 'decision_select', payload);
    };

    const dismissDecision = (toolCallId: string) => {
        if (!id) return;
        setSubmittingDecisions((prev) => ({ ...prev, [toolCallId]: { value: DECISION_DISMISSED_SENTINEL } }));
        ws.sendAction(`${domain}:${id}`, 'decision_dismiss', { toolCallId });
    };

    return {
        blocks,
        activeDocuments,
        pendingDecisions,
        submittingDecisions,
        status,
        displayStatus,
        agentMessageId,
        streamType,
        error,
        isRetracted,
        abort,
        sendAction,
        selectDecision,
        dismissDecision,
    };
}
