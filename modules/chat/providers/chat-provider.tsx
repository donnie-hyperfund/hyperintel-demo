'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { v4 as uuidv4 } from 'uuid';
import { type ApiClient, createApiClient } from '@/lib/api/client';
import { artifactKeys } from '@/lib/api/client/fetchers/artifacts';
import { sendAction, summarize } from '@/lib/api/requests/worker/chat';
import type { ChatMessageDto } from '@/lib/schema/message';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import { useStreamReader } from '../hooks/use-stream-reader';
import type { ChatState, Message, PaginationState, StreamBlock, TokenUsage } from '../types';

export type ChatContextValue = {
    state: ChatState;
    /** API client for chat operations */
    api: ApiClient;
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
    /** Summarize the current chat and navigate to the new one */
    summarizeChat: () => void;
    /** Whether the chat has any artifacts (documents created) */
    hasArtifacts: boolean;
    /** Whether any artifact has a pending proposal awaiting approval */
    hasPendingProposal: boolean;
};

const ChatContext = createContext<ChatContextValue | null>(null);

type ChatProviderProps = {
    children: ReactNode;
    /** Project ID for API calls */
    projectId: string;
    /** Initial chat ID (optional - will create on first message if not provided) */
    initialChatId?: string;
    /** Initial messages to display */
    initialMessages?: Message[];
};

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

export function ChatProvider({ children, projectId, initialChatId, initialMessages = [] }: ChatProviderProps) {
    const artifactContext = useArtifactContext();
    const { openPanel } = useActivePanelContext();
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    // Create API client with auth
    const api = useMemo(() => createApiClient(getToken), [getToken]);

    // Chat ID state
    const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
    const skipNextLoad = useRef(false);

    // Chat state
    const [state, setState] = useState<ChatState>({
        messages: initialMessages,
        isGenerating: false,
        isSummarizing: false,
        isLoading: !!chatId,
        error: null,
        streamingMessageId: null,
        tokenUsage: null,
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

    const revalidateArtifacts = useCallback(() => {
        globalMutate(artifactKeys.list(projectId));
    }, [globalMutate, projectId]);

    const onTokenUsage = useCallback((usage: TokenUsage) => {
        setState((prev) => ({ ...prev, tokenUsage: usage }));
    }, []);

    const handleArtifactOpen = useCallback(
        (artifactId: string, version: number) => {
            openPanel({ panel: 'artifact-preview', artifactId, version });
        },
        [openPanel],
    );

    // Use the stream reader hook for SSE processing
    const { readStream } = useStreamReader({
        artifactContext,
        setMessages,
        setIsLoading,
        onArtifactOpen: handleArtifactOpen,
        onArtifactComplete: revalidateArtifacts,
        onTokenUsage,
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
                api.messages.list(projectId, chatId, { page: 1 }),
                api.chats.get(projectId, chatId),
            ]);

            // API returns DESC order (newest first), reverse for display (newest at bottom)
            const apiMessages: Message[] = messagesData.data?.map(mapApiMessage) || [];

            setState((prev) => ({
                ...prev,
                messages: apiMessages.reverse(),
                isLoading: false,
                tokenUsage: chatData.token_usage ?? null,
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
    }, [api, chatId, projectId, mapApiMessage]);

    /** Load more (older) messages for infinite scroll */
    const loadMoreMessages = useCallback(async () => {
        if (!chatId || pagination.isLoadingMore || !pagination.hasMore) return;

        setPagination((prev) => ({ ...prev, isLoadingMore: true }));

        try {
            const nextPage = pagination.page + 1;
            const data = await api.messages.list(projectId, chatId, { page: nextPage });
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
    }, [api, chatId, projectId, pagination.isLoadingMore, pagination.hasMore, pagination.page, mapApiMessage]);

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
                    const newChat = await api.chats.create(projectId);
                    chatIdToUse = newChat.id;

                    // Skip the message reload effect
                    skipNextLoad.current = true;
                    setChatId(chatIdToUse);

                    // Update URL without navigation using history API
                    window.history.replaceState(null, '', `/${projectId}/chats/${chatIdToUse}`);

                    // Revalidate chats list so sidebar and header update
                    globalMutate((key) => Array.isArray(key) && key[0] === 'chats' && key[1] === 'list');
                }

                // Create abort controller for this request
                abortControllerRef.current = new AbortController();

                const response = await sendAction(
                    {
                        message: content,
                        chatId: chatIdToUse,
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
        [api, chatId, getToken, globalMutate, projectId, readStream, state.isGenerating],
    );

    /** Summarize current chat and navigate to the new one */
    const summarizeChat = useCallback(async () => {
        if (!chatId || state.isSummarizing) return;

        setState((prev) => ({ ...prev, isSummarizing: true, error: null }));

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

                        // TODO: Uncomment this when backend is fixed
                        // if (event.type === 'error') {
                        //     setState((prev) => ({ ...prev, isSummarizing: false, error: new Error(event.error) }));
                        //     return;
                        // }

                        if (event.type === 'done' && event.newChatId) {
                            setState((prev) => ({ ...prev, isSummarizing: false }));
                            window.location.href = `/${projectId}/${event.newChatId}`;
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
    }, [chatId, getToken, projectId, state.isSummarizing]);

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

    return (
        <ChatContext.Provider
            value={{
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

                // Computed values - check all versions for pending proposals
                hasArtifacts: Object.keys(artifactContext.artifacts).length > 0,
                hasPendingProposal: Object.values(artifactContext.artifacts).some((artifactVersions) =>
                    Object.values(artifactVersions).some((artifact) => artifact.proposed_version?.status === 'proposed'),
                ),
            }}
        >
            {children}
        </ChatContext.Provider>
    );
}

export function useChatContext(): ChatContextValue {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChatContext must be used within a ChatProvider');
    }
    return context;
}
