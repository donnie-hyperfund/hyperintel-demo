'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react';
import { frontendEnv } from '@/lib/env';
import type { WebsocketClient } from './base';
import { DirectWebsocketClient } from './direct';

function getWsUrl(): string {
    if (frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS) {
        return 'ws://localhost:8788/ws';
    }
    if (frontendEnv.NEXT_PUBLIC_LOCAL_WORKER_WS_URL) {
        return frontendEnv.NEXT_PUBLIC_LOCAL_WORKER_WS_URL;
    }
    const alias = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_ALIAS;
    const workerEnv = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV;
    const base = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE;
    const subdomain = [alias, 'hi-services', workerEnv].filter(Boolean).join('-');
    return `wss://${subdomain}.${base}/ws`;
}

const WebsocketContext = createContext<WebsocketClient | null>(null);

export function WebsocketProvider({ children }: { children: ReactNode }) {
    const { getToken, isLoaded } = useAuth();
    const clientRef = useRef<DirectWebsocketClient | null>(null);

    if (!clientRef.current) {
        clientRef.current = new DirectWebsocketClient(getWsUrl());
    }

    useEffect(() => {
        if (!isLoaded) return;

        const client = clientRef.current!;
        client.setTokenProvider(getToken);
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

        // TODO: handle connection setup rejection instead of leaving an unhandled promise.
        void connect();

        return () => {
            cancelled = true;
            client.disconnect();
        };
    }, [getToken, isLoaded]);

    return <WebsocketContext.Provider value={clientRef.current}>{children}</WebsocketContext.Provider>;
}

export function useWebsocket(): WebsocketClient {
    const client = useContext(WebsocketContext);
    if (!client) throw new Error('useWebsocket must be used within a WebsocketProvider');
    return client;
}
