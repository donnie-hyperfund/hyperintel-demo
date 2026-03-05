'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { frontendEnv } from '@/lib/env';
import { DirectWebsocketClient } from './direct';
import type { WebsocketClient } from './base';

function getWsUrl(): string {
    if (frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS) {
        return 'ws://localhost:8788/ws';
    }
    const alias = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_ALIAS;
    const workerEnv = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV;
    const base = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE;
    const subdomain = [alias, 'hi-services', workerEnv].filter(Boolean).join('-');
    return `wss://${subdomain}.${base}/ws`;
}

const WebsocketContext = createContext<WebsocketClient | null>(null);

export function WebsocketProvider({ children }: { children: ReactNode }) {
    const { getToken } = useAuth();
    const clientRef = useRef<DirectWebsocketClient | null>(null);

    if (!clientRef.current) {
        clientRef.current = new DirectWebsocketClient(getWsUrl());
    }

    useEffect(() => {
        const client = clientRef.current!;
        let cancelled = false;

        const connect = async () => {
            // In local dev, ensure the WS server is running before connecting
            if (frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS) {
                await fetch('/api/ws-init').catch(() => {});
            }
            const token = await getToken();
            if (cancelled || !token) return;
            client.connect(token);
        };

        connect();

        return () => {
            cancelled = true;
            client.disconnect();
        };
    }, [getToken]);

    return <WebsocketContext.Provider value={clientRef.current}>{children}</WebsocketContext.Provider>;
}

export function useWebsocket(): WebsocketClient {
    const client = useContext(WebsocketContext);
    if (!client) throw new Error('useWebsocket must be used within a WebsocketProvider');
    return client;
}
