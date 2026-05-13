'use client';

import { useEffect } from 'react';
import { useRouteChatId } from '@/modules/chat/hooks/use-route-chat-id';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function IntakeRouteSync() {
    const chatId = useRouteChatId();
    const { openChat, startNewChat } = useChatContext();

    useEffect(() => {
        if (chatId) {
            void openChat(chatId);
            return;
        }
        startNewChat();
    }, [chatId, openChat, startNewChat]);

    return null;
}
