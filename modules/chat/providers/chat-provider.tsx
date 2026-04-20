'use client';

import { useAuth } from '@clerk/nextjs';
import camelcaseKeys from 'camelcase-keys';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { unstable_serialize, useSWRConfig } from 'swr';
import { v4 as uuidv4 } from 'uuid';
import { capturePostHogEvent } from '@/lib/analytics/posthog-browser';
import { type ApiClient, createApiClient } from '@/lib/api/client';
import { insertChatToCache } from '@/lib/api/client/cache/chats';
import { chatKeys } from '@/lib/api/client/fetchers/chats';
import { serializeProjectArtifactListKey } from '@/lib/api/client/fetchers/project-artifacts';
import { projectKeys } from '@/lib/api/client/fetchers/projects';
import type { CamelCaseDto } from '@/lib/api/client/types';
import { abort, associateUploads, sendAction, sendIntakeAction, summarize } from '@/lib/api/requests/worker/chat';
import type { ChatMessageDto } from '@/lib/schema/message';
import type { StreamEvent, StreamStatus } from '@/lib/schema/stream';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/storage/local-storage';
import { getDraftBaseKey } from '@/lib/storage/storage-keys';
import { useArtifactProcessing } from '@/modules/artifacts/processing/artifact-processing-provider';
import { useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import { getLatestArtifactVersion } from '@/modules/artifacts/utils';
import { intakeConfigMap } from '@/modules/chat/constants';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useModelSelection } from '@/modules/chat/providers/model-selection-provider';
import { useOptionalProjectOrigin } from '@/modules/intake/providers/project-origin-provider';
import { useChatStream } from '../hooks/use-chat-stream';
import type { ToolDocumentDecision } from '../hooks/use-stream';
import { useStream } from '../hooks/use-stream';
import { useUserEvents } from '../hooks/use-user-events';
import type { ChatState, ChatType, Message, PaginationState, StreamBlock, SummaryStatus } from '../types';
import { pickDisplaySafeMessageMetadata } from '../utils/message-metadata';

export type BaseChatContextValue = {
    state: ChatState;
    /** API client for chat operations */
    api: ApiClient;
    /** Chat type */
    chatType: ChatType;
    /** Current chat ID */
    chatId: string | null;
    /** Pagination state for infinite scroll */
    pagination: PaginationState;
    /** Load messages from API for a chat */
    loadMessages: () => Promise<void>;
    /** Load more (older) messages for infinite scroll */
    loadMoreMessages: () => Promise<void>;
    /** Send a message - creates chat if needed, handles streaming */
    sendMessage: (
        content: string,
        opts?: {
            resolvedChatId?: string;
            stagedArtifactIds?: string[];
            imageFileIds?: string[];
            uploadsAlreadyAssociated?: boolean;
        },
    ) => Promise<void>;
    /** Ensure staged uploads are associated to a real chat before waiting on processing. */
    prepareUploadsForSend: (opts?: { stagedArtifactIds?: string[]; imageFileIds?: string[] }) => Promise<string>;
    /** Send a nudge (message: null) to trigger generation on last injected system event */
    sendNudge: () => Promise<void>;
    /** Stop the current generation */
    stopGeneration: () => void;
    /** Set the current chat ID */
    setChatId: (chatId: string | null) => void;
    /** Summarize the current chat and prepare the new phase */
    summarizeChat: () => void;
    /** Cancel an in-progress summarization */
    cancelSummary: () => void;
    /** Navigate to the new phase chat (after summarization completes) */
    navigateToNewPhase: () => void;
    /** Set hasPendingChanges to false (call after approve/reject) */
    clearPendingChanges: () => void;
    /** Clear the pending phase transition flag (called after dialog handles it) */
    clearPendingPhaseTransition: () => void;
    /** Check if there are other pending artifacts */
    hasOtherPendingArtifacts: (excludeArtifactKey: string) => boolean;
    /** Set artifact action processing state (approve/reject in flight) */
    setProcessingArtifactAction: (isProcessing: boolean) => void;
    /** Change the chat's model — persists to DB via API when chatId exists, otherwise local-only */
    changeModel: (presetId: string) => Promise<void>;
    /** Dismiss the invalid model alert dialog */
    dismissInvalidModelAlert: () => void;
    /** Lazily create the chat if it doesn't exist yet, returns the chatId */
    ensureChatId: () => Promise<string>;
};

type PhaseChatContextValue = BaseChatContextValue & {
    chatType: 'phase';
    projectId: string;
};

type CompanyStakeholderChatContextValue = BaseChatContextValue & {
    chatType: 'company' | 'stakeholder';
    projectId?: never;
};

type ChatContextValue<TChatType extends ChatType> = TChatType extends 'phase'
    ? PhaseChatContextValue
    : CompanyStakeholderChatContextValue;

const ChatContext = createContext<ChatContextValue<ChatType> | null>(null);

type ChatProviderProps = {
    children: ReactNode;
    /** Project ID for API calls (required for phase chats, omit for intake) */
    projectId?: string;
    /** Chat type */
    chatType: ChatType;
    /** Initial chat ID (optional - will create on first message if not provided) */
    initialChatId?: string;
    /** Initial messages to display */
    initialMessages?: Message[];
    /** Optional route builder used after creating a new chat */
    chatRouteBuilder?: (chatId: string) => string;
};

function buildContextValue(
    chatType: ChatType,
    projectId: string | undefined,
    base: Omit<BaseChatContextValue, 'chatType'>,
): ChatContextValue<ChatType> {
    return chatType === 'phase' ? { ...base, chatType, projectId: projectId! } : { ...base, chatType };
}

/** Create a user message with a single text block */
function createUserMessage(content: string): Message {
    const id = uuidv4();
    return {
        id,
        tempId: id,
        role: 'user',
        blocks: [{ id: `text-${id}`, type: 'text', content }],
        createdAt: new Date(),
    };
}

type ArtifactVersionEventPayload = {
    artifactId?: string;
    artifactName?: string;
    versionId?: string;
    version?: number;
    action?: string;
    previousStatus?: string;
    status?: string;
    nextStatus?: 'approved' | 'rejected';
    chatId?: string;
};

export function ChatProvider({
    children,
    projectId,
    chatType,
    initialChatId,
    initialMessages = [],
    chatRouteBuilder,
}: ChatProviderProps) {
    const artifactContext = useArtifactActions();
    const { hasPendingNudge, clearPendingNudge } = useArtifactProcessing();

    const { openPanel, closePanel, panelState } = useActivePanelContext();
    const panelStateRef = useRef(panelState);
    panelStateRef.current = panelState;
    const { getToken } = useAuth();
    const { isProjectFlow, handleApprovedArtifact } = useOptionalProjectOrigin();

    const { mutate: globalMutate, cache, fallback } = useSWRConfig();
    const router = useRouter();
    const chatCreationPromiseRef = useRef<Promise<string> | null>(null);

    // Create API client with auth
    const api = useMemo(() => createApiClient(getToken), [getToken]);

    // Chat ID state
    const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
    const { selectedModel, setSelectedModel, persistSelection, isModelAvailable, setIsChangingModel } =
        useModelSelection();
    const skipNextLoad = useRef(false);

    const captureChatAnalytics = useCallback(
        (event: string, properties: Record<string, string | number | boolean | null | undefined> = {}) => {
            capturePostHogEvent(event, {
                chat_type: chatType,
                project_id: projectId ?? null,
                chat_id: chatId ?? null,
                model: selectedModel ?? null,
                ...properties,
            });
        },
        [chatId, chatType, projectId, selectedModel],
    );

    // Chat state — seed from SWR cache if chat was prefetched server-side
    const [state, setState] = useState<ChatState>(() => {
        const cached = initialChatId ? fallback?.[unstable_serialize(chatKeys.detail(initialChatId))] : undefined;

        return {
            messages: initialMessages,
            isGenerating: false,
            isSummarizing: false,
            isLoading: !!initialChatId,
            error: null,
            streamingMessageId: null,
            tokenUsage: cached?.tokenUsage ?? null,
            totalCost: cached?.totalCost ?? null,
            hasPendingChanges: cached?.hasPendingChanges ?? false,
            phaseIndex: cached?.phaseIndex ?? null,
            phaseName: cached?.name ?? null,
            summaryNewChatId: null,
            pendingPhaseTransition: false,
            activeResponseId: null,
            summaryStatus: null,
            isProcessingArtifactAction: false,
            showInvalidModelAlert: false,
            completionBriefStatus: cached?.completionBriefStatus ?? null,
        };
    });

    const buildChatRoute = useCallback(
        (nextChatId: string) => {
            if (chatRouteBuilder) {
                return chatRouteBuilder(nextChatId);
            }

            if (chatType === 'phase') {
                if (!projectId) throw new Error('Project ID is required for phase chats');
                return `/${projectId}/${nextChatId}`;
            }

            return `/${chatType === 'company' ? 'companies' : 'stakeholders'}/${nextChatId}`;
        },
        [chatRouteBuilder, chatType, projectId],
    );

    // Pagination state for infinite scroll
    const [pagination, setPagination] = useState<PaginationState>({
        page: 1,
        totalPages: 1,
        isLoadingMore: false,
        hasMore: false,
    });

    // Forward ref for reconnect handler (loadMessages is defined later)
    const loadMessagesRef = useRef<() => void>(() => {});

    // NOTE: When ensureChatId creates a chat, chatId changes from null → id,
    // which flips isEmpty in ChatPanel and remounts ChatMessageForm.
    // migrateDraft bridges the localStorage draft to the new chatId-scoped key
    // so the remounted form picks it up via useChatDraft.
    const migrateDraft = useCallback(
        (nextChatId: string) => {
            const oldKey = getDraftBaseKey(chatType, null, projectId);
            const newKey = getDraftBaseKey(chatType, nextChatId, projectId);
            const draft = safeGetItem(oldKey);
            if (draft) {
                safeSetItem(newKey, draft);
                safeRemoveItem(oldKey);
            }
        },
        [chatType, projectId],
    );

    const ensureChatId = useCallback(async () => {
        if (chatId) return chatId;
        if (chatCreationPromiseRef.current) return chatCreationPromiseRef.current;

        const createChatPromise = (async () => {
            if (chatType === 'phase') {
                if (!projectId) {
                    throw new Error('Project ID is required for phase chats');
                }

                const newChat = await api.chats.create(projectId);
                const nextChatId = newChat.id;

                skipNextLoad.current = true;
                migrateDraft(nextChatId);
                setChatId(nextChatId);
                setState((prev) => ({ ...prev, phaseIndex: newChat.phaseIndex }));

                window.history.replaceState(null, '', buildChatRoute(nextChatId));
                insertChatToCache(cache, globalMutate, projectId, newChat);

                return nextChatId;
            }

            const newChat = await api.chats.createIntake({
                framework: intakeConfigMap[chatType].framework,
                category: intakeConfigMap[chatType].category,
            });
            const nextChatId = newChat.id;

            skipNextLoad.current = true;
            migrateDraft(nextChatId);
            setChatId(nextChatId);
            window.history.replaceState(null, '', buildChatRoute(nextChatId));

            return nextChatId;
        })();

        chatCreationPromiseRef.current = createChatPromise;

        try {
            return await createChatPromise;
        } finally {
            chatCreationPromiseRef.current = null;
        }
    }, [api.chats, buildChatRoute, cache, chatId, chatType, globalMutate, migrateDraft, projectId]);

    // ========================================================================
    // CALLBACKS FOR STREAM HOOK
    // ========================================================================

    const revalidateArtifactByKeyAndVersion = useCallback(
        async (keyId: string, version: number) => {
            if (projectId) {
                globalMutate(serializeProjectArtifactListKey(projectId));
            }

            const fetcher = projectId
                ? (v: number) => api.projectArtifacts.getByKey(projectId, keyId, v)
                : (v: number) => api.artifacts.getByKey(keyId, v);

            try {
                const allVersions = Array.from({ length: version }, (_, i) => version - i);
                const results = await Promise.all(allVersions.map((v) => fetcher(v).catch(() => null)));

                for (const data of results) {
                    if (data) {
                        artifactContext.updateArtifact(
                            keyId,
                            { ...data, id: keyId, key: data.key || keyId },
                            getLatestArtifactVersion(data)?.version,
                            { merge: false },
                        );
                    }
                }
            } catch {
                // SWR revalidation will still keep the list up to date
            }
        },
        [globalMutate, projectId, artifactContext, api.projectArtifacts, api.artifacts],
    );

    const onDocumentStart = useCallback(() => {
        setState((prev) => ({ ...prev, hasPendingChanges: true }));
    }, []);

    const clearPendingChanges = useCallback(() => {
        setState((prev) => ({ ...prev, hasPendingChanges: false }));
    }, []);

    const clearPendingPhaseTransition = useCallback(() => {
        setState((prev) => ({ ...prev, pendingPhaseTransition: false }));
    }, []);

    const hasOtherPendingArtifacts = useCallback(
        (excludeArtifactKey: string) => {
            return Object.values(artifactContext.getStore()).some((versions) =>
                Object.values(versions as Record<string, any>).some(
                    (artifact) =>
                        artifact.key !== excludeArtifactKey && artifact.proposedVersion?.status === 'proposed',
                ),
            );
        },
        [artifactContext],
    );

    const setProcessingArtifactAction = useCallback((isProcessing: boolean) => {
        setState((prev) => ({ ...prev, isProcessingArtifactAction: isProcessing }));
    }, []);

    const onTerminalTool = useCallback((toolName: string) => {
        if (toolName === 'generate_summary') {
            setState((prev) => ({ ...prev, pendingPhaseTransition: true }));
        }
    }, []);

    const handleArtifactOpen = useCallback(
        (artifactId: string, version: number) => {
            if (state.isSummarizing) return;
            openPanel({ panel: 'artifact-preview', artifactId, version });
        },
        [openPanel, state.isSummarizing],
    );

    const fetchArtifact = useCallback(
        async (artifactKey: string, version: number) => {
            try {
                const artifact = projectId
                    ? await api.projectArtifacts.getByKey(projectId, artifactKey, version)
                    : await api.artifacts.getByKey(artifactKey, version);
                if (artifact) {
                    artifactContext.addArtifact(
                        {
                            ...artifact,
                            id: artifactKey,
                            key: artifact.key,
                        },
                        version,
                    );
                }
                return artifact;
            } catch (error) {
                console.error('Failed to fetch artifact:', error);
                return null;
            }
        },
        [api.artifacts, api.projectArtifacts, projectId, artifactContext],
    );

    const handleToolDocumentDecision = useCallback(
        async ({ action, artifactKey, version }: ToolDocumentDecision) => {
            const artifact = await fetchArtifact(artifactKey, version);

            if (!hasOtherPendingArtifacts(artifactKey)) {
                clearPendingChanges();
            }

            if (action !== 'approve' || chatType === 'phase' || !isProjectFlow) {
                return;
            }

            if (!artifact) {
                console.error('[chat-provider] approved artifact could not be fetched for project return flow');
                return;
            }

            await handleApprovedArtifact({ id: artifact.id, key: artifact.key });
        },
        [chatType, clearPendingChanges, fetchArtifact, handleApprovedArtifact, hasOtherPendingArtifacts, isProjectFlow],
    );

    /** Convert API message to internal Message format */
    const mapApiMessage = useCallback(
        (m: CamelCaseDto<ChatMessageDto>, activeAgentMessageId?: string | null): Message => {
            // Detect system event messages injected by backend (e.g. artifact approved via UI)
            const meta = (m.metadata ?? {}) as Record<string, unknown>;
            const systemEventType = meta.systemEvent as string | undefined;

            // Detect safety-retracted messages persisted by finalizeSafetyMonitor:
            // 1. metadata.safetyAnalysis.leaked (always set by finalizeSafetyMonitor)
            // 2. fallback: content marker + empty blocks
            const isRetracted =
                m.role === 'assistant' &&
                ((meta as Record<string, any>).safetyAnalysis?.leaked === true ||
                    ((!m.blocks || m.blocks.length === 0) &&
                        m.content === '[omitted due to security/policy violation]'));

            // LEGACY: fallback for old messages with content but no blocks (remove after DB nuke)
            const blocks: StreamBlock[] = isRetracted
                ? []
                : m.blocks && m.blocks.length > 0
                  ? (m.blocks as StreamBlock[])
                  : m.content
                    ? [{ id: m.id, type: 'text' as const, content: m.content }]
                    : [];
            return {
                id: m.id,
                role: m.role as 'user' | 'assistant',
                blocks,
                isStreaming: activeAgentMessageId === m.id,
                ...(m.isError && { isError: true }),
                ...(m.isAborted && { isAborted: true }),
                ...(isRetracted && { isRetracted: true }),
                ...(systemEventType && {
                    systemEvent: {
                        type: systemEventType,
                        artifactKey: meta.artifactKey as string | undefined,
                        versionNumber: meta.versionNumber as number | undefined,
                        reason: meta.reason as string | undefined,
                    },
                }),
                feedbackScore: (m as any).feedback_score ?? null,
                feedbackComment: (m as any).feedback ?? null,
                // Only forward display-safe fields — metadata can contain safetyAnalysis, etc.
                metadata: pickDisplaySafeMessageMetadata(meta),
            };
        },
        [],
    );

    const handleStreamStarted = useCallback(
        (agentMessageId: string, userMessageId: string, tempId?: string, streamType?: 'chat' | 'summary') => {
            captureChatAnalytics('chat_stream_started', {
                agent_message_id: agentMessageId,
                user_message_id: userMessageId || null,
                submission_id: tempId ?? userMessageId ?? null,
                stream_type: streamType ?? 'chat',
            });

            if (streamType === 'summary') {
                // Summary stream arrived on existing chat: subscription — enter summarize mode
                setState((prev) => ({
                    ...prev,
                    isSummarizing: true,
                    summaryNewChatId: null,
                    summaryStatus: null,
                }));
            } else {
                // Normal chat response — reconcile user message ID and set generating state
                setState((prev) => {
                    const messages = prev.messages.map((m) =>
                        m.id === userMessageId || m.tempId === userMessageId
                            ? { ...m, id: userMessageId, tempId: m.tempId || m.id }
                            : m.isStreaming && m.id !== agentMessageId
                              ? { ...m, isStreaming: false, status: undefined }
                              : m,
                    );
                    return { ...prev, isGenerating: true, activeResponseId: agentMessageId, messages };
                });
            }
        },
        [captureChatAnalytics],
    );

    const handleMessageCreated = useCallback(
        (apiMessage: unknown, tempId?: string) => {
            const camelMessage = camelcaseKeys(apiMessage as Record<string, unknown>, {
                deep: true,
            }) as CamelCaseDto<ChatMessageDto>;
            const mapped = mapApiMessage(camelMessage, null);
            setState((prev) => {
                const existingIdx = prev.messages.findIndex(
                    (m) =>
                        m.id === mapped.id ||
                        m.tempId === mapped.id ||
                        (tempId && (m.id === tempId || m.tempId === tempId)),
                );

                if (existingIdx !== -1) {
                    const next = [...prev.messages];
                    next[existingIdx] = { ...mapped, tempId: next[existingIdx].tempId || tempId };
                    return { ...prev, messages: next };
                }

                // Insert before any streaming message to maintain chronological order
                // (e.g. system event arriving via WS while AI response is already streaming)
                const streamingIdx = prev.messages.findIndex((m) => m.isStreaming);
                if (streamingIdx !== -1) {
                    const next = [...prev.messages];
                    next.splice(streamingIdx, 0, { ...mapped, tempId });
                    return { ...prev, messages: next };
                }

                return {
                    ...prev,
                    messages: [...prev.messages, { ...mapped, tempId }],
                };
            });
        },
        [mapApiMessage],
    );

    const handleStreamDone = useCallback(
        (
            status: StreamStatus,
            terminalEvent?: StreamEvent & { type: 'done' | 'done_ext' },
            completedAgentMessageId?: string,
        ) => {
            // Summary was cancelled — ignore any terminal events from the backend
            if (summaryCancelledRef.current) {
                summaryCancelledRef.current = false;
                summarizeInFlightRef.current = false;
                return;
            }

            const isNormalDone = terminalEvent?.type === 'done';
            const newChatId = isNormalDone ? terminalEvent.newChatId : undefined;

            if (newChatId) {
                // Summary stream completed — store the new chat ID and exit summarizing mode
                summarizeInFlightRef.current = false;
                setState((prev) => ({
                    ...prev,
                    isSummarizing: false,
                    summaryNewChatId: newChatId,
                    summaryStatus: null,
                }));
                return;
            }

            // Summary stream aborted/errored without producing a new chat — reset summary state.
            // This handles cross-tab sync: Tab A cancels, Tab B receives the terminal status.
            // Note: handleStreamDone has [] deps, so we read isSummarizing via prev in setState.
            let wasSummary = false;
            setState((prev) => {
                if (!prev.isSummarizing) return prev;
                wasSummary = true;
                summarizeInFlightRef.current = false;
                return {
                    ...prev,
                    isSummarizing: false,
                    summaryStatus: null,
                    summaryNewChatId: null,
                    error: null,
                };
            });
            if (wasSummary) return;

            // Extract safe message metadata from done event (display-safe only)
            const doneMeta = isNormalDone
                ? (terminalEvent.messageMetadata as Record<string, unknown> | undefined)
                : undefined;
            const doneMessageMetadata = pickDisplaySafeMessageMetadata(doneMeta);
            const hasTerminalError = status === 'error' || Boolean(isNormalDone && terminalEvent.error);

            setState((prev) => {
                const targetMessageId = completedAgentMessageId ?? prev.activeResponseId;
                const isCurrentActiveStream = !!targetMessageId && prev.activeResponseId === targetMessageId;

                return {
                    ...prev,
                    isGenerating: isCurrentActiveStream ? false : prev.isGenerating,
                    activeResponseId: isCurrentActiveStream ? null : prev.activeResponseId,
                    tokenUsage: isNormalDone ? (terminalEvent.tokenUsage ?? prev.tokenUsage) : prev.tokenUsage,
                    totalCost: isNormalDone ? (terminalEvent.totalCost ?? prev.totalCost) : prev.totalCost,
                    hasPendingChanges: isNormalDone
                        ? (terminalEvent.hasPendingChanges ?? prev.hasPendingChanges)
                        : prev.hasPendingChanges,
                    phaseIndex: isNormalDone ? (terminalEvent.phaseIndex ?? prev.phaseIndex) : prev.phaseIndex,
                    messages: prev.messages.map((msg) =>
                        msg.id === targetMessageId
                            ? {
                                  ...msg,
                                  isStreaming: false,
                                  status: undefined,
                                  ...(hasTerminalError && { isError: true }),
                                  ...(status === 'aborted' && !msg.isRetracted && { isAborted: true }),
                                  ...(doneMessageMetadata &&
                                      Object.keys(doneMessageMetadata).length > 0 && { metadata: doneMessageMetadata }),
                              }
                            : msg,
                    ),
                };
            });
        },
        [],
    );

    // ========================================================================
    // WEBSOCKET STREAM HOOK (replaces SSE useStreamReader)
    // ========================================================================

    // Both hooks called unconditionally (React rules). The inactive one receives
    // null as chatId and is a no-op inside useStream's effect.
    const streamOpts = {
        artifactContext,
        onReconnect: () => loadMessagesRef.current(),
        onDone: handleStreamDone,
        onDocumentStart,
        onArtifactOpen: handleArtifactOpen,
        fetchArtifact,
        revalidateArtifact: revalidateArtifactByKeyAndVersion,
        onStreamStarted: handleStreamStarted,
        onTerminalTool,
        onMessageCreated: handleMessageCreated,
        onToolDocumentDecision: handleToolDocumentDecision,
        // Clear stale isGenerating/isSummarizing set from DB's active_agent_message_id
        // when the initial WS subscribe_response confirms no active stream.
        // Also sync selectedModel from the subscribe response.
        onSubscribeResponse: (
            status: 'idle' | 'streaming' | 'stale',
            selectedModel: string | null,
            completionBriefStatus: string | null,
        ) => {
            if (selectedModel) {
                setSelectedModel(selectedModel);
            }
            setState((prev) => {
                const next = { ...prev, completionBriefStatus };
                if (status === 'idle' && (prev.isGenerating || prev.isSummarizing)) {
                    summarizeInFlightRef.current = false;
                    next.isGenerating = false;
                    next.isSummarizing = false;
                    next.activeResponseId = null;
                }
                return next;
            });
        },
        onModelChanged: (model: string) => {
            setSelectedModel(model);
        },
        onCbStatusChanged: (cbStatus: string) => {
            setState((prev) => ({ ...prev, completionBriefStatus: cbStatus }));
        },
    };

    const chatStream = useChatStream(chatType === 'phase' ? chatId : null, streamOpts);
    const intakeStream = useStream('intake', chatType !== 'phase' ? chatId : null, streamOpts);

    // Route to the active stream based on chat type
    const stream = chatType === 'phase' ? chatStream : intakeStream;

    const resolveStoredArtifactKeyById = useCallback(
        (payload: ArtifactVersionEventPayload): string | null => {
            if (!payload.artifactId) return null;

            for (const [storedKey, versions] of Object.entries(artifactContext.getStore())) {
                for (const artifact of Object.values(versions)) {
                    if (artifact.id === payload.artifactId) {
                        return artifact.key || storedKey;
                    }
                }
            }

            return null;
        },
        [artifactContext],
    );

    const upsertSyncedArtifact = useCallback(
        (
            artifactFromApi: Awaited<ReturnType<typeof api.artifacts.getByKey>>,
            fallbackKey?: string,
            fallbackVersion?: number,
        ) => {
            const artifactKey = artifactFromApi.key || fallbackKey;
            if (!artifactKey) return;

            const version = fallbackVersion ?? getLatestArtifactVersion(artifactFromApi)?.version;
            if (version === undefined) return;

            const nextArtifact = {
                ...artifactFromApi,
                id: artifactKey,
                key: artifactKey,
            };

            if (artifactContext.getArtifact(artifactKey, version)) {
                artifactContext.updateArtifact(artifactKey, nextArtifact, version, { merge: false });
            } else {
                artifactContext.addArtifact(nextArtifact, version);
            }
        },
        [artifactContext],
    );

    useUserEvents(
        useCallback(
            (eventType, payload) => {
                if (eventType !== 'artifact_version_updated' && eventType !== 'artifact_version_update_started') return;
                if (!payload || typeof payload !== 'object') return;

                const eventPayload = payload as ArtifactVersionEventPayload;
                const artifactKey = eventPayload.artifactName || resolveStoredArtifactKeyById(eventPayload);
                const requestedVersion = typeof eventPayload.version === 'number' ? eventPayload.version : undefined;

                if (eventType === 'artifact_version_update_started') {
                    if (!artifactKey || requestedVersion === undefined) return;
                    if (!artifactContext.getArtifact(artifactKey, requestedVersion)) return;
                    artifactContext.updateArtifact(artifactKey, { isUpdating: true }, requestedVersion);
                    return;
                }

                if (artifactKey) {
                    const sync = projectId
                        ? api.projectArtifacts.getByKey(projectId, artifactKey, requestedVersion)
                        : api.artifacts.getByKey(artifactKey, requestedVersion);

                    void sync
                        .then((artifact) => upsertSyncedArtifact(artifact, artifactKey, requestedVersion))
                        .catch(() => {
                            if (requestedVersion !== undefined) {
                                artifactContext.updateArtifact(artifactKey, { isUpdating: false }, requestedVersion);
                            }
                        });
                    return;
                }

                // Backward compatibility for older payload shape that only carries artifactId.
                if (projectId && eventPayload.artifactId) {
                    void api.projectArtifacts
                        .get(projectId, eventPayload.artifactId)
                        .then((artifact) => upsertSyncedArtifact(artifact, artifact.key, requestedVersion))
                        .catch(() => {
                            // Can't clear isUpdating here — we don't have the artifact key.
                        });
                }
            },
            [
                api.artifacts,
                api.projectArtifacts,
                artifactContext,
                projectId,
                resolveStoredArtifactKeyById,
                upsertSyncedArtifact,
            ],
        ),
    );

    const cleanupTransientArtifacts = useCallback(
        (docs: Array<{ name: string; pendingVersion: number }>) => {
            if (docs.length === 0) return;

            const transientVersions = new Set(docs.map((d) => `${d.name}:${d.pendingVersion}`));
            for (const doc of docs) {
                artifactContext.removeArtifact(doc.name, doc.pendingVersion);
            }

            const currentPanel = panelStateRef.current;
            if (
                currentPanel?.panel === 'artifact-preview' &&
                transientVersions.has(`${currentPanel.artifactId}:${currentPanel.version}`)
            ) {
                closePanel();
            }
        },
        [artifactContext, closePanel],
    );

    // If stream aborts or is retracted (safety_retract), remove transient unsaved artifacts.
    useEffect(() => {
        if (stream.status !== 'aborted' && !stream.isRetracted) return;
        cleanupTransientArtifacts(stream.activeDocuments);
    }, [stream.status, stream.isRetracted, stream.activeDocuments, cleanupTransientArtifacts]);

    // Ref to latest stream values so rAF callbacks read fresh data
    const streamRef = useRef(stream);
    streamRef.current = stream;
    const syncRaf = useRef(0);

    // Sync stream blocks → state.messages (streaming assistant message).
    // Uses rAF coalescing so rapid WS-driven dependency changes produce at most
    // one setState per animation frame (~16ms), avoiding double-renders.
    // Terminal transitions (done/error/aborted) flush immediately for consistency.
    useEffect(() => {
        if (!stream.agentMessageId) return;
        if (stream.streamType === 'summary') return;

        const isActive = stream.status === 'streaming';
        const isTerminal = stream.status === 'done' || stream.status === 'error' || stream.status === 'aborted';
        if (!isActive && !isTerminal) return;

        const syncToMessages = (s: typeof stream) => {
            const active = s.status === 'streaming';
            setState((prev) => {
                const msgId = s.agentMessageId!;
                const existing = prev.messages.find((m) => m.id === msgId);
                const hasErrorState = s.status === 'error' || !!s.error || !!existing?.isError;
                const streamMsg: Message = {
                    id: msgId,
                    role: 'assistant',
                    blocks: s.blocks,
                    isStreaming: active,
                    ...(active && s.displayStatus && { status: s.displayStatus }),
                    ...(hasErrorState && { isError: true }),
                    ...((s.status === 'aborted' || existing?.isAborted) && !s.isRetracted && { isAborted: true }),
                    ...(s.isRetracted && { isRetracted: true }),
                    // Preserve metadata set by handleStreamDone (model badge, cost, etc.)
                    ...(existing?.metadata && { metadata: existing.metadata }),
                };

                return {
                    ...prev,
                    isGenerating: active,
                    messages: existing
                        ? prev.messages.map((m) => (m.id === msgId ? streamMsg : m))
                        : [...prev.messages, streamMsg],
                };
            });
        };

        if (isTerminal) {
            if (syncRaf.current) {
                cancelAnimationFrame(syncRaf.current);
                syncRaf.current = 0;
            }
            syncToMessages(stream);
            return;
        }

        // Coalesce active-streaming updates: at most one setState per animation frame
        if (!syncRaf.current) {
            syncRaf.current = requestAnimationFrame(() => {
                syncRaf.current = 0;
                const s = streamRef.current;
                if (s.agentMessageId && s.status === 'streaming') {
                    syncToMessages(s);
                }
            });
        }
    }, [
        stream.blocks,
        stream.agentMessageId,
        stream.status,
        stream.displayStatus,
        stream.streamType,
        stream.error,
        stream.isRetracted,
    ]);

    useEffect(
        () => () => {
            if (syncRaf.current) cancelAnimationFrame(syncRaf.current);
        },
        [],
    );

    // Page-load recovery: if we subscribe mid-summary, stream.streamType is set from the
    // subscribe_response snapshot — enter summarizing mode without waiting for stream_started.
    // Also clears isGenerating which loadMessages may have set from active_agent_message_id
    // (the DB doesn't distinguish summary streams from chat streams).
    useEffect(() => {
        if (stream.streamType === 'summary') {
            setState((prev) =>
                prev.isSummarizing && !prev.isGenerating
                    ? prev
                    : { ...prev, isSummarizing: true, isGenerating: false, activeResponseId: null },
            );
        }
    }, [stream.streamType]);

    // Sync summary stream displayStatus to state (never clears — handleStreamDone resets).
    useEffect(() => {
        if (stream.streamType !== 'summary') return;
        const status = stream.displayStatus as SummaryStatus | null;
        if (status) {
            setState((prev) => (prev.summaryStatus === status ? prev : { ...prev, summaryStatus: status }));
        }
    }, [stream.streamType, stream.displayStatus]);

    // ========================================================================
    // MESSAGE LOADING
    // ========================================================================

    // (mapApiMessage was moved above handleStreamStarted)

    /** Load messages from API for the current chat (initial load - gets newest messages) */
    const loadMessages = useCallback(async () => {
        if (!chatId) return;

        // Skip reload if we just created this chat
        if (skipNextLoad.current) {
            skipNextLoad.current = false;
            return;
        }

        setState((prev) => ({ ...prev, isLoading: true }));

        try {
            const [messagesData, chatData] = await Promise.all([
                api.messages.list(chatId, { page: 1 }),
                api.chats.get(chatId),
            ]);
            // API returns DESC order (newest first), reverse for display (newest at bottom)
            const apiMessages: Message[] =
                messagesData.data?.map((m) => mapApiMessage(m, chatData.activeAgentMessageId)) || [];

            // Sync model selection — DB is source of truth for existing chats
            if (chatData.selectedModel) {
                setSelectedModel(chatData.selectedModel);
            }

            setState((prev) => {
                const apiMessagesReversed = apiMessages.reverse();

                // Preserve the active streaming bubble if it hasn't hit the DB yet
                // so it doesn't blink out of existence during the HTTP load
                const streamingMsg = prev.messages.find((m) => m.isStreaming);
                if (streamingMsg && !apiMessagesReversed.some((m) => m.id === streamingMsg.id)) {
                    apiMessagesReversed.push(streamingMsg);
                }

                // Don't set isGenerating if we already know this is a summary stream
                // (active_agent_message_id is set for both chat and summary streams in DB)
                const hasActiveStream = !!chatData.activeAgentMessageId;
                return {
                    ...prev,
                    messages: apiMessagesReversed,
                    isLoading: false,
                    isGenerating: prev.isSummarizing ? false : hasActiveStream,
                    activeResponseId: prev.isSummarizing ? null : (chatData.activeAgentMessageId ?? null),
                    tokenUsage: chatData.tokenUsage ?? null,
                    totalCost: chatData.totalCost != null ? Number(chatData.totalCost) : null,
                    hasPendingChanges: chatData.hasPendingChanges ?? false,
                    phaseIndex: chatData.phaseIndex,
                    completionBriefStatus: chatData.completionBriefStatus ?? null,
                };
            });
            setPagination({
                page: messagesData.pagination.page,
                totalPages: messagesData.pagination.totalPages,
                isLoadingMore: false,
                hasMore: messagesData.pagination.page < messagesData.pagination.totalPages,
            });
        } catch (error) {
            console.error('Error loading messages:', error);
            setState((prev) => ({ ...prev, error: new Error('Failed to load messages'), isLoading: false }));
        }
    }, [api, chatId, mapApiMessage, setSelectedModel]);

    // Keep reconnect ref in sync with loadMessages
    loadMessagesRef.current = loadMessages;

    // Auto-load messages when an initial chat ID is provided
    useEffect(() => {
        if (initialChatId) {
            loadMessages();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialChatId]);

    /** Load more (older) messages for infinite scroll */
    const loadMoreMessages = useCallback(async () => {
        if (!chatId || pagination.isLoadingMore || !pagination.hasMore) return;

        setPagination((prev) => ({ ...prev, isLoadingMore: true }));

        try {
            const nextPage = pagination.page + 1;
            const data = await api.messages.list(chatId, { page: nextPage });
            // API returns DESC order (newest first), reverse and prepend to existing messages
            const olderMessages: Message[] = data.data?.map((m) => mapApiMessage(m, state.activeResponseId)) || [];

            setState((prev) => ({
                ...prev,
                messages: [...olderMessages.reverse(), ...prev.messages],
            }));
            setPagination({
                page: data.pagination.page,
                totalPages: data.pagination.totalPages,
                isLoadingMore: false,
                hasMore: data.pagination.page < data.pagination.totalPages,
            });
        } catch (error) {
            console.error('Error loading more messages:', error);
            setPagination((prev) => ({ ...prev, isLoadingMore: false }));
        }
    }, [api, chatId, pagination.isLoadingMore, pagination.hasMore, pagination.page, mapApiMessage]);

    // ========================================================================
    // SEND MESSAGE
    // ========================================================================

    const associatePendingUploads = useCallback(
        async (
            chatIdToUse: string,
            opts?: { stagedArtifactIds?: string[]; imageFileIds?: string[] },
        ) => {
            if (!opts?.stagedArtifactIds?.length && !opts?.imageFileIds?.length) return;

            const accessToken = (await getToken()) ?? '';
            const associationResponse = await associateUploads(
                {
                    ...(opts?.stagedArtifactIds?.length ? { artifactIds: opts.stagedArtifactIds } : {}),
                    ...(opts?.imageFileIds?.length ? { imageFileIds: opts.imageFileIds } : {}),
                    chatId: chatIdToUse,
                    ...(projectId ? { projectId } : {}),
                },
                accessToken,
            );

            if (!associationResponse.ok) {
                const errorText = await associationResponse.text().catch(() => 'Unknown error');
                throw new Error(`Associate uploads failed: ${associationResponse.status} - ${errorText}`);
            }
        },
        [getToken, projectId],
    );

    const prepareUploadsForSend = useCallback(
        async (opts?: { stagedArtifactIds?: string[]; imageFileIds?: string[] }) => {
            const chatIdToUse = await ensureChatId();
            await associatePendingUploads(chatIdToUse, opts);
            return chatIdToUse;
        },
        [associatePendingUploads, ensureChatId],
    );

    /** Send a message - creates chat if needed, triggers server-side generation via WS */
    const sendMessage = useCallback(
        async (
            content: string,
            opts?: {
                resolvedChatId?: string;
                stagedArtifactIds?: string[];
                imageFileIds?: string[];
                uploadsAlreadyAssociated?: boolean;
            },
        ) => {
            if (!content.trim() || state.isGenerating) return;

            if (!isModelAvailable) {
                setState((prev) => ({ ...prev, showInvalidModelAlert: true }));
                return;
            }

            // Create user message with temporary client-side ID
            const userMessage = createUserMessage(content);

            // Add user message and set generating state
            setState((prev) => ({
                ...prev,
                messages: [...prev.messages, userMessage],
                isGenerating: true,
                error: null,
            }));

            // Get access token for worker auth
            const accessToken = (await getToken()) ?? '';

            try {
                const chatIdToUse = opts?.resolvedChatId ?? (await ensureChatId());

                captureChatAnalytics('chat_turn_submitted', {
                    chat_id: chatIdToUse,
                    submission_id: userMessage.id,
                    input_length: content.length,
                    staged_artifact_count: opts?.stagedArtifactIds?.length ?? 0,
                    image_count: opts?.imageFileIds?.length ?? 0,
                });

                // Ensure newly created chat has the correct model in DB
                if (!chatId && selectedModel) {
                    api.chats
                        .updateModel(chatIdToUse, selectedModel)
                        .catch((err) => console.error('Failed to persist initial model selection:', err));
                }

                // Associate staged uploads (artifacts + images) with the newly created (or existing) chat.
                // Images uploaded before the chat existed are staged under the user and need chat_id set
                // before the generation handler can link them to the message.
                if (!opts?.uploadsAlreadyAssociated && (opts?.stagedArtifactIds?.length || opts?.imageFileIds?.length)) {
                    const associationResponse = await associateUploads(
                        {
                            ...(opts?.stagedArtifactIds?.length ? { artifactIds: opts.stagedArtifactIds } : {}),
                            ...(opts?.imageFileIds?.length ? { imageFileIds: opts.imageFileIds } : {}),
                            chatId: chatIdToUse,
                            ...(projectId ? { projectId } : {}),
                        },
                        accessToken,
                    );

                    if (!associationResponse.ok) {
                        const errorText = await associationResponse.text().catch(() => 'Unknown error');
                        throw new Error(`Associate uploads failed: ${associationResponse.status} — ${errorText}`);
                    }
                }

                // POST triggers server-side generation — stream arrives via WS subscription
                // TODO: Unify this when backend is updated
                const send = chatType === 'phase' ? sendAction : sendIntakeAction;
                const response = await send(
                    {
                        message: content,
                        chatId: chatIdToUse,
                        model: selectedModel,
                        tempId: userMessage.id, // Reconcile across WS boundaries
                        ...(opts?.imageFileIds?.length ? { imageFileIds: opts.imageFileIds } : {}),
                    },
                    accessToken,
                );

                if (!response.ok) {
                    const errorText = await response.text().catch(() => 'Unknown error');
                    throw new Error(`Send failed: ${response.status} — ${errorText}`);
                }

                // Broker mode: POST returns JSON { userMessageId, agentMessageId }.
                // Stream data arrives via WebSocket subscription (no readStream needed).
                const result = await response.json();

                // Reconcile client-side user message ID with server-assigned ID
                if (result.userMessageId) {
                    setState((prev) => ({
                        ...prev,
                        messages: prev.messages.map((m) =>
                            m.id === userMessage.id ? { ...m, id: result.userMessageId, tempId: m.tempId || m.id } : m,
                        ),
                    }));
                }
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    // Request was cancelled, don't treat as error
                    return;
                }
                console.error('Error sending message:', error);
                captureChatAnalytics('chat_turn_submission_failed', {
                    submission_id: userMessage.id,
                    error_message: error instanceof Error ? error.message : 'Failed to send message',
                });
                setState((prev) => ({
                    ...prev,
                    isGenerating: false,
                    error: error instanceof Error ? error : new Error('Failed to send message'),
                }));
            }
        },
        [
            api,
            cache,
            chatId,
            chatType,
            ensureChatId,
            getToken,
            globalMutate,
            selectedModel,
            state.isGenerating,
            isModelAvailable,
        ],
    );

    // ========================================================================
    // NUDGE — trigger generation on last injected system event (no user message)
    // ========================================================================

    const sendNudge = useCallback(async () => {
        if (!chatId || state.isGenerating) return;

        setState((prev) => ({ ...prev, isGenerating: true, error: null }));

        const accessToken = (await getToken()) ?? '';

        try {
            const send = chatType === 'phase' ? sendAction : sendIntakeAction;
            const response = await send({ message: null, chatId, model: selectedModel }, accessToken);

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`Nudge failed: ${response.status} — ${errorText}`);
            }
        } catch (error) {
            console.error('Error sending nudge:', error);
            setState((prev) => ({
                ...prev,
                isGenerating: false,
                error: error instanceof Error ? error : new Error('Failed to send nudge'),
            }));
        }
    }, [chatId, chatType, getToken, selectedModel, state.isGenerating]);

    // Nudge recovery: when a locally-initiated approval/rejection completes,
    // send the nudge from this tab. Reactive deps ensure the nudge fires when:
    // - completion happens while this chat is open (state change → re-render)
    // - user returns to this chat later (mount → effect runs)
    // - isGenerating was true and flips to false (retry)
    useEffect(() => {
        if (!chatId || state.isGenerating || !hasPendingNudge(chatId)) return;
        clearPendingNudge(chatId);
        void sendNudge();
    }, [chatId, state.isGenerating, hasPendingNudge, clearPendingNudge, sendNudge]);

    // ========================================================================
    // SUMMARIZE
    // ========================================================================

    // Ref guard: prevents duplicate POST when multiple NextPhaseButton
    // instances (desktop + mobile) react to pendingPhaseTransition simultaneously.
    const summarizeInFlightRef = useRef(false);
    const summaryCancelledRef = useRef(false);

    /** Trigger summarization — fires POST, then waits for stream_started(streamType:'summary') via WS */
    const summarizeChat = useCallback(async () => {
        // Summarization is only for phase chats
        if (chatType !== 'phase' || !chatId || state.isSummarizing) return;
        if (summarizeInFlightRef.current) return;
        summarizeInFlightRef.current = true;
        summaryCancelledRef.current = false;

        // Do NOT set isSummarizing here — stream_started(streamType:'summary') drives that state.
        // This avoids showing the summarizing UI if the POST itself fails.
        setState((prev) => ({ ...prev, error: null }));

        try {
            const accessToken = (await getToken()) ?? '';
            const response = await summarize({ chatId }, accessToken);

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`Summarize failed: ${response.status} — ${errorText}`);
            }

            // Broker mode: POST returns { agentMessageId } synchronously.
            // stream_started(streamType:'summary') arrives via existing chat: WS subscription.
        } catch (err) {
            summarizeInFlightRef.current = false;
            setState((prev) => ({
                ...prev,
                isSummarizing: false,
                summaryStatus: null,
                error: err instanceof Error ? err : new Error('Summarization failed'),
            }));
        }
    }, [chatId, getToken, chatType, state.isSummarizing]);

    /** Cancel an in-progress summarization — aborts the stream and rolls back created artifacts */
    const cancelSummary = useCallback(async () => {
        if (!state.isSummarizing || !chatId) return;

        // Mark as cancelled so subsequent stream events (done/error) are ignored
        summaryCancelledRef.current = true;
        summarizeInFlightRef.current = false;

        cleanupTransientArtifacts(stream.activeDocuments);

        // Also abort via WebSocket for faster path
        stream.abort();

        // Reset state synchronously before any async work — prevents the
        // cross-tab sync effect from reopening the overlay
        setState((prev) => ({
            ...prev,
            isSummarizing: false,
            summaryStatus: null,
            summaryNewChatId: null,
            error: null,
        }));

        // Abort via HTTP (fire-and-forget, uses stream's agentMessageId)
        const summaryAgentMessageId = stream.agentMessageId;
        if (summaryAgentMessageId) {
            const accessToken = (await getToken()) ?? '';
            abort({ chatId, agentMessageId: summaryAgentMessageId }, accessToken).catch(() => {});
        }
    }, [chatId, state.isSummarizing, stream, cleanupTransientArtifacts, getToken]);

    /** Navigate to the new phase chat after summarization */
    const navigateToNewPhase = useCallback(() => {
        if (!state.summaryNewChatId) return;
        router.push(`/${projectId}/${state.summaryNewChatId}`);
    }, [projectId, router, state.summaryNewChatId]);

    // ========================================================================
    // STOP GENERATION
    // ========================================================================

    /** Stop the current generation */
    const stopGeneration = useCallback(async () => {
        cleanupTransientArtifacts(stream.activeDocuments);

        // Server-side abort via HTTP → ChatStreamDO.abort()
        if (state.activeResponseId && chatId) {
            const accessToken = (await getToken()) ?? '';
            abort({ chatId, agentMessageId: state.activeResponseId }, accessToken).catch(() => {}); // fire-and-forget
        }

        // Also send abort via WebSocket for faster path
        stream.abort();

        // Optimistically finalize streaming messages — server confirms via stream_status
        setState((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
                msg.isStreaming ? { ...msg, isStreaming: false, isAborted: true, status: undefined } : msg,
            ),
            isGenerating: false,
        }));
    }, [chatId, cleanupTransientArtifacts, getToken, state.activeResponseId, stream]);

    /** Change the chat's selected model — persists via API when a chat exists, project preference when not */
    const changeModel = useCallback(
        async (presetId: string) => {
            // Radix Select's BubbleSelect dispatches onValueChange('') on mount — ignore it
            if (!presetId) return;

            if (!chatId) {
                persistSelection(presetId);
                return;
            }

            const previousModel = selectedModel;
            setSelectedModel(presetId); // optimistic
            setIsChangingModel(true);

            try {
                await api.chats.updateModel(chatId, presetId);
                // Backend propagated to project — keep SWR cache in sync for next new-chat init
                if (projectId) {
                    globalMutate(
                        projectKeys.detail(projectId),
                        (prev: Record<string, unknown> | undefined) =>
                            prev ? { ...prev, preferredModel: presetId } : prev,
                        { revalidate: false },
                    );
                }
            } catch (err) {
                console.error('Failed to update model:', err);
                setSelectedModel(previousModel); // revert
            } finally {
                setIsChangingModel(false);
            }
        },
        [chatId, api, persistSelection, setSelectedModel, selectedModel, setIsChangingModel, projectId, globalMutate],
    );

    const dismissInvalidModelAlert = useCallback(() => {
        setState((prev) => ({ ...prev, showInvalidModelAlert: false }));
    }, []);

    return (
        <ChatContext.Provider
            value={buildContextValue(chatType, projectId, {
                state,
                api,
                chatId,
                pagination,
                loadMessages,
                loadMoreMessages,
                sendMessage,
                prepareUploadsForSend,
                sendNudge,
                stopGeneration,
                setChatId,
                summarizeChat,
                cancelSummary,
                navigateToNewPhase,
                clearPendingChanges,
                clearPendingPhaseTransition,
                hasOtherPendingArtifacts,
                setProcessingArtifactAction,
                changeModel,
                dismissInvalidModelAlert,
                ensureChatId,
            })}
        >
            {children}
        </ChatContext.Provider>
    );
}

export function useChatContext<TChatType extends ChatType>(): ChatContextValue<TChatType> {
    const context = useContext(ChatContext) as ChatContextValue<TChatType> | null;
    if (!context) {
        throw new Error('useChatContext must be used within a ChatProvider');
    }
    return context;
}
