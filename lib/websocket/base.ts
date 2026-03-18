import type { ClientMessage, ServerMessage } from '@/lib/schema/ws-protocol';
import { ClientAction } from '@/lib/schema/ws-protocol';

// ============================================================================
// TYPED EVENT EMITTER (inline — no external dependency)
// ============================================================================

type EventMap = {
    connected: [];
    disconnected: [clean: boolean];
    message: [message: ServerMessage & { rid?: string }];
};

type EventKey = keyof EventMap;
type Listener<K extends EventKey> = (...args: EventMap[K]) => void;

// ============================================================================
// TYPES
// ============================================================================

type InflightEntry = {
    resolve: (data: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

type PendingEntry = {
    data: string;
    /** Present if this message is a correlated request (for cleanup on timeout) */
    rid?: string;
};

// ============================================================================
// ABSTRACT BASE CLASS
// ============================================================================

/**
 * Abstract WebSocket client with subscription ref-counting, rid-based
 * request/response correlation, and pending message queue.
 *
 * Subclasses implement the wire transport via `connect`, `disconnect`, `sendRaw`.
 *
 * Rewritten from hyperfund's WebsocketClient with all known bugs fixed:
 * - Pending drain uses shift() (no infinite loop)
 * - Inflight on base (shared by Direct + Shared impls)
 * - No uuid/underscore/JSON5 dependencies
 */
export abstract class WebsocketClient {
    // --- Typed event emitter ---

    private _listeners = new Map<EventKey, Set<Listener<any>>>();

    on<K extends EventKey>(event: K, fn: Listener<K>): void {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event)!.add(fn);
    }

    off<K extends EventKey>(event: K, fn: Listener<K>): void {
        this._listeners.get(event)?.delete(fn);
    }

    protected emit<K extends EventKey>(event: K, ...args: EventMap[K]): void {
        this._listeners.get(event)?.forEach((fn) => {
            try {
                fn(...args);
            } catch (e) {
                console.error(`WebsocketClient: error in '${event}' listener:`, e);
            }
        });
    }

    // --- State ---

    /** Per-component ref-counted subscriptions: topic -> subscriberIds[] */
    protected subscriptions: Record<string, string[]> = {};

    /** Pending rid-correlated request callbacks */
    protected inflight = new Map<string, InflightEntry>();

    /** Messages queued while disconnected */
    protected pending: PendingEntry[] = [];

    protected accessToken = '';
    protected isConnected = false;

    /** Clerk getToken callback — injected by provider */
    protected getTokenFn: (() => Promise<string | null>) | null = null;
    private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    /** Whether this client is currently connected and ready */
    get connected(): boolean {
        return this.isConnected;
    }

    // --- Abstract (subclass implements wire transport) ---

    abstract connect(accessToken: string): Promise<void>;
    abstract disconnect(): void;

    /** Send raw string data over the wire (WebSocket or BroadcastChannel). */
    protected abstract sendRaw(data: string): void;

    // --- Send ---

    /** Fire-and-forget send. Queues if disconnected. */
    send(message: ClientMessage): void {
        const data = JSON.stringify(message);
        if (this.isConnected) {
            this.sendRaw(data);
        } else {
            this.pending.push({ data });
        }
    }

    /** Send with rid correlation. Resolves when server responds with matching rid. */
    request<T = unknown>(message: ClientMessage, timeout = 60_000): Promise<T> {
        const rid = crypto.randomUUID();
        const data = JSON.stringify({ ...message, rid });

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.inflight.delete(rid);
                // Remove from pending if still queued
                const idx = this.pending.findIndex((p) => p.rid === rid);
                if (idx !== -1) this.pending.splice(idx, 1);
                reject(new Error(`Request ${rid} timed out`));
            }, timeout);

            this.inflight.set(rid, {
                resolve: (val) => {
                    clearTimeout(timer);
                    resolve(val as T);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
                timer,
            });

            if (this.isConnected) {
                this.sendRaw(data);
            } else {
                this.pending.push({ data, rid });
            }
        });
    }

    // --- Subscription management ---

    /**
     * Subscribe to a topic. Returns an unsubscribe function.
     * Only sends WS subscribe on first ref for a topic, WS unsubscribe on last deref.
     */
    subscribe(topic: string): () => void {
        const sid = crypto.randomUUID();

        if (!this.subscriptions[topic]) {
            this.subscriptions[topic] = [];
        }

        const isFirstRef = this.subscriptions[topic].length === 0;
        this.subscriptions[topic].push(sid);

        if (isFirstRef && this.isConnected) {
            // Only send immediately if connected.
            // If not connected, resubscribeAll() handles it on connect/reconnect.
            this.send({ action: ClientAction.Subscribe, topic });
        }

        let called = false;
        return () => {
            if (called) return;
            called = true;
            this.removeRef(sid, topic);
        };
    }

    private removeRef(sid: string, topic: string): void {
        const subs = this.subscriptions[topic];
        if (!subs) return;

        const idx = subs.indexOf(sid);
        if (idx !== -1) subs.splice(idx, 1);

        if (subs.length === 0) {
            delete this.subscriptions[topic];
            if (this.isConnected) {
                this.send({ action: ClientAction.Unsubscribe, topic });
            }
        }
    }

    // --- Convenience ---

    /** Send a domain-specific action to a topic */
    sendAction(topic: string, type: string, payload?: unknown): void {
        this.send({ action: ClientAction.Action, topic, type, payload });
    }

    /** Refresh session token */
    updateSession(accessToken: string): void {
        this.accessToken = accessToken;
        this.send({ action: ClientAction.UpdateSession, accessToken });
    }

    /** Inject Clerk's getToken so we can proactively refresh the session */
    setTokenProvider(fn: () => Promise<string | null>): void {
        this.getTokenFn = fn;
    }

    // --- Token refresh ---

    /**
     * Schedule a proactive token refresh based on the server-reported expiry.
     * Refreshes at ~75% of remaining TTL with jitter to avoid thundering herd.
     */
    protected scheduleTokenRefresh(expiresAtSec: number): void {
        this.clearTokenRefresh();
        const nowSec = Date.now() / 1000;
        const ttlMs = (expiresAtSec - nowSec) * 1000;
        // Refresh at 75% of remaining TTL, +-3s jitter
        const refreshAt = ttlMs * 0.75 + (Math.random() - 0.5) * 6_000;
        if (refreshAt <= 0) {
            void this.doTokenRefresh();
            return;
        }
        this.tokenRefreshTimer = setTimeout(() => void this.doTokenRefresh(), refreshAt);
    }

    protected clearTokenRefresh(): void {
        if (this.tokenRefreshTimer !== null) {
            clearTimeout(this.tokenRefreshTimer);
            this.tokenRefreshTimer = null;
        }
    }

    private async doTokenRefresh(): Promise<void> {
        if (!this.getTokenFn || !this.isConnected) return;
        try {
            const token = await this.getTokenFn();
            if (token && this.isConnected) {
                this.updateSession(token);
                // Decode new exp to schedule next refresh
                try {
                    const payload = JSON.parse(atob(token.split('.')[1]));
                    if (payload.exp) this.scheduleTokenRefresh(payload.exp);
                } catch {}
            }
        } catch (e) {
            console.warn('WebsocketClient: token refresh failed', e);
        }
    }

    // --- Protected helpers for subclasses ---

    /** Drain pending queue. Uses shift() to avoid infinite loop (hyperfund bug #1). */
    protected drainPending(): void {
        while (this.pending.length > 0) {
            const entry = this.pending.shift()!;
            this.sendRaw(entry.data);
        }
    }

    /** Re-subscribe all tracked topics (call on reconnect after hello). */
    protected resubscribeAll(): void {
        for (const topic of Object.keys(this.subscriptions)) {
            this.sendRaw(JSON.stringify({ action: ClientAction.Subscribe, topic }));
        }
    }

    /** Process parsed server message: resolve matching inflight, emit 'message'. */
    protected handleServerMessage(parsed: Record<string, unknown>): void {
        // Resolve inflight callback if rid matches
        const rid = parsed.rid as string | undefined;
        if (rid && this.inflight.has(rid)) {
            const entry = this.inflight.get(rid)!;
            this.inflight.delete(rid);
            if (parsed.type === 'error') {
                entry.reject(new Error((parsed as { error?: string }).error ?? 'Unknown error'));
            } else {
                entry.resolve(parsed);
            }
        }

        // Start proactive token refresh when hello includes session expiry
        if (parsed.type === 'hello' && typeof parsed.sessionExpiresAt === 'number') {
            this.scheduleTokenRefresh(parsed.sessionExpiresAt);
        }

        // Always emit for topic/type-based listeners
        this.emit('message', parsed as ServerMessage & { rid?: string });
    }

    /** Called by subclass after hello received. Resubscribes, drains pending, emits 'connected'. */
    protected markConnected(): void {
        this.isConnected = true;
        this.resubscribeAll();
        this.drainPending();
        this.emit('connected');
    }

    /** Called by subclass on socket close. */
    protected markDisconnected(clean: boolean): void {
        this.isConnected = false;
        this.clearTokenRefresh();
        this.emit('disconnected', clean);
        // Inflight NOT rejected — they have their own timeouts and may resolve after reconnect.
    }
}
