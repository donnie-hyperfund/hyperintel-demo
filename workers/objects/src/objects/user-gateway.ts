import { DurableObject } from 'cloudflare:workers';
import { createClerkClient } from '@clerk/backend';
import { PREVIEW_ALIAS_HEADER } from '@/workers/_common/util/preview-alias';
import { ClientAction, ServerMsg, ClientMessageSchema, type ClientMessage } from '@/lib/schema/ws-protocol';
import type { TopicHandler, ActionResult } from './topic-handler';
import { ChatTopicHandler } from './chat-topic-handler';
import { IntakeTopicHandler } from './intake-topic-handler';
import { StreamTopicHandler } from './stream-topic-handler';

// ---------------------------------------------------------------------------
// Socket attachment — stored per-WebSocket, survives hibernation
// ---------------------------------------------------------------------------

type SocketAttachment = {
    userId: string;
    subscribedTopics: string[];
    sessionExpiry: number | undefined;
};

// ---------------------------------------------------------------------------
// UserGateway DO — per-user WebSocket hub
// ---------------------------------------------------------------------------

/**
 * Generic per-user WebSocket gateway using the Cloudflare Hibernation API.
 *
 * Responsibilities:
 *  - Hold WebSocket connections (multiple tabs = multiple sockets)
 *  - Parse incoming messages, dispatch to registered TopicHandlers by topic prefix
 *  - Receive events from external sources (Stream DOs, workers), forward to
 *    subscribed WebSockets by topic
 *
 * UG has ZERO domain-specific knowledge — all logic is delegated to handlers.
 */
export class UserGateway extends DurableObject<Env> {
    private handlers = new Map<string, TopicHandler>();
    /** Preview branch alias — propagated to topic handlers for DB resolution on dev */
    private previewAlias: string | null = null;
    private aliasLoaded = false;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        // Auto-respond to "ping" with "pong" without waking the DO
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
        // Register topic handlers
        this.registerHandler('chat', new ChatTopicHandler(ctx.storage));
        this.registerHandler('intake', new IntakeTopicHandler(ctx.storage));
    }

    /** Restore previewAlias from storage after hibernation (lazy, once per wake) */
    private async ensureAliasLoaded() {
        if (this.aliasLoaded) return;
        this.aliasLoaded = true;
        const stored = await this.ctx.storage.get<string>('previewAlias');
        if (stored) this.applyPreviewAlias(stored);
    }

    // -----------------------------------------------------------------------
    // Handler registration
    // -----------------------------------------------------------------------

    registerHandler(prefix: string, handler: TopicHandler) {
        this.handlers.set(prefix, handler);
    }

    /**
     * Set the preview alias on the UG and all StreamTopicHandlers.
     * Idempotent — only sets once (first caller wins, all branches isolated via @suffix).
     */
    private applyPreviewAlias(alias: string | null | undefined) {
        if (!alias || this.previewAlias) return;
        this.previewAlias = alias;
        // Persist so it survives hibernation
        this.ctx.storage.put('previewAlias', alias);
        for (const handler of this.handlers.values()) {
            if (handler instanceof StreamTopicHandler) {
                handler.previewAlias = alias;
            }
        }
    }

    // -----------------------------------------------------------------------
    // HTTP fetch — WebSocket upgrade entry point
    // -----------------------------------------------------------------------

    async fetch(request: Request): Promise<Response> {
        const upgradeHeader = request.headers.get('Upgrade');
        if (!upgradeHeader || upgradeHeader !== 'websocket') {
            return new Response('Expected WebSocket upgrade', { status: 426 });
        }

        // Apply preview alias from header (set by services worker on dev)
        this.applyPreviewAlias(request.headers.get(PREVIEW_ALIAS_HEADER));

        // Authenticate via Clerk
        const { userId, expiry, protocols } = await this.authenticateRequest(request);
        if (!userId) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Create WebSocket pair
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        // Accept with a unique tag for identification
        const socketId = crypto.randomUUID();
        this.ctx.acceptWebSocket(server, [socketId]);

        // Store session info in the socket attachment (survives hibernation)
        const attachment: SocketAttachment = {
            userId,
            subscribedTopics: [],
            sessionExpiry: expiry,
        };
        server.serializeAttachment(attachment);

        // Send hello with session expiry so client knows when to refresh
        server.send(
            JSON.stringify({
                type: ServerMsg.Hello,
                userId,
                ...(expiry ? { sessionExpiresAt: expiry } : {}),
            }),
        );

        const headers = new Headers();
        if (protocols) {
            // Echo requested protocol so browser doesn't drop the connection
            const match = protocols.match(/access_token-[^, ]+/);
            if (match) headers.set('Sec-WebSocket-Protocol', match[0]);
        }

        return new Response(null, { status: 101, webSocket: client, headers });
    }

    // -----------------------------------------------------------------------
    // Hibernation API handlers
    // -----------------------------------------------------------------------

    async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
        try {
            if (typeof message !== 'string') {
                message = new TextDecoder().decode(message);
            }
            // Ignore "pong" (auto-response echo)
            if (message === 'pong') return;

            await this.ensureAliasLoaded();
            const attachment = ws.deserializeAttachment() as SocketAttachment;

            // Session expiry check
            if (this.closeIfExpired(ws, attachment)) return;

            const parsed = ClientMessageSchema.parse(JSON.parse(message));
            await this.dispatchMessage(ws, attachment, parsed);
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : 'An unexpected error occurred';
            ws.send(JSON.stringify({ type: ServerMsg.Error, error: errorMsg }));
        }
    }

    async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
        // Do NOT unsubscribe from streams — user might reconnect.
        // Notify handlers so they can optionally track connected-ness.
        const attachment = ws.deserializeAttachment() as SocketAttachment | null;
        if (attachment) {
            for (const topic of attachment.subscribedTopics) {
                const { prefix, identifier } = this.parseTopic(topic);
                const handler = this.handlers.get(prefix);
                handler?.onSocketClose?.(attachment.userId, identifier);
            }
        }
    }

    async webSocketError(ws: WebSocket, error: unknown) {
        console.error('UserGateway: WebSocket error', error);
        try {
            ws.close(1011, 'WebSocket error');
        } catch {}
    }

    // -----------------------------------------------------------------------
    // RPC methods — called by Workers / DOs via DO stub
    // -----------------------------------------------------------------------

    /** Forward an event to all WebSockets subscribed to a topic */
    async pushEvent(topic: string, event: unknown) {
        this.broadcastToTopic(topic, { topic, type: ServerMsg.StreamEvent, event });
    }

    /** Forward a snapshot to all WebSockets subscribed to a topic */
    async pushSnapshot(topic: string, snapshot: unknown) {
        this.broadcastToTopic(topic, { topic, type: ServerMsg.SubscribeResponse, status: 'streaming', snapshot });
    }

    /** Forward a raw message to all WebSockets subscribed to a topic */
    async pushMessage(topic: string, message: unknown) {
        const sockets = this.ctx.getWebSockets();
        let matched = 0;
        for (const ws of sockets) {
            const att = ws.deserializeAttachment() as SocketAttachment | null;
            if (att?.subscribedTopics.includes(topic)) matched++;
        }
        console.log(`[UG] pushMessage: topic=${topic}, sockets=${sockets.length}, matched=${matched}`);
        this.broadcastToTopic(topic, message);
    }

    /**
     * Forward multiple messages atomically to all WebSockets subscribed to a topic.
     * All messages are sent synchronously via ws.send() within a single RPC call,
     * guaranteeing ordered delivery without interleaving from concurrent callers.
     */
    async pushMessages(topic: string, messages: unknown[]) {
        const sockets = this.ctx.getWebSockets();
        for (const ws of sockets) {
            const att = ws.deserializeAttachment() as SocketAttachment | null;
            if (!att?.subscribedTopics.includes(topic)) continue;
            if (this.closeIfExpired(ws, att)) continue;
            for (const msg of messages) {
                try {
                    ws.send(JSON.stringify(msg));
                } catch {}
            }
        }
    }

    /** Generic RPC for server→server actions routed to a handler */
    async systemAction(topic: string, action: string, payload: unknown, previewAlias?: string): Promise<unknown> {
        await this.ensureAliasLoaded();
        if (previewAlias) this.applyPreviewAlias(previewAlias);

        const { prefix, identifier } = this.parseTopic(topic);
        const handler = this.handlers.get(prefix);
        if (!handler) throw new Error(`No handler for prefix: ${prefix}`);
        const result = await handler.handleAction(
            '__system__',
            action,
            { identifier, ...(payload as object) },
            this.env,
        );
        if (result?.broadcast) {
            const sockets = this.ctx.getWebSockets();
            console.log(`[UG] systemAction broadcast: topic=${topic}, action=${action}, sockets=${sockets.length}`);
            this.broadcastToTopic(topic, result.broadcast);
        }
        return result?.data;
    }

    /** Broadcast to ALL connected sockets regardless of subscriptions */
    async broadcastToAll(message: unknown) {
        const serialized = JSON.stringify(message);
        for (const ws of this.ctx.getWebSockets()) {
            const attachment = ws.deserializeAttachment() as SocketAttachment | null;
            if (this.closeIfExpired(ws, attachment)) continue;
            try {
                ws.send(serialized);
            } catch {}
        }
    }

    // -----------------------------------------------------------------------
    // Message dispatch — fully generic routing by topic prefix
    // -----------------------------------------------------------------------

    private async dispatchMessage(ws: WebSocket, attachment: SocketAttachment, msg: ClientMessage) {
        const { userId } = attachment;

        switch (msg.action) {
            case ClientAction.Subscribe: {
                const { prefix, identifier } = this.parseTopic(msg.topic);
                const handler = this.handlers.get(prefix);
                if (!handler) {
                    ws.send(
                        JSON.stringify({
                            type: ServerMsg.Error,
                            error: `No handler for: ${prefix}`,
                            action: msg.action,
                        }),
                    );
                    return;
                }
                const allowed = await handler.canSubscribe(userId, identifier, this.env);
                if (!allowed) {
                    ws.send(JSON.stringify({ type: ServerMsg.Error, error: 'Forbidden', action: msg.action }));
                    return;
                }
                const response = await handler.subscribe(userId, identifier, this.env);
                this.addTopicToSocket(ws, attachment, msg.topic);
                ws.send(JSON.stringify({ topic: msg.topic, type: ServerMsg.SubscribeResponse, ...response }));
                return;
            }

            case ClientAction.Unsubscribe: {
                const { prefix, identifier } = this.parseTopic(msg.topic);
                const handler = this.handlers.get(prefix);
                if (handler) handler.unsubscribe(userId, identifier);
                this.removeTopicFromSocket(ws, attachment, msg.topic);
                return;
            }

            case ClientAction.Action: {
                const { prefix, identifier } = this.parseTopic(msg.topic);
                const handler = this.handlers.get(prefix);
                if (!handler) {
                    ws.send(
                        JSON.stringify({
                            type: ServerMsg.Error,
                            error: `No handler for: ${prefix}`,
                            action: msg.action,
                        }),
                    );
                    return;
                }
                const result = await handler.handleAction(
                    userId,
                    msg.type,
                    { identifier, ...((msg.payload as object) ?? {}) },
                    this.env,
                );
                if (result?.broadcast) {
                    this.broadcastToTopic(msg.topic, result.broadcast);
                }
                return;
            }

            case ClientAction.UpdateSession: {
                this.handleSessionUpdate(ws, attachment, msg.accessToken);
                return;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Topic management — via socket attachment (not ctx.storage)
    // -----------------------------------------------------------------------

    private addTopicToSocket(ws: WebSocket, attachment: SocketAttachment, topic: string) {
        if (!attachment.subscribedTopics.includes(topic)) {
            attachment.subscribedTopics.push(topic);
            ws.serializeAttachment(attachment);
        }
    }

    private removeTopicFromSocket(ws: WebSocket, attachment: SocketAttachment, topic: string) {
        const idx = attachment.subscribedTopics.indexOf(topic);
        if (idx !== -1) {
            attachment.subscribedTopics.splice(idx, 1);
            ws.serializeAttachment(attachment);
        }
    }

    private broadcastToTopic(topic: string, message: unknown) {
        const serialized = typeof message === 'string' ? message : JSON.stringify(message);
        for (const ws of this.ctx.getWebSockets()) {
            const attachment = ws.deserializeAttachment() as SocketAttachment | null;
            if (!attachment?.subscribedTopics.includes(topic)) continue;
            if (this.closeIfExpired(ws, attachment)) continue;
            try {
                ws.send(serialized);
            } catch {}
        }
    }

    // -----------------------------------------------------------------------
    // Auth helpers
    // -----------------------------------------------------------------------

    private async authenticateRequest(
        request: Request,
    ): Promise<{ userId: string | null; expiry: number | undefined; protocols: string | null }> {
        try {
            const secretKey = await this.env.CLERK_SECRET_KEY.get();
            const publishableKey = this.env.CLERK_PUBLISHABLE_KEY;
            const clerkClient = createClerkClient({ secretKey, publishableKey });

            let reqToAuth = request;
            const protocols = request.headers.get('Sec-WebSocket-Protocol');
            if (protocols) {
                const match = protocols.match(/access_token-([^, ]+)/);
                if (match) {
                    reqToAuth = new Request(request, {
                        headers: new Headers(request.headers),
                    });
                    reqToAuth.headers.set('Authorization', `Bearer ${match[1]}`);
                }
            }

            const requestState = await clerkClient.authenticateRequest(reqToAuth, {
                secretKey,
                publishableKey,
            });

            const auth = requestState.toAuth();
            if (!auth?.userId) return { userId: null, expiry: undefined, protocols };

            // Extract expiry from session claims if available
            let expiry: number | undefined;
            try {
                const sessionClaims = auth.sessionClaims as { exp?: number } | undefined;
                expiry = sessionClaims?.exp;
            } catch {}

            return { userId: auth.userId, expiry, protocols };
        } catch (err) {
            console.error('UserGateway: Clerk auth failed', err);
            return { userId: null, expiry: undefined, protocols: null };
        }
    }

    private handleSessionUpdate(ws: WebSocket, attachment: SocketAttachment, accessToken: string) {
        try {
            // Decode JWT to extract expiry (without full verification — Clerk verified on connect)
            const parts = accessToken.split('.');
            if (parts.length === 3) {
                const claims = JSON.parse(atob(parts[1]));
                if (claims.exp) {
                    attachment.sessionExpiry = claims.exp;
                    ws.serializeAttachment(attachment);
                }
            }
        } catch {
            ws.send(
                JSON.stringify({
                    type: ServerMsg.Error,
                    error: 'Error updating session',
                    action: ClientAction.UpdateSession,
                }),
            );
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Grace period (seconds) after JWT exp before force-closing the socket.
     *  Gives the client time to send an update-session with a fresh token. */
    private static readonly SESSION_GRACE_SECONDS = 30;

    /** Close socket if its session has expired (with grace period). Returns true if closed. */
    private closeIfExpired(ws: WebSocket, attachment: SocketAttachment | null): boolean {
        if (attachment?.sessionExpiry && Date.now() / 1000 > attachment.sessionExpiry + UserGateway.SESSION_GRACE_SECONDS) {
            try {
                ws.send(JSON.stringify({ type: ServerMsg.Error, error: 'Session expired' }));
                ws.close(4401, 'Session expired');
            } catch {}
            return true;
        }
        return false;
    }

    /** Parse a topic string like "chat:abc123" into { prefix: "chat", identifier: "abc123" } */
    private parseTopic(topic: string): { prefix: string; identifier: string } {
        const colonIdx = topic.indexOf(':');
        if (colonIdx === -1) return { prefix: topic, identifier: '' };
        return { prefix: topic.slice(0, colonIdx), identifier: topic.slice(colonIdx + 1) };
    }
}
