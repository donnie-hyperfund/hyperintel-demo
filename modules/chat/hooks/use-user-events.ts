'use client';

import { useEffect, useRef } from 'react';
import type { ServerMessage, UserEventMessage } from '@/lib/schema/ws-protocol';
import { ServerMsg } from '@/lib/schema/ws-protocol';
import { useWebsocket } from '@/lib/websocket/provider';

/**
 * Listen for user-scoped broadcast events on the global WebSocket.
 * These events are sent to ALL user connections (not topic-filtered).
 */
export function useUserEvents(onEvent: (eventType: string, payload: unknown) => void) {
    const ws = useWebsocket();
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;

    useEffect(() => {
        const handler = (msg: ServerMessage & { rid?: string }) => {
            if (msg.type === ServerMsg.UserEvent) {
                const { eventType, payload } = msg as UserEventMessage;
                onEventRef.current(eventType, payload);
            }
        };
        ws.on('message', handler);
        return () => ws.off('message', handler);
    }, [ws]);
}
