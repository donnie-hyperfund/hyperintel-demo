'use client';

import { useEffect } from 'react';
import { type SeedableChatData, useChatContext } from '@/modules/chat/providers/chat-provider';

type ChatStateSeedProps = {
    chatId: string;
    chat: SeedableChatData;
};

export function ChatStateSeed({ chatId, chat }: ChatStateSeedProps) {
    const { chatId: providerChatId, seedChatState } = useChatContext();

    useEffect(() => {
        if (providerChatId !== chatId) return;
        seedChatState(chatId, chat);
    }, [chatId, chat, providerChatId, seedChatState]);

    return null;
}
