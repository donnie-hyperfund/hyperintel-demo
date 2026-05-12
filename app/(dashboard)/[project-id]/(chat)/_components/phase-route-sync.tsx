'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useRouteChatId } from '@/modules/chat/hooks/use-route-chat-id';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function PhaseRouteSync() {
    const chatId = useRouteChatId();
    const searchParams = useSearchParams();
    const { openChat, startNewChat } = useChatContext<'phase'>();
    const isNewIntent = searchParams.has('new');

    useEffect(() => {
        if (chatId) {
            void openChat(chatId);
            return;
        }
        if (isNewIntent) {
            startNewChat();
        }
    }, [chatId, isNewIntent, openChat, startNewChat]);

    return null;
}
