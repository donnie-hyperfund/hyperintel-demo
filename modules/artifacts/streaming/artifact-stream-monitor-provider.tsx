'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import type { StreamEvent } from '@/lib/schema/stream';
import {
    type ArtifactStreamCompletedPayload,
    type ArtifactStreamStartedPayload,
    UserEventType,
} from '@/lib/schema/user-events';
import {
    type ServerMessage,
    ServerMsg,
    type StreamEventMessage,
    type StreamStatusMessage,
} from '@/lib/schema/ws-protocol';
import { useWebsocket } from '@/lib/websocket/provider';
import { useArtifactRevalidator } from '@/modules/artifacts/hooks/use-artifact-revalidator';
import {
    type ArtifactScope,
    type ArtifactUpdate,
    getArtifactScopeForProject,
    useArtifactStoreController,
} from '@/modules/artifacts/providers/artifact-provider';
import { useUserEvents } from '@/modules/chat/hooks/use-user-events';
import type { ActiveArtifactStream, ChatStreamLocation } from './types';

type RegisterInput = {
    chatId: string;
    location: ChatStreamLocation;
    artifactKey: string;
    artifactName: string;
    version: number;
    source?: 'local' | 'broadcast';
};

type MonitoredArtifact = {
    name: string;
    version: number;
    content: string;
    summaryContent: string;
    summaryVersionId: string | null;
    finalizing: boolean;
    local: boolean;
};

type MonitorState = {
    chatId: string;
    location: ChatStreamLocation;
    artifacts: Map<string, MonitoredArtifact>;
    wsUnsub: (() => void) | null;
};

type ViewedArtifact = { projectId: string | null; artifactKey: string; version: number } | null;
type ActivationHandler = (artifactKey: string, version: number) => void;

type ArtifactStreamMonitorContextValue = {
    register: (input: RegisterInput) => void;
    unregister: (chatId: string, artifactKey: string) => void;
    takeover: (chatId: string) => void;
    release: (chatId: string) => void;
    isMonitoring: (chatId: string) => boolean;
    setViewedArtifact: (info: ViewedArtifact) => void;
    setActivationHandler: (chatId: string | null, handler: ActivationHandler | null) => void;
    tryActivate: (chatId: string, artifactKey: string, version: number) => boolean;
    subscribe: (callback: () => void) => () => void;
    getActiveStreams: () => ActiveArtifactStream[];
};

const COMPLETION_FALLBACK_MS = 3500;
const Ctx = createContext<ArtifactStreamMonitorContextValue | null>(null);

function artifactScopeForLocation(location: ChatStreamLocation): ArtifactScope {
    return getArtifactScopeForProject(location.projectId);
}

function monitorKey(chatId: string, artifactKey: string): string {
    return `${chatId}:${artifactKey}`;
}

function applyEdits(content: string, edits: NonNullable<Extract<StreamEvent, { type: 'document_edit' }>['edits']>) {
    let lines = content.split('\n');
    for (const edit of edits) {
        const rangeStart = Math.max(0, edit.startLine - 1);
        const rangeEnd = Math.min(lines.length, edit.endLine);
        lines = [...lines.slice(0, rangeStart), ...edit.newContent.split('\n'), ...lines.slice(rangeEnd)];
    }
    return lines.join('\n');
}

export function ArtifactStreamMonitorProvider({ children }: { children: ReactNode }) {
    const ws = useWebsocket();
    const artifactStore = useArtifactStoreController();
    const revalidateArtifact = useArtifactRevalidator();
    const monitoredRef = useRef<Map<string, MonitorState>>(new Map());
    const subscribers = useRef(new Set<() => void>());
    const viewedRef = useRef<ViewedArtifact>(null);
    const activationRef = useRef<{ chatId: string; handler: ActivationHandler } | null>(null);
    const completionFallbackTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const cachedSnapshot = useRef<ActiveArtifactStream[]>([]);

    const emit = useCallback(() => {
        cachedSnapshot.current = computeSnapshot(monitoredRef.current, viewedRef.current);
        for (const callback of subscribers.current) callback();
    }, []);

    const subscribe = useCallback((callback: () => void) => {
        subscribers.current.add(callback);
        return () => {
            subscribers.current.delete(callback);
        };
    }, []);

    const getActiveStreams = useCallback(() => cachedSnapshot.current, []);

    const clearCompletionFallback = useCallback((chatId: string, artifactKey: string) => {
        const key = monitorKey(chatId, artifactKey);
        const timer = completionFallbackTimersRef.current.get(key);
        if (!timer) return;
        clearTimeout(timer);
        completionFallbackTimersRef.current.delete(key);
    }, []);

    const dropChat = useCallback(
        (chatId: string) => {
            const state = monitoredRef.current.get(chatId);
            if (!state) return;
            for (const artifactKey of state.artifacts.keys()) {
                clearCompletionFallback(chatId, artifactKey);
            }
            state.wsUnsub?.();
            monitoredRef.current.delete(chatId);
        },
        [clearCompletionFallback],
    );

    const unregister = useCallback(
        (chatId: string, artifactKey: string) => {
            const state = monitoredRef.current.get(chatId);
            if (!state) return;
            clearCompletionFallback(chatId, artifactKey);
            state.artifacts.delete(artifactKey);
            if (state.artifacts.size === 0) dropChat(chatId);
            emit();
        },
        [clearCompletionFallback, dropChat, emit],
    );

    const finalizeArtifact = useCallback(
        async (chatId: string, artifactKey: string, updates: ArtifactUpdate, options: { revalidate: boolean }) => {
            const state = monitoredRef.current.get(chatId);
            const artifact = state?.artifacts.get(artifactKey);
            if (!state || !artifact || artifact.finalizing) return;

            artifact.finalizing = true;
            clearCompletionFallback(chatId, artifactKey);
            const scope = artifactScopeForLocation(state.location);
            artifactStore.updateArtifact(scope, artifactKey, updates, artifact.version);

            if (options.revalidate) {
                await revalidateArtifact({
                    artifactKey,
                    version: artifact.version,
                    projectId: state.location.projectId ?? null,
                    scope,
                }).catch(() => {});
            }

            state.artifacts.delete(artifactKey);
            if (state.artifacts.size === 0) dropChat(chatId);
            emit();
        },
        [artifactStore, clearCompletionFallback, dropChat, emit, revalidateArtifact],
    );

    const scheduleCompletionFallback = useCallback(
        (chatId: string, artifactKey: string) => {
            const key = monitorKey(chatId, artifactKey);
            if (completionFallbackTimersRef.current.has(key)) return;

            const timer = setTimeout(() => {
                completionFallbackTimersRef.current.delete(key);
                void finalizeArtifact(
                    chatId,
                    artifactKey,
                    {
                        isStreaming: false,
                        isUpdating: false,
                        progress: 100,
                    },
                    { revalidate: true },
                );
            }, COMPLETION_FALLBACK_MS);
            completionFallbackTimersRef.current.set(key, timer);
        },
        [finalizeArtifact],
    );

    const register = useCallback(
        (input: RegisterInput) => {
            let state = monitoredRef.current.get(input.chatId);
            if (!state) {
                state = {
                    chatId: input.chatId,
                    location: input.location,
                    artifacts: new Map(),
                    wsUnsub: null,
                };
                monitoredRef.current.set(input.chatId, state);
            } else {
                state.location = input.location;
            }

            const scope = artifactScopeForLocation(input.location);
            const existingState = state.artifacts.get(input.artifactKey);
            const existingArtifact = artifactStore.getArtifact(scope, input.artifactKey, input.version);
            const content = existingArtifact?.proposedVersion?.content ?? existingState?.content ?? '';

            state.artifacts.set(input.artifactKey, {
                name: input.artifactName,
                version: input.version,
                content,
                summaryContent: existingState?.summaryContent ?? '',
                summaryVersionId: existingState?.summaryVersionId ?? null,
                finalizing: false,
                local: existingState?.local === true || input.source === 'local',
            });
            clearCompletionFallback(input.chatId, input.artifactKey);
            emit();
        },
        [artifactStore, clearCompletionFallback, emit],
    );

    const takeover = useCallback(
        (chatId: string) => {
            const state = monitoredRef.current.get(chatId);
            if (!state || state.wsUnsub) return;
            const scope = artifactScopeForLocation(state.location);
            for (const [artifactKey, artifactState] of state.artifacts) {
                const existing = artifactStore.getArtifact(scope, artifactKey, artifactState.version);
                artifactState.content = existing?.proposedVersion?.content ?? artifactState.content;
            }
            const topic = `${state.location.domain}:${chatId}`;
            state.wsUnsub = ws.subscribe(topic);
            emit();
        },
        [ws, artifactStore, emit],
    );

    const release = useCallback(
        (chatId: string) => {
            const state = monitoredRef.current.get(chatId);
            if (!state || !state.wsUnsub) return;
            state.wsUnsub();
            state.wsUnsub = null;
            emit();
        },
        [emit],
    );

    const isMonitoring = useCallback((chatId: string) => monitoredRef.current.has(chatId), []);

    const setViewedArtifact = useCallback(
        (info: ViewedArtifact) => {
            const current = viewedRef.current;
            if (
                current?.projectId === info?.projectId &&
                current?.artifactKey === info?.artifactKey &&
                current?.version === info?.version
            ) {
                return;
            }
            viewedRef.current = info;
            emit();
        },
        [emit],
    );

    const setActivationHandler = useCallback((chatId: string | null, handler: ActivationHandler | null) => {
        if (!chatId || !handler) {
            activationRef.current = null;
            return;
        }
        activationRef.current = { chatId, handler };
    }, []);

    const tryActivate = useCallback((chatId: string, artifactKey: string, version: number) => {
        const active = activationRef.current;
        if (!active || active.chatId !== chatId) return false;
        active.handler(artifactKey, version);
        return true;
    }, []);

    const handleDocumentStart = useCallback(
        (state: MonitorState, event: Extract<StreamEvent, { type: 'document_start' }>) => {
            const artifactKey = event.name;
            const version = event.pendingVersion;
            const scope = artifactScopeForLocation(state.location);
            const now = new Date().toISOString();
            const mode = event.mode ?? 'create';
            const loadedVersion = event.loadedVersion ?? 1;
            const existingArtifact = artifactStore.getArtifact(scope, artifactKey, loadedVersion);
            const loadedContent =
                event.isInternal === true
                    ? ''
                    : (event.loadedContent ??
                      existingArtifact?.proposedVersion?.content ??
                      existingArtifact?.currentVersion?.content ??
                      '');
            const draftContent = mode === 'replace' ? '' : loadedContent;

            state.artifacts.set(artifactKey, {
                name: event.title ?? artifactKey,
                version,
                content: draftContent,
                summaryContent: '',
                summaryVersionId: null,
                finalizing: false,
                local: true,
            });

            artifactStore.addArtifact(
                scope,
                {
                    id: artifactKey,
                    key: artifactKey,
                    version,
                    ...(mode === 'edit' || mode === 'replace'
                        ? {
                              currentVersion: {
                                  id: '',
                                  version: loadedVersion,
                                  title: event.title ?? artifactKey,
                                  content: loadedContent,
                                  status: 'approved',
                                  createdAt: now,
                                  updatedAt: now,
                              },
                          }
                        : {}),
                    proposedVersion: {
                        id: '',
                        version,
                        title: event.title ?? artifactKey,
                        content: draftContent,
                        status: 'proposed',
                        documentType: event.documentType,
                        isInternal: event.isInternal,
                        createdAt: now,
                        updatedAt: now,
                    },
                    createdAt: now,
                    updatedAt: now,
                    isStreaming: true,
                    isUpdating: mode === 'edit' || mode === 'replace',
                    isLoading: false,
                    progress: 0,
                    sourceChatId: state.chatId,
                },
                version,
            );
            emit();
        },
        [artifactStore, emit],
    );

    const handleDocumentEvent = useCallback(
        (target: MonitorState, event: StreamEvent) => {
            const scope = artifactScopeForLocation(target.location);

            switch (event.type) {
                case 'document_start':
                    handleDocumentStart(target, event);
                    break;
                case 'document_delta': {
                    const artifact = target.artifacts.get(event.name);
                    if (!artifact) break;
                    artifact.content += event.content;
                    artifactStore.updateArtifact(
                        scope,
                        event.name,
                        { proposedVersion: { content: artifact.content }, isStreaming: true, isUpdating: false },
                        artifact.version,
                    );
                    break;
                }
                case 'document_edit': {
                    const artifact = target.artifacts.get(event.name);
                    if (!artifact) break;
                    artifact.content = applyEdits(artifact.content, event.edits);
                    artifactStore.updateArtifact(
                        scope,
                        event.name,
                        { proposedVersion: { content: artifact.content }, isUpdating: false, isStreaming: false },
                        artifact.version,
                    );
                    void revalidateArtifact({
                        artifactKey: event.name,
                        version: artifact.version,
                        projectId: target.location.projectId ?? null,
                        scope,
                    }).catch(() => {});
                    break;
                }
                case 'document_progress': {
                    const artifact = target.artifacts.get(event.name);
                    if (!artifact) break;
                    artifactStore.updateArtifact(scope, event.name, { progress: event.progress }, artifact.version);
                    break;
                }
                case 'summary_start': {
                    const artifact = target.artifacts.get(event.name);
                    if (!artifact) break;
                    artifact.summaryContent = '';
                    artifact.summaryVersionId = event.versionId;
                    artifactStore.updateArtifact(
                        scope,
                        event.name,
                        {
                            summaryStreaming: '',
                            isSummaryStreaming: true,
                            isStreaming: true,
                            proposedVersion: { summaryInternal: '' },
                        },
                        event.version,
                    );
                    break;
                }
                case 'summary_delta': {
                    const artifact = target.artifacts.get(event.name);
                    if (!artifact || artifact.summaryVersionId !== event.versionId) break;
                    artifact.summaryContent += event.content;
                    artifactStore.updateArtifact(
                        scope,
                        event.name,
                        {
                            summaryStreaming: artifact.summaryContent,
                            proposedVersion: { summaryInternal: artifact.summaryContent },
                        },
                        event.version,
                    );
                    break;
                }
                case 'summary_complete': {
                    const artifact = target.artifacts.get(event.name);
                    if (!artifact || artifact.summaryVersionId !== event.versionId) break;
                    artifact.summaryContent = event.content;
                    artifact.summaryVersionId = null;
                    artifactStore.updateArtifact(
                        scope,
                        event.name,
                        {
                            summaryStreaming: event.content,
                            isSummaryStreaming: false,
                            isStreaming: false,
                            proposedVersion: { summaryInternal: event.content },
                        },
                        event.version,
                    );
                    void revalidateArtifact({
                        artifactKey: event.name,
                        version: event.version,
                        projectId: target.location.projectId ?? null,
                        scope,
                    }).catch(() => {});
                    break;
                }
                case 'document_complete': {
                    const artifact = target.artifacts.get(event.name);
                    if (!artifact) break;
                    if (event.action === 'aborted' || event.status === 'aborted') {
                        void finalizeArtifact(
                            target.chatId,
                            event.name,
                            { isStreaming: false, isUpdating: false, progress: 0 },
                            { revalidate: false },
                        );
                        break;
                    }
                    void finalizeArtifact(
                        target.chatId,
                        event.name,
                        {
                            isStreaming: false,
                            isUpdating: false,
                            progress: 100,
                            version: artifact.version,
                            proposedVersion: { version: artifact.version, status: 'proposed' },
                        },
                        { revalidate: true },
                    );
                    break;
                }
                case 'error':
                case 'safety_retract':
                    for (const artifactKey of target.artifacts.keys()) {
                        void finalizeArtifact(
                            target.chatId,
                            artifactKey,
                            { isStreaming: false, isUpdating: false, progress: 0 },
                            { revalidate: false },
                        );
                    }
                    break;
                default:
                    break;
            }
        },
        [artifactStore, finalizeArtifact, handleDocumentStart, revalidateArtifact],
    );

    const findMonitoredTarget = useCallback((topic: string): MonitorState | null => {
        for (const state of monitoredRef.current.values()) {
            if (state.wsUnsub && `${state.location.domain}:${state.chatId}` === topic) {
                return state;
            }
        }
        return null;
    }, []);

    const handleTerminalStatus = useCallback(
        (target: MonitorState, status: StreamStatusMessage['status']) => {
            const shouldRevalidate = status === 'done';
            for (const artifactKey of target.artifacts.keys()) {
                void finalizeArtifact(
                    target.chatId,
                    artifactKey,
                    {
                        isStreaming: false,
                        isUpdating: false,
                        progress: shouldRevalidate ? 100 : 0,
                    },
                    { revalidate: shouldRevalidate },
                );
            }
        },
        [finalizeArtifact],
    );

    useUserEvents(
        useCallback(
            (eventType: string, payload: unknown) => {
                if (eventType === UserEventType.ArtifactStreamStarted) {
                    const data = payload as ArtifactStreamStartedPayload;
                    register({
                        chatId: data.chatId,
                        location: {
                            domain: data.domain,
                            chatType: data.chatType,
                            projectId: data.projectId ?? undefined,
                            phaseName: data.phaseName ?? null,
                            phaseIndex: data.phaseIndex ?? null,
                        },
                        artifactKey: data.artifactKey,
                        artifactName: data.artifactName,
                        version: data.version,
                    });
                    return;
                }

                if (eventType !== UserEventType.ArtifactStreamCompleted) return;
                const data = payload as ArtifactStreamCompletedPayload;
                const state = monitoredRef.current.get(data.chatId);
                const artifact = state?.artifacts.get(data.artifactKey);
                if (state?.wsUnsub || artifact?.local) {
                    scheduleCompletionFallback(data.chatId, data.artifactKey);
                    return;
                }
                unregister(data.chatId, data.artifactKey);
            },
            [register, scheduleCompletionFallback, unregister],
        ),
    );

    useEffect(() => {
        const handler = (message: ServerMessage & { rid?: string }) => {
            if (!('topic' in message) || typeof message.topic !== 'string') return;
            const target = findMonitoredTarget(message.topic);
            if (!target) return;

            if (message.type === ServerMsg.StreamEvent) {
                handleDocumentEvent(target, (message as StreamEventMessage).event);
                return;
            }

            if (message.type === ServerMsg.StreamStatus) {
                const { status } = message as StreamStatusMessage;
                if (status === 'done' || status === 'aborted' || status === 'error') {
                    handleTerminalStatus(target, status);
                }
            }
        };

        ws.on('message', handler);
        return () => ws.off('message', handler);
    }, [ws, findMonitoredTarget, handleDocumentEvent, handleTerminalStatus]);

    useEffect(
        () => () => {
            for (const timer of completionFallbackTimersRef.current.values()) {
                clearTimeout(timer);
            }
            completionFallbackTimersRef.current.clear();
        },
        [],
    );

    const api = useRef<ArtifactStreamMonitorContextValue>({
        register,
        unregister,
        takeover,
        release,
        isMonitoring,
        setViewedArtifact,
        setActivationHandler,
        tryActivate,
        subscribe,
        getActiveStreams,
    }).current;

    return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useArtifactStreamMonitor() {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('useArtifactStreamMonitor must be used within ArtifactStreamMonitorProvider');
    return ctx;
}

export function useActiveArtifactStreams(): ActiveArtifactStream[] {
    const { subscribe, getActiveStreams } = useArtifactStreamMonitor();
    return useSyncExternalStore(subscribe, getActiveStreams, getActiveStreams);
}

function computeSnapshot(monitored: Map<string, MonitorState>, viewed: ViewedArtifact): ActiveArtifactStream[] {
    const all: ActiveArtifactStream[] = [];
    for (const state of monitored.values()) {
        for (const [artifactKey, artifactState] of state.artifacts.entries()) {
            const entryProjectId = state.location.projectId ?? null;
            if (
                viewed &&
                viewed.projectId === entryProjectId &&
                viewed.artifactKey === artifactKey &&
                viewed.version === artifactState.version
            ) {
                continue;
            }
            all.push({
                chatId: state.chatId,
                artifactKey,
                artifactName: artifactState.name,
                version: artifactState.version,
                location: state.location,
            });
        }
    }
    return all;
}
