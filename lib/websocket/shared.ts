import { BroadcastChannel, createLeaderElection, type LeaderElector } from 'broadcast-channel';
import { WebsocketClient } from './base';
import { ClientAction } from '@/lib/schema/ws-protocol';

// ============================================================================
// CROSS-TAB MESSAGE TYPES (over BroadcastChannel)
// ============================================================================

type BCMessage =
    | { cmd: 'send'; data: string } // follower → leader
    | { cmd: 'subscribe'; tabId: string; topics: string[] } // follower → leader
    | { cmd: 'unsubscribe'; tabId: string; topics: string[] } // follower → leader
    | { cmd: 'announce_topics'; tabId: string; topics: string[] } // follower → new leader (failover)
    | { cmd: 'request_status' } // follower → leader
    | { cmd: 'relay'; data: string } // leader → all (WS message)
    | { cmd: 'connected' } // leader → all
    | { cmd: 'disconnected' }; // leader → all

// ============================================================================
// CONSTANTS
// ============================================================================

const PING_INTERVAL = 30_000;
const PING_JITTER = 6_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;
const ELECTION_SETTLE_MS = 100;
const BC_CHANNEL_NAME = 'hi-ws';

// ============================================================================
// SHARED WEBSOCKET CLIENT
// ============================================================================

/**
 * SharedWebsocketClient — single real WebSocket shared across all browser tabs.
 *
 * Uses `broadcast-channel`'s `LeaderElection` to elect one tab as leader.
 * The leader holds the real WebSocket and relays messages to/from followers
 * via BroadcastChannel.
 *
 * Two-level subscription ref counting:
 * 1. Per-component within a tab — base class `subscriptions` map
 * 2. Per-tab across tabs — leader's `tabRefs` map (only last tab deref → WS unsubscribe)
 *
 * Leader failover: new leader opens fresh WS, followers re-announce topics.
 * In-flight requests on dead leader timeout (acceptable for MVP).
 */
export class SharedWebsocketClient extends WebsocketClient {
    private readonly bc: BroadcastChannel<BCMessage>;
    private readonly elector: LeaderElector;
    private readonly tabId = crypto.randomUUID();
    private role: 'undecided' | 'leader' | 'follower' = 'undecided';

    // --- Leader-only: real WebSocket state ---

    private socket: WebSocket | null = null;
    private shouldConnect = false;
    private pingTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;

    /** Leader-only: per-tab subscription tracking. topic → Set<tabId> */
    private tabRefs = new Map<string, Set<string>>();

    constructor(private readonly url: string) {
        super();
        this.bc = new BroadcastChannel<BCMessage>(BC_CHANNEL_NAME);
        this.elector = createLeaderElection(this.bc);
        this.bc.onmessage = (msg: BCMessage) => this.handleBCMessage(msg);
    }

    // ================================================================
    // Lifecycle
    // ================================================================

    async connect(accessToken: string): Promise<void> {
        this.shouldConnect = true;

        if (this.isConnected) {
            if (this.accessToken !== accessToken) this.updateSession(accessToken);
            return;
        }

        this.accessToken = accessToken;

        // Only start election once (role stays set after first connect)
        if (this.role === 'undecided') {
            this.elector.awaitLeadership().then(() => {
                if (this.shouldConnect) this.becomeLeader();
            });

            // Give election a moment to settle
            await new Promise<void>((r) => setTimeout(r, ELECTION_SETTLE_MS));

            // If we didn't win, we're a follower — ask leader for status
            if (!this.elector.isLeader && this.role === 'undecided') {
                this.role = 'follower';
                this.bc.postMessage({ cmd: 'request_status' });
            }
        }
    }

    disconnect(): void {
        this.shouldConnect = false;

        if (this.role === 'leader') {
            this.teardownLeaderWs(true);
        } else if (this.role === 'follower') {
            // Tell leader we're leaving so it can deref our topics
            const topics = Object.keys(this.subscriptions);
            if (topics.length > 0) {
                this.bc.postMessage({
                    cmd: 'unsubscribe',
                    tabId: this.tabId,
                    topics,
                });
            }
            if (this.isConnected) {
                this.markDisconnected(true);
            }
        }

        this.elector.die();
        this.bc.close();
    }

    protected sendRaw(data: string): void {
        if (this.role === 'leader') {
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.socket.send(data);
            }
        } else {
            // Follower: relay through leader via BroadcastChannel
            this.bc.postMessage({ cmd: 'send', data });
        }
    }

    // ================================================================
    // Subscribe override — two-level ref counting
    // ================================================================

    override subscribe(topic: string): () => void {
        const sid = crypto.randomUUID();
        if (!this.subscriptions[topic]) this.subscriptions[topic] = [];

        const isFirstLocalRef = this.subscriptions[topic].length === 0;
        this.subscriptions[topic].push(sid);

        if (isFirstLocalRef) {
            this.onTopicRef(topic);
        }

        let called = false;
        return () => {
            if (called) return;
            called = true;

            const subs = this.subscriptions[topic];
            if (!subs) return;
            const idx = subs.indexOf(sid);
            if (idx !== -1) subs.splice(idx, 1);

            if (subs.length === 0) {
                delete this.subscriptions[topic];
                this.onTopicDeref(topic);
            }
        };
    }

    /** First local component subscribes to this topic. */
    private onTopicRef(topic: string): void {
        if (this.role === 'leader') {
            this.addTabRef(this.tabId, topic);
        } else if (this.isConnected) {
            this.bc.postMessage({
                cmd: 'subscribe',
                tabId: this.tabId,
                topics: [topic],
            });
        }
        // If undecided or disconnected follower: covered by announce_topics on connect
    }

    /** Last local component unsubscribes from this topic. */
    private onTopicDeref(topic: string): void {
        if (this.role === 'leader') {
            this.removeTabRef(this.tabId, topic);
        } else if (this.isConnected) {
            this.bc.postMessage({
                cmd: 'unsubscribe',
                tabId: this.tabId,
                topics: [topic],
            });
        }
    }

    // ================================================================
    // Override resubscribeAll — leader subscribes aggregate topics
    // ================================================================

    protected override resubscribeAll(): void {
        if (this.role !== 'leader') return;

        // Ensure own local topics are in aggregate
        for (const topic of Object.keys(this.subscriptions)) {
            if (!this.tabRefs.has(topic)) this.tabRefs.set(topic, new Set());
            this.tabRefs.get(topic)!.add(this.tabId);
        }

        // Subscribe all aggregate topics on WS
        for (const topic of this.tabRefs.keys()) {
            this.sendRaw(JSON.stringify({ action: ClientAction.Subscribe, topic }));
        }
    }

    // ================================================================
    // Leader: aggregate (cross-tab) ref counting
    // ================================================================

    private addTabRef(tabId: string, topic: string): void {
        let tabs = this.tabRefs.get(topic);
        if (!tabs) {
            tabs = new Set();
            this.tabRefs.set(topic, tabs);
        }

        const isFirstAggregateRef = tabs.size === 0;
        tabs.add(tabId);

        if (isFirstAggregateRef && this.isConnected) {
            this.sendRaw(JSON.stringify({ action: ClientAction.Subscribe, topic }));
        }
    }

    private removeTabRef(tabId: string, topic: string): void {
        const tabs = this.tabRefs.get(topic);
        if (!tabs) return;
        tabs.delete(tabId);

        if (tabs.size === 0) {
            this.tabRefs.delete(topic);
            if (this.isConnected) {
                this.sendRaw(
                    JSON.stringify({
                        action: ClientAction.Unsubscribe,
                        topic,
                    }),
                );
            }
        }
    }

    /** Remove all refs for a departing tab. */
    private removeAllTabRefs(tabId: string): void {
        for (const [topic, tabs] of this.tabRefs) {
            tabs.delete(tabId);
            if (tabs.size === 0) {
                this.tabRefs.delete(topic);
                if (this.isConnected) {
                    this.sendRaw(
                        JSON.stringify({
                            action: ClientAction.Unsubscribe,
                            topic,
                        }),
                    );
                }
            }
        }
    }

    // ================================================================
    // Leader promotion (initial or failover)
    // ================================================================

    private becomeLeader(): void {
        this.role = 'leader';

        // Reset connection — we need a fresh WS
        if (this.isConnected) {
            this.markDisconnected(false);
        }

        // Notify followers so they reset and prepare to re-announce
        this.bc.postMessage({ cmd: 'disconnected' });

        // Seed aggregate with own local topics
        for (const topic of Object.keys(this.subscriptions)) {
            if (!this.tabRefs.has(topic)) this.tabRefs.set(topic, new Set());
            this.tabRefs.get(topic)!.add(this.tabId);
        }

        if (this.shouldConnect) this.attemptConnect();
    }

    // ================================================================
    // Leader: real WebSocket connection (mirrors DirectWebsocketClient)
    // ================================================================

    private attemptConnect(): void {
        const socket = new WebSocket(this.url, [`access_token-${this.accessToken}`]);
        this.socket = socket;

        socket.onopen = () => {
            if (!this.shouldConnect) {
                socket.close();
                return;
            }
            this.reconnectAttempt = 0;
        };

        socket.onmessage = ({ data }: MessageEvent) => {
            if (typeof data !== 'string') return;
            if (data === 'pong') return;

            let parsed: Record<string, unknown>;
            try {
                parsed = JSON.parse(data);
            } catch {
                return;
            }

            if (parsed.type === 'hello' && !this.isConnected) {
                this.schedulePing();
                this.markConnected();
                this.bc.postMessage({ cmd: 'connected' });
            }

            // Process locally (resolves leader's own inflight, emits 'message')
            this.handleServerMessage(parsed);
            // Relay to followers
            this.bc.postMessage({ cmd: 'relay', data });
        };

        socket.onclose = ({ wasClean }: CloseEvent) => {
            this.clearPing();
            if (this.socket === socket) this.socket = null;

            if (this.isConnected) {
                this.bc.postMessage({ cmd: 'disconnected' });
                this.markDisconnected(wasClean);
            }

            if (this.shouldConnect && this.role === 'leader') {
                this.scheduleReconnect();
            }
        };

        socket.onerror = () => {
            console.warn('SharedWebsocketClient: WebSocket error (leader)');
        };
    }

    private teardownLeaderWs(clean: boolean): void {
        this.clearTimers();

        const wasConnected = this.isConnected;
        const socket = this.socket;
        this.socket = null;

        if (wasConnected) {
            this.bc.postMessage({ cmd: 'disconnected' });
            this.markDisconnected(clean);
        }

        if (socket) {
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;
            socket.close(1000, 'leader disconnect');
        }
    }

    // ================================================================
    // Leader: ping & reconnect (same logic as DirectWebsocketClient)
    // ================================================================

    private scheduleReconnect(): void {
        const base = RECONNECT_BASE_DELAY * 2 ** this.reconnectAttempt;
        const jitter = Math.random() * RECONNECT_BASE_DELAY;
        const delay = Math.min(base + jitter, RECONNECT_MAX_DELAY);
        this.reconnectAttempt++;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldConnect && this.role === 'leader') this.attemptConnect();
        }, delay);
    }

    private schedulePing(): void {
        this.clearPing();
        this.pingTimer = setTimeout(
            () => {
                if (this.socket?.readyState === WebSocket.OPEN) {
                    this.socket.send('ping');
                }
                this.schedulePing();
            },
            PING_INTERVAL + (Math.random() - 0.5) * PING_JITTER,
        );
    }

    private clearPing(): void {
        if (this.pingTimer !== null) {
            clearTimeout(this.pingTimer);
            this.pingTimer = null;
        }
    }

    private clearTimers(): void {
        this.clearPing();
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    // ================================================================
    // BroadcastChannel message routing
    // ================================================================

    private handleBCMessage(msg: BCMessage): void {
        if (this.role === 'leader') {
            this.handleBCAsLeader(msg);
        } else {
            this.handleBCAsFollower(msg);
        }
    }

    private handleBCAsLeader(msg: BCMessage): void {
        switch (msg.cmd) {
            case 'send':
                if (this.isConnected) this.sendRaw(msg.data);
                break;

            case 'subscribe':
                for (const topic of msg.topics) this.addTabRef(msg.tabId, topic);
                break;

            case 'unsubscribe':
                for (const topic of msg.topics) this.removeTabRef(msg.tabId, topic);
                break;

            case 'announce_topics':
                // Replace all refs for this tab (clean slate on failover)
                this.removeAllTabRefs(msg.tabId);
                for (const topic of msg.topics) this.addTabRef(msg.tabId, topic);
                break;

            case 'request_status':
                if (this.isConnected) {
                    this.bc.postMessage({ cmd: 'connected' });
                }
                break;
        }
    }

    private handleBCAsFollower(msg: BCMessage): void {
        switch (msg.cmd) {
            case 'relay': {
                let parsed: Record<string, unknown>;
                try {
                    parsed = JSON.parse(msg.data);
                } catch {
                    return;
                }
                this.handleServerMessage(parsed);
                break;
            }

            case 'connected': {
                this.isConnected = true;
                // Announce all local topics to the (possibly new) leader
                const topics = Object.keys(this.subscriptions);
                if (topics.length > 0) {
                    this.bc.postMessage({
                        cmd: 'announce_topics',
                        tabId: this.tabId,
                        topics,
                    });
                }
                this.drainPending();
                this.emit('connected');
                break;
            }

            case 'disconnected':
                if (this.isConnected) {
                    this.isConnected = false;
                    this.emit('disconnected', false);
                }
                break;
        }
    }
}
