'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useArtifactContext } from '@/app/modules/chat/providers/artifact-provider';
import { createMessage, MessageBuilder } from '../services/message-builder';
import type { Artifact, ChatState, Message, StreamEvent } from '../types';
import { useStreamingContext } from './streaming-provider';

export type ChatContextValue = {
    state: ChatState;
    sendMessage: (content: string) => void;
    stopGeneration: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

// TODO: Change to real endpoint when backend is ready
const API_ENDPOINT = '/api/stream-artifact';

type ChatProviderProps = {
    children: ReactNode;
    initialMessages?: Message[];
};

export function ChatProvider({ children, initialMessages = [] }: ChatProviderProps) {
    const { subscribe, startStream, abort } = useStreamingContext();
    const { addArtifact, updateArtifact, setCurrentArtifact } = useArtifactContext();

    const [state, setState] = useState<ChatState>({
        messages: initialMessages,
        isGenerating: false,
        error: null,
        streamingMessageId: null,
    });

    const messageBuilderRef = useRef<MessageBuilder | null>(null);

    const handleStreamEvent = useCallback(
        (event: StreamEvent) => {
            const builder = messageBuilderRef.current;
            if (!builder) return;

            switch (event.type) {
                case 'text':
                    builder.appendText(event.content);
                    setState((prev) => ({
                        ...prev,
                        messages: prev.messages.map((msg) =>
                            msg.id === prev.streamingMessageId ? { ...msg, content: builder.getText() } : msg,
                        ),
                    }));
                    break;

                case 'artifact_start': {
                    const messageId = messageBuilderRef.current?.buildMessage().id;
                    if (!messageId) break;

                    builder.startArtifact(event.artifactId, event.metadata);

                    const artifact: Artifact = {
                        id: event.artifactId,
                        identifier: event.metadata.identifier,
                        title: event.metadata.title,
                        type: event.metadata.type,
                        content: '',
                        messageId,
                    };
                    addArtifact(artifact);
                    setCurrentArtifact(event.artifactId);

                    // Update message with artifact ref
                    setState((prev) => ({
                        ...prev,
                        messages: prev.messages.map((msg) =>
                            msg.id === prev.streamingMessageId ? { ...msg, artifacts: builder.getArtifactRefs() } : msg,
                        ),
                    }));
                    break;
                }

                case 'artifact_chunk': {
                    builder.appendArtifactContent(event.artifactId, event.content);
                    // Update artifact content in real-time
                    const artifactData = builder.getArtifact(event.artifactId);
                    if (artifactData) {
                        updateArtifact(event.artifactId, { content: artifactData.content });
                    }
                    break;
                }

                case 'artifact_end':
                    builder.endArtifact(event.artifactId);
                    break;

                case 'error':
                    setState((prev) => ({
                        ...prev,
                        isGenerating: false,
                        error: new Error(event.error),
                        streamingMessageId: null,
                    }));
                    break;

                case 'done': {
                    // Finalize the message
                    const finalMessage = builder.buildMessage();
                    setState((prev) => ({
                        ...prev,
                        messages: prev.messages.map((msg) => (msg.id === prev.streamingMessageId ? finalMessage : msg)),
                        isGenerating: false,
                        streamingMessageId: null,
                    }));
                    messageBuilderRef.current = null;
                    break;
                }

                default:
                    // Unknown event type, ignore
                    break;
            }
        },
        [addArtifact, updateArtifact, setCurrentArtifact],
    );

    const sendMessage = useCallback(
        (content: string) => {
            if (!content.trim() || state.isGenerating) return;

            const userMessage = createMessage('user', content);

            const assistantMessageId = uuidv4();
            const assistantMessage = createMessage('assistant', '', assistantMessageId);

            messageBuilderRef.current = new MessageBuilder(assistantMessageId);

            setState((prev) => ({
                ...prev,
                messages: [...prev.messages, userMessage, assistantMessage],
                isGenerating: true,
                error: null,
                streamingMessageId: assistantMessageId,
            }));

            // TODO: Use POST with messages when backend is ready
            // const messagesForApi = [...state.messages, userMessage].map(({ role, content }) => ({
            //     role,
            //     content,
            // }));
            startStream(API_ENDPOINT, { method: 'GET' });
        },
        [state.messages, state.isGenerating, startStream],
    );

    const stopGeneration = useCallback(() => {
        abort();

        if (messageBuilderRef.current) {
            const finalMessage = messageBuilderRef.current.buildMessage();
            setState((prev) => ({
                ...prev,
                messages: prev.messages.map((msg) => (msg.id === prev.streamingMessageId ? finalMessage : msg)),
                isGenerating: false,
                streamingMessageId: null,
            }));
            messageBuilderRef.current = null;
        }
    }, [abort]);

    useEffect(() => {
        const unsubscribe = subscribe(handleStreamEvent);
        return unsubscribe;
    }, [subscribe, handleStreamEvent]);

    return <ChatContext.Provider value={{ state, sendMessage, stopGeneration }}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChatContext must be used within a ChatProvider');
    }
    return context;
}
