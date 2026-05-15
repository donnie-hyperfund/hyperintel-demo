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
import type {
    ActiveArtifactPreviewTarget,
    ActiveArtifactStream,
    ArtifactStreamMode,
    ChatStreamLocation,
} from './types';
import { getPreviousArtifactVersion } from './versions';

type RegisterInput = {
    chatId: string;
    location: ChatStreamLocation;
    artifactId: string;
    artifactKey: string;
    artifactName: string;
    version: number;
    isInternal?: boolean;
    mode?: ArtifactStreamMode;
    loadedVersion?: number;
    previousVersion?: number;
    hasSummary?: boolean;
    source?: 'local' | 'broadcast';
};

type MonitoredArtifact = {
    artifactId: string;
    artifactKey: string;
    name: string;
    version: number;
    isInternal: boolean;
    mode: ArtifactStreamMode;
    loadedVersion?: number;
    previousVersion?: number;
    hasSummary: boolean;
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

type ViewedArtifact = { projectId: string | null; artifactId: string; version: number } | null;
type ActivationHandler = (target: ActiveArtifactPreviewTarget) => void;
type StreamArtifactTarget = { chatId: string; artifactId: string; artifactKey: string; version: number };

type ArtifactStreamMonitorContextValue = {
    register: (input: RegisterInput) => void;
    markSummaryStarted: (input: StreamArtifactTarget) => void;
    unregister: (chatId: string, artifactId: string) => void;
    takeover: (chatId: string) => void;
    release: (chatId: string) => void;
    isMonitoring: (chatId: string) => boolean;
    setViewedArtifact: (info: ViewedArtifact) => void;
    setActivationHandler: (chatId: string | null, handler: ActivationHandler | null) => void;
    tryActivate: (input: StreamArtifactTarget) => boolean;
    subscribe: (callback: () => void) => () => void;
    getActiveStreams: () => ActiveArtifactStream[];
};

const COMPLETION_FALLBACK_MS = 3500;
const Ctx = createContext<ArtifactStreamMonitorContextValue | null>(null);

function artifactScopeForLocation(location: ChatStreamLocation): ArtifactScope {
    return getArtifactScopeForProject(location.projectId);
}

function mergeLocation(current: ChatStreamLocation | undefined, incoming: ChatStreamLocation): ChatStreamLocation {
    return {
        ...(current ?? {}),
        ...incoming,
        projectName: incoming.projectName ?? current?.projectName ?? null,
        phaseName: incoming.phaseName ?? current?.phaseName ?? null,
        phaseIndex: incoming.phaseIndex ?? current?.phaseIndex ?? null,
    };
}

function monitorKey(chatId: string, artifactId: string): string {
    return `${chatId}:${artifactId}`;
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
        cachedSnapshot.current = computeSnapshot(
            monitoredRef.current,
            viewedRef.current,
            activationRef.current?.chatId ?? null,
        );
        for (const callback of subscribers.current) callback();
    }, []);

    const subscribe = useCallback((callback: () => void) => {
        subscribers.current.add(callback);
        return () => {
            subscribers.current.delete(callback);
        };
    }, []);

    const getActiveStreams = useCallback(() => cachedSnapshot.current, []);

    const clearCompletionFallback = useCallback((chatId: string, artifactId: string) => {
        const key = monitorKey(chatId, artifactId);
        const timer = completionFallbackTimersRef.current.get(key);
        if (!timer) return;
        clearTimeout(timer);
        completionFallbackTimersRef.current.delete(key);
    }, []);

    const dropChat = useCallback(
        (chatId: string) => {
            const state = monitoredRef.current.get(chatId);
            if (!state) return;
            for (const artifactId of state.artifacts.keys()) {
                clearCompletionFallback(chatId, artifactId);
            }
            state.wsUnsub?.();
            monitoredRef.current.delete(chatId);
        },
        [clearCompletionFallback],
    );

    const unregister = useCallback(
        (chatId: string, artifactId: string) => {
            const state = monitoredRef.current.get(chatId);
            if (!state) return;
            clearCompletionFallback(chatId, artifactId);
            state.artifacts.delete(artifactId);
            if (state.artifacts.size === 0) dropChat(chatId);
            emit();
        },
        [clearCompletionFallback, dropChat, emit],
    );

    const finalizeArtifact = useCallback(
        async (chatId: string, artifactId: string, updates: ArtifactUpdate, options: { revalidate: boolean }) => {
            const state = monitoredRef.current.get(chatId);
            const artifact = state?.artifacts.get(artifactId);
            if (!state || !artifact || artifact.finalizing) return;

            artifact.finalizing = true;
            clearCompletionFallback(chatId, artifactId);
            const scope = artifactScopeForLocation(state.location);
            artifactStore.updateArtifact(scope, artifactId, updates, artifact.version);
            if (artifact.previousVersion !== undefined) {
                artifactStore.updateArtifact(scope, artifactId, { isUpdating: false }, artifact.previousVersion);
            }

            if (options.revalidate) {
                await revalidateArtifact({
                    artifactId,
                    artifactKey: artifact.artifactKey,
                    version: artifact.version,
                    projectId: state.location.projectId ?? null,
                    scope,
                }).catch(() => {});
            }

            state.artifacts.delete(artifactId);
            if (state.artifacts.size === 0) dropChat(chatId);
            emit();
        },
        [artifactStore, clearCompletionFallback, dropChat, emit, revalidateArtifact],
    );

    const scheduleCompletionFallback = useCallback(
        (chatId: string, artifactId: string) => {
            const key = monitorKey(chatId, artifactId);
            if (completionFallbackTimersRef.current.has(key)) return;

            const timer = setTimeout(() => {
                completionFallbackTimersRef.current.delete(key);
                void finalizeArtifact(
                    chatId,
                    artifactId,
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
                state.location = mergeLocation(state.location, input.location);
            }

            const scope = artifactScopeForLocation(state.location);
            const existingState = state.artifacts.get(input.artifactId);
            const existingArtifact = artifactStore.getArtifact(scope, input.artifactId, input.version);
            const content = existingArtifact?.proposedVersion?.content ?? existingState?.content ?? '';
            const mode = input.mode ?? existingState?.mode ?? 'create';
            const loadedVersion = input.loadedVersion ?? existingState?.loadedVersion;
            const previousVersion =
                input.previousVersion ?? existingState?.previousVersion ?? getPreviousArtifactVersion(input.version);

            state.artifacts.set(input.artifactId, {
                artifactId: input.artifactId,
                artifactKey: input.artifactKey,
                name: input.artifactName,
                version: input.version,
                isInternal: input.isInternal ?? existingState?.isInternal ?? false,
                mode,
                ...(loadedVersion !== undefined ? { loadedVersion } : {}),
                ...(previousVersion !== undefined ? { previousVersion } : {}),
                hasSummary: input.hasSummary ?? existingState?.hasSummary ?? false,
                content,
                summaryContent: existingState?.summaryContent ?? '',
                summaryVersionId: existingState?.summaryVersionId ?? null,
                finalizing: false,
                local: existingState?.local === true || input.source === 'local',
            });
            clearCompletionFallback(input.chatId, input.artifactId);
            emit();
        },
        [artifactStore, clearCompletionFallback, emit],
    );

    const markSummaryStarted = useCallback(
        ({ chatId, artifactId, version }: StreamArtifactTarget) => {
            const state = monitoredRef.current.get(chatId);
            const artifact = state?.artifacts.get(artifactId);
            if (!artifact) return;
            artifact.version = version;
            artifact.previousVersion = getPreviousArtifactVersion(version);
            artifact.hasSummary = true;
            emit();
        },
        [emit],
    );

    const markPreviousVersionUpdating = useCallback(
        async ({
            scope,
            state,
            artifactId,
            artifactKey,
            previousVersion,
        }: {
            scope: ArtifactScope;
            state: MonitorState;
            artifactId: string;
            artifactKey: string;
            previousVersion: number;
        }) => {
            if (!artifactStore.getArtifact(scope, artifactId, previousVersion)) {
                await revalidateArtifact({
                    artifactId,
                    artifactKey,
                    version: previousVersion,
                    projectId: state.location.projectId ?? null,
                    scope,
                }).catch(() => {});
            }
            artifactStore.updateArtifact(scope, artifactId, { isUpdating: true }, previousVersion);
        },
        [artifactStore, revalidateArtifact],
    );

    const takeover = useCallback(
        (chatId: string) => {
            const state = monitoredRef.current.get(chatId);
            if (!state || state.wsUnsub) return;
            const scope = artifactScopeForLocation(state.location);
            for (const [artifactId, artifactState] of state.artifacts) {
                const existing = artifactStore.getArtifact(scope, artifactId, artifactState.version);
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
                current?.artifactId === info?.artifactId &&
                current?.version === info?.version
            ) {
                return;
            }
            viewedRef.current = info;
            emit();
        },
        [emit],
    );

    const setActivationHandler = useCallback(
        (chatId: string | null, handler: ActivationHandler | null) => {
            if (!handler) {
                if (!chatId || activationRef.current?.chatId === chatId) {
                    activationRef.current = null;
                }
                emit();
                return;
            }
            if (!chatId) return;
            activationRef.current = { chatId, handler };
            emit();
        },
        [emit],
    );

    const tryActivate = useCallback(({ chatId, artifactId, artifactKey, version }: StreamArtifactTarget) => {
        const active = activationRef.current;
        if (!active || active.chatId !== chatId) return false;
        active.handler({ artifactId, artifactKey, version });
        return true;
    }, []);

    const handleDocumentStart = useCallback(
        (state: MonitorState, event: Extract<StreamEvent, { type: 'document_start' }>) => {
            const artifactId = event.artifactId;
            const artifactKey = event.name;
            const version = event.pendingVersion;
            const scope = artifactScopeForLocation(state.location);
            const now = new Date().toISOString();
            const mode = event.mode ?? 'create';
            const loadedVersion = event.loadedVersion;
            const previousVersion = getPreviousArtifactVersion(version);
            const baseVersion = loadedVersion ?? previousVersion ?? 1;
            const existingArtifact = artifactStore.getArtifact(scope, artifactId, baseVersion);
            const loadedContent =
                event.isInternal === true
                    ? ''
                    : (event.loadedContent ??
                      existingArtifact?.proposedVersion?.content ??
                      existingArtifact?.currentVersion?.content ??
                      '');
            const draftContent = mode === 'replace' ? '' : loadedContent;

            state.artifacts.set(artifactId, {
                artifactId,
                artifactKey,
                name: event.title ?? artifactKey,
                version,
                isInternal: event.isInternal === true,
                mode,
                ...(loadedVersion !== undefined ? { loadedVersion } : {}),
                ...(previousVersion !== undefined ? { previousVersion } : {}),
                hasSummary: false,
                content: draftContent,
                summaryContent: '',
                summaryVersionId: null,
                finalizing: false,
                local: state.artifacts.get(artifactId)?.local === true,
            });

            if ((mode === 'edit' || mode === 'replace') && previousVersion !== undefined) {
                void markPreviousVersionUpdating({ scope, state, artifactId, artifactKey, previousVersion });
            }

            artifactStore.addArtifact(
                scope,
                {
                    id: artifactId,
                    key: artifactKey,
                    version,
                    ...(mode === 'edit' || mode === 'replace'
                        ? {
                              currentVersion: {
                                  id: '',
                                  version: baseVersion,
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
        [artifactStore, emit, markPreviousVersionUpdating],
    );

    const handleDocumentEvent = useCallback(
        (target: MonitorState, event: StreamEvent) => {
            const scope = artifactScopeForLocation(target.location);

            switch (event.type) {
                case 'document_start':
                    handleDocumentStart(target, event);
                    break;
                case 'document_delta': {
                    const artifact = target.artifacts.get(event.artifactId);
                    if (!artifact) break;
                    artifact.content += event.content;
                    artifactStore.updateArtifact(
                        scope,
                        artifact.artifactId,
                        { proposedVersion: { content: artifact.content }, isStreaming: true, isUpdating: false },
                        artifact.version,
                    );
                    break;
                }
                case 'document_edit': {
                    const artifact = target.artifacts.get(event.artifactId);
                    if (!artifact) break;
                    artifact.content = applyEdits(artifact.content, event.edits);
                    artifactStore.updateArtifact(
                        scope,
                        artifact.artifactId,
                        { proposedVersion: { content: artifact.content }, isUpdating: false, isStreaming: false },
                        artifact.version,
                    );
                    void revalidateArtifact({
                        artifactId: artifact.artifactId,
                        artifactKey: artifact.artifactKey,
                        version: artifact.version,
                        projectId: target.location.projectId ?? null,
                        scope,
                    }).catch(() => {});
                    break;
                }
                case 'document_progress': {
                    const artifact = target.artifacts.get(event.artifactId);
                    if (!artifact) break;
                    artifactStore.updateArtifact(
                        scope,
                        artifact.artifactId,
                        { progress: event.progress },
                        artifact.version,
                    );
                    break;
                }
                case 'summary_start': {
                    const artifact = target.artifacts.get(event.artifactId);
                    if (!artifact) break;
                    artifact.summaryContent = '';
                    artifact.summaryVersionId = event.versionId;
                    artifact.hasSummary = true;
                    artifact.version = event.version;
                    artifactStore.updateArtifact(
                        scope,
                        artifact.artifactId,
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
                    const artifact = target.artifacts.get(event.artifactId);
                    if (!artifact || artifact.summaryVersionId !== event.versionId) break;
                    artifact.summaryContent += event.content;
                    artifactStore.updateArtifact(
                        scope,
                        artifact.artifactId,
                        {
                            summaryStreaming: artifact.summaryContent,
                            proposedVersion: { summaryInternal: artifact.summaryContent },
                        },
                        event.version,
                    );
                    break;
                }
                case 'summary_complete': {
                    const artifact = target.artifacts.get(event.artifactId);
                    if (!artifact || artifact.summaryVersionId !== event.versionId) break;
                    artifact.summaryContent = event.content;
                    artifact.summaryVersionId = null;
                    artifactStore.updateArtifact(
                        scope,
                        artifact.artifactId,
                        {
                            summaryStreaming: event.content,
                            isSummaryStreaming: false,
                            isStreaming: false,
                            proposedVersion: { summaryInternal: event.content },
                        },
                        event.version,
                    );
                    void revalidateArtifact({
                        artifactId: artifact.artifactId,
                        artifactKey: artifact.artifactKey,
                        version: event.version,
                        projectId: target.location.projectId ?? null,
                        scope,
                    }).catch(() => {});
                    break;
                }
                case 'document_complete': {
                    const artifact = target.artifacts.get(event.artifactId);
                    if (!artifact) break;
                    if (event.action === 'aborted' || event.status === 'aborted') {
                        void finalizeArtifact(
                            target.chatId,
                            artifact.artifactId,
                            { isStreaming: false, isUpdating: false, progress: 0 },
                            { revalidate: false },
                        );
                        break;
                    }
                    void finalizeArtifact(
                        target.chatId,
                        artifact.artifactId,
                        {
                            isStreaming: false,
                            isUpdating: false,
                            progress: 100,
                            version: artifact.version,
                            proposedVersion: { version: artifact.version, status: event.status ?? 'proposed' },
                        },
                        { revalidate: true },
                    );
                    break;
                }
                case 'error':
                case 'safety_retract':
                    for (const artifactId of target.artifacts.keys()) {
                        void finalizeArtifact(
                            target.chatId,
                            artifactId,
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
            for (const artifactId of target.artifacts.keys()) {
                void finalizeArtifact(
                    target.chatId,
                    artifactId,
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
                            projectName: data.projectName ?? null,
                            phaseName: data.phaseName ?? null,
                            phaseIndex: data.phaseIndex ?? null,
                        },
                        artifactId: data.artifactId,
                        artifactKey: data.artifactKey,
                        artifactName: data.artifactName,
                        version: data.version,
                        ...(data.isInternal !== undefined ? { isInternal: data.isInternal } : {}),
                        ...(data.mode ? { mode: data.mode } : {}),
                        ...(data.loadedVersion !== undefined ? { loadedVersion: data.loadedVersion } : {}),
                    });
                    return;
                }

                if (eventType !== UserEventType.ArtifactStreamCompleted) return;
                const data = payload as ArtifactStreamCompletedPayload;
                const state = monitoredRef.current.get(data.chatId);
                const artifact = state?.artifacts.get(data.artifactId);
                if (state?.wsUnsub || artifact?.local) {
                    scheduleCompletionFallback(data.chatId, data.artifactId);
                    return;
                }
                unregister(data.chatId, data.artifactId);
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
        markSummaryStarted,
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

function computeSnapshot(
    monitored: Map<string, MonitorState>,
    viewed: ViewedArtifact,
    activeChatId: string | null,
): ActiveArtifactStream[] {
    const all: ActiveArtifactStream[] = [];
    for (const state of monitored.values()) {
        for (const [artifactId, artifactState] of state.artifacts.entries()) {
            const isMountedInternalStream =
                artifactState.isInternal && (activeChatId === state.chatId || (artifactState.local && !state.wsUnsub));
            if (isMountedInternalStream) {
                continue;
            }

            const previewTarget = getPreviewTarget(artifactState);
            const entryProjectId = state.location.projectId ?? null;
            if (
                previewTarget &&
                viewed &&
                viewed.projectId === entryProjectId &&
                viewed.artifactId === previewTarget.artifactId &&
                viewed.version === previewTarget.version
            ) {
                continue;
            }
            all.push({
                chatId: state.chatId,
                artifactId,
                artifactKey: artifactState.artifactKey,
                artifactName: artifactState.name,
                version: artifactState.version,
                isInternal: artifactState.isInternal,
                mode: artifactState.mode,
                ...(artifactState.previousVersion !== undefined
                    ? { previousVersion: artifactState.previousVersion }
                    : {}),
                hasSummary: artifactState.hasSummary,
                previewTarget,
                location: state.location,
            });
        }
    }
    return all;
}

function getPreviewTarget(artifactState: MonitoredArtifact): ActiveArtifactPreviewTarget | null {
    if (!artifactState.isInternal || artifactState.hasSummary) {
        return {
            artifactId: artifactState.artifactId,
            artifactKey: artifactState.artifactKey,
            version: artifactState.version,
        };
    }

    if (
        (artifactState.mode === 'edit' || artifactState.mode === 'replace') &&
        artifactState.previousVersion !== undefined
    ) {
        return {
            artifactId: artifactState.artifactId,
            artifactKey: artifactState.artifactKey,
            version: artifactState.previousVersion,
        };
    }

    return null;
}
