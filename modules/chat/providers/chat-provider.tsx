'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { unstable_serialize, useSWRConfig } from 'swr';
import { v4 as uuidv4 } from 'uuid';
import { type ApiClient, createApiClient } from '@/lib/api/client';
import { insertChatToCache } from '@/lib/api/client/cache/chats';
import { chatKeys } from '@/lib/api/client/fetchers/chats';
import { serializeProjectArtifactListKey } from '@/lib/api/client/fetchers/project-artifacts';
import { sendAction, sendIntakeAction, summarize } from '@/lib/api/requests/worker/chat';
import type { ChatMessageDto } from '@/lib/schema/message';
import { useArtifactContext } from '@/modules/artifacts/providers/artifact-provider';
import { getLatestArtifactVersion } from '@/modules/artifacts/utils';
import { intakeConfigMap } from '@/modules/chat/contants';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useModelSelection } from '@/modules/chat/providers/model-selection-provider';
import { useStreamReader } from '../hooks/use-stream-reader';
import type { ChatState, ChatType, Message, PaginationState, StreamBlock, TokenUsage } from '../types';

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
    sendMessage: (content: string) => Promise<void>;
    /** Stop the current generation */
    stopGeneration: () => void;
    /** Set the current chat ID */
    setChatId: (chatId: string | null) => void;
    /** Summarize the current chat and prepare the new phase */
    summarizeChat: () => void;
    /** Navigate to the new phase chat (after summarization completes) */
    navigateToNewPhase: () => void;
    /** Set hasPendingChanges to false (call after approve/reject) */
    clearPendingChanges: () => void;
    /** Clear the pending phase transition flag (called after dialog handles it) */
    clearPendingPhaseTransition: () => void;
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
    /** Chat type — defaults to 'phase' */
    chatType?: ChatType;
    /** Initial chat ID (optional - will create on first message if not provided) */
    initialChatId?: string;
    /** Initial messages to display */
    initialMessages?: Message[];
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
        role: 'user',
        blocks: [{ id: `text-${id}`, type: 'text', content }],
        createdAt: new Date(),
    };
}

export function ChatProvider({
    children,
    projectId,
    chatType = 'phase',
    initialChatId,
    initialMessages = [],
}: ChatProviderProps) {
    const artifactContext = useArtifactContext();

    const { openPanel } = useActivePanelContext();
    const { getToken } = useAuth();

    const { mutate: globalMutate, cache, fallback } = useSWRConfig();
    const router = useRouter();

    // Create API client with auth
    const api = useMemo(() => createApiClient(getToken), [getToken]);

    // Chat ID state
    const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
    const { selectedModel } = useModelSelection();
    const skipNextLoad = useRef(false);

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
            tokenUsage: cached?.token_usage ?? null,
            hasPendingChanges: cached?.has_pending_changes ?? false,
            phaseIndex: cached?.phase_index ?? null,
            summaryNewChatId: null,
            pendingPhaseTransition: false,
        };
    });

    // Pagination state for infinite scroll
    const [pagination, setPagination] = useState<PaginationState>({
        page: 1,
        totalPages: 1,
        isLoadingMore: false,
        hasMore: false,
    });

    // Abort controller for cancelling requests
    const abortControllerRef = useRef<AbortController | null>(null);

    // State setters for useStreamReader
    const setMessages = useCallback((action: React.SetStateAction<Message[]>) => {
        setState((prev) => ({
            ...prev,
            messages: typeof action === 'function' ? action(prev.messages) : action,
        }));
    }, []);

    const setIsLoading = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
        setState((prev) => ({
            ...prev,
            isGenerating: typeof value === 'function' ? value(prev.isGenerating) : value,
        }));
    }, []);

    const revalidateArtifactByKeyAndVersion = useCallback(
        async (keyId: string, version: number) => {
            // TODO: Handle it with a unified artifact API when backend is updated
            if (!projectId) return;

            globalMutate(serializeProjectArtifactListKey(projectId));

            try {
                const allVersions = Array.from({ length: version }, (_, i) => version - i);
                const results = await Promise.all(
                    allVersions.map((v) => api.projectArtifacts.getByKey(projectId, keyId, v).catch(() => null)),
                );

                for (const data of results) {
                    if (data) {
                        artifactContext.updateArtifact(keyId, data, getLatestArtifactVersion(data)?.version, {
                            merge: false,
                        });
                    }
                }
            } catch {
                // SWR revalidation will still keep the list up to date
            }
        },
        [globalMutate, projectId, artifactContext, api.projectArtifacts],
    );

    const onTokenUsage = useCallback((usage: TokenUsage) => {
        setState((prev) => ({ ...prev, tokenUsage: usage }));
    }, []);

    const onDocumentStart = useCallback(() => {
        setState((prev) => ({ ...prev, hasPendingChanges: true }));
    }, []);

    const clearPendingChanges = useCallback(() => {
        setState((prev) => ({ ...prev, hasPendingChanges: false }));
    }, []);

    const clearPendingPhaseTransition = useCallback(() => {
        setState((prev) => ({ ...prev, pendingPhaseTransition: false }));
    }, []);

    const onTerminalTool = useCallback((toolName: string) => {
        if (toolName === 'generate_summary') {
            setState((prev) => ({ ...prev, pendingPhaseTransition: true }));
        }
    }, []);

    const handleArtifactOpen = useCallback(
        (artifactId: string, version: number) => {
            openPanel({ panel: 'artifact-preview', artifactId, version });
        },
        [openPanel],
    );

    const fetchArtifact = useCallback(
        async (artifactKey: string, version: number) => {
            // TODO: Handle it with a unified artifact API when backend is updated
            if (!projectId) return null;

            try {
                const artifact = await api.projectArtifacts.getByKey(projectId, artifactKey, version);
                if (artifact) {
                    artifactContext.addArtifact(artifact, version);
                }
                return artifact;
            } catch (error) {
                console.error('Failed to fetch artifact:', error);
                return null;
            }
        },
        [api.artifacts, projectId, artifactContext],
    );

    // Use the stream reader hook for SSE processing
    const { readStream } = useStreamReader({
        artifactContext,
        setMessages,
        setIsLoading,
        handleArtifactOpen,
        revalidateArtifactByKeyAndVersion,
        onTokenUsage,
        fetchArtifact,
        onDocumentStart,
        onTerminalTool,
    });

    /** Convert API message to internal Message format */
    const mapApiMessage = useCallback((m: ChatMessageDto): Message => {
        // LEGACY: fallback for old messages with content but no blocks (remove after DB nuke)
        const blocks: StreamBlock[] =
            m.blocks && m.blocks.length > 0
                ? (m.blocks as StreamBlock[])
                : m.content
                  ? [{ id: m.id, type: 'text' as const, content: m.content }]
                  : [];
        return {
            id: m.id,
            role: m.role as 'user' | 'assistant',
            blocks,
            isStreaming: false,
            ...(m.is_error && { isError: true }),
        };
    }, []);

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
            const apiMessages: Message[] = messagesData.data?.map(mapApiMessage) || [];

            setState((prev) => ({
                ...prev,
                messages: apiMessages.reverse(),
                isLoading: false,
                tokenUsage: chatData.token_usage ?? null,
                hasPendingChanges: chatData.has_pending_changes ?? false,
                phaseIndex: chatData.phase_index,
            }));
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
    }, [api, chatId, mapApiMessage]);

    /** Load more (older) messages for infinite scroll */
    const loadMoreMessages = useCallback(async () => {
        if (!chatId || pagination.isLoadingMore || !pagination.hasMore) return;

        setPagination((prev) => ({ ...prev, isLoadingMore: true }));

        try {
            const nextPage = pagination.page + 1;
            const data = await api.messages.list(chatId, { page: nextPage });
            // API returns DESC order (newest first), reverse and prepend to existing messages
            const olderMessages: Message[] = data.data?.map(mapApiMessage) || [];

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

    /** Send a message - creates chat if needed, handles streaming */
    const sendMessage = useCallback(
        async (content: string) => {
            if (!content.trim() || state.isGenerating) return;

            // Create user message
            const userMessage = createUserMessage(content);

            // Add user message and set loading state
            setState((prev) => ({
                ...prev,
                messages: [...prev.messages, userMessage],
                isGenerating: true,
                error: null,
            }));

            // Get access token for worker auth
            const accessToken = (await getToken()) ?? '';

            try {
                // If no chatId, create a new chat first
                let chatIdToUse = chatId;
                if (!chatIdToUse) {
                    // TODO: Unify this when backend is updated
                    if (chatType === 'phase') {
                        if (!projectId) {
                            throw new Error('Project ID is required for phase chats');
                        }

                        // Phase chat — project-scoped creation
                        const newChat = await api.chats.create(projectId);
                        chatIdToUse = newChat.id;

                        skipNextLoad.current = true;
                        setChatId(chatIdToUse);
                        setState((prev) => ({ ...prev, phaseIndex: newChat.phase_index }));

                        // Update URL without navigation using history API
                        window.history.replaceState(null, '', `/${projectId}/${chatIdToUse}`);

                        insertChatToCache(cache, globalMutate, newChat);
                    } else {
                        // Intake chat — unified creation
                        const newChat = await api.chats.createIntake({
                            framework: intakeConfigMap[chatType].framework,
                            category: intakeConfigMap[chatType].category,
                        });
                        chatIdToUse = newChat.id;

                        skipNextLoad.current = true;
                        setChatId(chatIdToUse);

                        const basePath =
                            chatType === 'company' ? '/companies' : chatType === 'stakeholder' ? '/stakeholders' : null;
                        if (basePath) {
                            window.history.replaceState(null, '', `${basePath}/${chatIdToUse}`);
                        }
                    }
                }

                // Create abort controller for this request
                abortControllerRef.current = new AbortController();

                // TODO: Unify this when backend is updated
                const send = chatType === 'phase' ? sendAction : sendIntakeAction;
                const response = await send(
                    {
                        message: content,
                        chatId: chatIdToUse,
                        model: selectedModel,
                    },
                    accessToken,
                );

                // Use streaming response
                if (response.body) {
                    await readStream(response.body);
                }
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    // Request was cancelled, don't treat as error
                    return;
                }
                console.error('Error sending message:', error);
                setState((prev) => ({
                    ...prev,
                    isGenerating: false,
                    error: error instanceof Error ? error : new Error('Failed to send message'),
                }));
            } finally {
                abortControllerRef.current = null;
            }
        },
        [
            api,
            cache,
            chatId,
            getToken,
            globalMutate,
            chatType,
            projectId,
            readStream,
            selectedModel,
            state.isGenerating,
        ],
    );

    /** Summarize current chat and store the new phase chat ID */
    const summarizeChat = useCallback(async () => {
        // Summarization is only for phase chats
        if (chatType !== 'phase' || !chatId || state.isSummarizing) return;

        setState((prev) => ({ ...prev, isSummarizing: true, summaryNewChatId: null, error: null }));

        try {
            const accessToken = (await getToken()) ?? '';
            const response = await summarize({ chatId }, accessToken);

            if (!response.body) {
                throw new Error('No response stream');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.replace('data: ', '').trim();
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const event = JSON.parse(jsonStr);

                        if (event.type === 'error') {
                            setState((prev) => ({ ...prev, isSummarizing: false, error: new Error(event.error) }));
                            return;
                        }

                        if (event.type === 'done' && event.newChatId) {
                            setState((prev) => ({
                                ...prev,
                                isSummarizing: false,
                                summaryNewChatId: event.newChatId,
                            }));
                            return;
                        }
                    } catch {
                        // skip unparseable lines
                    }
                }
            }

            setState((prev) => ({ ...prev, isSummarizing: false }));
        } catch (err) {
            setState((prev) => ({
                ...prev,
                isSummarizing: false,
                error: err instanceof Error ? err : new Error('Summarization failed'),
            }));
        }
    }, [chatId, getToken, chatType, state.isSummarizing]);

    /** Navigate to the new phase chat after summarization */
    const navigateToNewPhase = useCallback(() => {
        if (!state.summaryNewChatId) return;
        router.push(`/${projectId}/${state.summaryNewChatId}`);
    }, [projectId, router, state.summaryNewChatId]);

    /** Stop the current generation */
    const stopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        setState((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
                msg.isStreaming ? { ...msg, isStreaming: false, status: undefined } : msg,
            ),
            isGenerating: false,
        }));
    }, []);

    // Auto-load messages when an initial chat ID is provided
    useEffect(() => {
        if (initialChatId) {
            loadMessages();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialChatId]);

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
                stopGeneration,
                setChatId,
                summarizeChat,
                navigateToNewPhase,
                clearPendingChanges,
                clearPendingPhaseTransition,
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
