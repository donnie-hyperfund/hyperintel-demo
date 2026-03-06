import { makeSecretMock } from '@common/common/local.helpers';
import { MockCFWebSocket, MockDurableObjectNamespace } from '@common/common/local.do-mock';
import { WebSocketServer } from 'ws';
import { backendEnv } from '@/app/api/env';
// eslint-disable-next-line -- require() to avoid pulling worker files into root tsc
const { UserGateway } = require('@/workers/objects/src/objects/user-gateway');
const { ChatStreamDO } = require('@/workers/objects/src/objects/chat-stream-do');

/**
 * Mock env that matches the worker's Env type.
 * Provides all properties expected by InferredContext<Env>.
 */
export const envSecretMocks: Record<string, unknown> = {
    // Secrets (SecretsStoreSecret interface)
    OPENROUTER_API_KEY: makeSecretMock(backendEnv.OPENROUTER_API_KEY!),
    CF_TOKEN: makeSecretMock('TODO'), // backendEnv.CF_GATEWAY_TOKEN!
    ANTHROPIC_API_KEY: makeSecretMock(backendEnv.ANTHROPIC_API_KEY ?? ''),
    DATABASE_URL: makeSecretMock(process.env.DATABASE_URL ?? ''),
    CLERK_SECRET_KEY: makeSecretMock(process.env.CLERK_SECRET_KEY ?? ''),
    LANGFUSE_SECRET_KEY: makeSecretMock(backendEnv.LANGFUSE_SECRET_KEY!),
    AUTH_SECRET: makeSecretMock(process.env.AUTH_SECRET ?? ''),
    OPENAI_KEY: makeSecretMock(process.env.OPENAI_API_KEY ?? ''),
    FIRECRAWL_API_KEY: makeSecretMock(process.env.FIRECRAWL_API_KEY ?? ''),
    // Service Bindings / Queues (mocked)
    EMBEDDING_QUEUE: { send: () => Promise.resolve() } as any,
    // Non-secrets (plain strings)
    CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
    LANGFUSE_ENVIRONMENT: process.env.LANGFUSE_ENVIRONMENT ?? 'Development',
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY ?? '',
    LANGFUSE_HOST: process.env.LANGFUSE_HOST ?? '',
    ENV: process.env.NODE_ENV === 'production' ? 'production' : 'dev',
    CORS_ALLOWED_ORIGIN: '*',
};

// --- DO namespace mocks ---
// Survives hot reload: store actual instances on globalThis so we keep in-memory
// DO state across module re-evaluations. Always re-assign to envSecretMocks
// since that object gets recreated on hot reload.
const DO_KEY = Symbol.for('__hyperintel_dev_do_mocks');
export function ensureDOMocks() {
    let cached = (globalThis as any)[DO_KEY] as { USER_GATEWAY: any; CHAT_STREAM_DO: any } | undefined;
    if (!cached) {
        cached = {
            USER_GATEWAY: new MockDurableObjectNamespace(UserGateway, envSecretMocks),
            CHAT_STREAM_DO: new MockDurableObjectNamespace(ChatStreamDO, envSecretMocks),
        };
        (globalThis as any)[DO_KEY] = cached;
    }
    // Always re-assign — envSecretMocks is a fresh object after hot reload
    envSecretMocks.USER_GATEWAY = cached.USER_GATEWAY;
    envSecretMocks.CHAT_STREAM_DO = cached.CHAT_STREAM_DO;
}

// --- Dev WS server (lazy, starts on first API route hit) ---
// Survives hot reload: globalThis holds the ref so we never double-bind the port.
const WS_KEY = Symbol.for('__hyperintel_dev_wss');
export function ensureDevWsServer() {
    if (process.env.NODE_ENV === 'production') return;
    // Always re-assign DO mocks — envSecretMocks is a fresh object after hot reload
    ensureDOMocks();
    if ((globalThis as any)[WS_KEY]) return;

    const wsPort = Number(process.env.WS_PORT ?? 8788);
    const wss = new WebSocketServer({ port: wsPort, path: '/ws' });
    (globalThis as any)[WS_KEY] = wss;

    wss.on('connection', (rawWs, req) => {
        // Disable Nagle's algorithm — on local, all DO calls are in-process (no network
        // latency between push→broadcast→ws.send), so multiple frames queue in the same
        // event loop tick. Without noDelay, TCP coalesces them into a single segment and
        // the browser receives a batch instead of smooth token-by-token delivery.
        (rawWs as any)._socket?.setNoDelay?.(true);

        // Extract real Clerk userId from JWT in Sec-WebSocket-Protocol header
        let userId = 'dev-user-1';
        const protocols = req.headers['sec-websocket-protocol']?.toString() ?? '';
        const tokenMatch = protocols.match(/access_token-([^, ]+)/);
        if (tokenMatch) {
            try {
                const payload = JSON.parse(Buffer.from(tokenMatch[1].split('.')[1], 'base64').toString());
                if (payload.sub) userId = payload.sub;
            } catch {}
        }
        // Header/query overrides for dev tools
        userId =
            req.headers['x-dev-user-id']?.toString() ??
            new URL(req.url ?? '/', `http://localhost:${wsPort}`).searchParams.get('userId') ??
            userId;

        console.log(`[ws] connected: ${userId}`);

        const ugNamespace = envSecretMocks.USER_GATEWAY as any;
        const ugId = ugNamespace.idFromName(userId);
        const ug = ugNamespace.get(ugId);

        const socketId = crypto.randomUUID();
        const mockWs = new MockCFWebSocket(rawWs, [socketId]);

        ug.ctx.acceptWebSocket(mockWs);
        mockWs.serializeAttachment({ userId, subscribedTopics: [] as string[], sessionExpiry: undefined });
        mockWs.send(JSON.stringify({ type: 'hello', userId }));

        rawWs.on('message', (data: any) => {
            const msg = data.toString();
            if (ug.ctx._handleAutoResponse(mockWs, msg)) return;
            ug.webSocketMessage(mockWs, msg);
        });

        rawWs.on('close', (code: number, reason: any) => {
            console.log(`[ws] disconnected: ${userId} (code=${code})`);
            ug.webSocketClose(mockWs, code, reason?.toString() ?? '', true);
            ug.ctx._removeSocket(mockWs);
        });

        rawWs.on('error', (err: any) => {
            console.error(`[ws] error: ${userId}`, err);
            ug.webSocketError(mockWs, err);
        });
    });

    console.log(`[ws] WebSocket server listening on ws://localhost:${wsPort}/ws`);
}
