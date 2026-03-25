'use client';

import { type UseStreamOptions, type UseStreamReturn, useStream } from './use-stream';

export type UseChatStreamOptions = Omit<UseStreamOptions, 'onStreamStarted'> & {
    /** Called when a new stream starts (stream_started WS message) */
    onStreamStarted?: (agentMessageId: string, userMessageId: string, tempId?: string) => void;
};

export type UseChatStreamReturn = UseStreamReturn & {
    approve: (toolCallId: string) => void;
    reject: (toolCallId: string) => void;
};

/**
 * Chat-specific wrapper around the generic `useStream` hook.
 * Adds typed `approve` / `reject` convenience methods for tool approval flow.
 */
export function useChatStream(chatId: string | null, opts: UseChatStreamOptions = {}): UseChatStreamReturn {
    const stream = useStream('chat', chatId, opts);

    const approve = (toolCallId: string) => stream.sendAction('tool_approve', { toolCallId });
    const reject = (toolCallId: string) => stream.sendAction('tool_reject', { toolCallId });

    return { ...stream, approve, reject };
}
