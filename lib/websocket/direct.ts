import { WebsocketClient } from './base';

const PING_INTERVAL = 30_000;
const PING_JITTER = 6_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;

/**
 * DirectWebsocketClient — one real WebSocket per tab.
 *
 * Rewritten from hyperfund's WebsocketClientSimple with all bugs fixed:
 * - Token NOT in URL (uses Sec-WebSocket-Protocol header)
 * - Ping timer starts after hello, not on connect (bug #2)
 * - Ping timer ref stored and cleared on disconnect (bug #3)
 * - Exponential backoff with jitter on reconnect (bug #5)
 * - onerror handler implemented (bug #6)
 * - disconnect() cleans up all timers (bug #7)
 * - No uuid/underscore/JSON5 (bugs #8, #9)
 */
export class DirectWebsocketClient extends WebsocketClient {
    private socket: WebSocket | null = null;
    private shouldConnect = false;
    private pingTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;

    constructor(private readonly url: string) {
        super();
    }

    async connect(accessToken: string): Promise<void> {
        this.shouldConnect = true;

        if (this.isConnected && this.socket) {
            // Already connected — just refresh token if changed
            if (this.accessToken !== accessToken) {
                this.updateSession(accessToken);
            }
            return;
        }

        this.accessToken = accessToken;
        this.attemptConnect();
    }

    disconnect(): void {
        this.shouldConnect = false;
        this.clearTimers();

        const wasConnected = this.isConnected;
        const socket = this.socket;
        this.socket = null;

        if (wasConnected) {
            this.markDisconnected(true);
        }

        if (socket) {
            // Null handlers to prevent reconnect/message processing during teardown
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;
            socket.close(1000, 'client disconnect');
        }
    }

    protected sendRaw(data: string): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(data);
        }
    }

    private attemptConnect(): void {
        // Auth via Sec-WebSocket-Protocol header (not URL query param — bug #4)
        const socket = new WebSocket(this.url, [`access_token-${this.accessToken}`]);
        this.socket = socket;

        socket.onopen = () => {
            if (!this.shouldConnect) {
                socket.close();
                return;
            }
            this.reconnectAttempt = 0;
            // Don't mark connected yet — wait for hello (bug #2)
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

            // First hello triggers connection setup
            if (parsed.type === 'hello' && !this.isConnected) {
                this.schedulePing();
                this.markConnected();
            }

            // All messages (including hello) go through the handler
            this.handleServerMessage(parsed);
        };

        socket.onclose = ({ wasClean }: CloseEvent) => {
            this.clearPing();
            if (this.socket === socket) this.socket = null;

            if (this.isConnected) {
                this.markDisconnected(wasClean);
            }

            if (this.shouldConnect) {
                this.scheduleReconnect();
            }
        };

        // Bug #6: onerror handler — onclose fires after, handles reconnect
        socket.onerror = () => {
            console.warn('WebSocket connection error');
        };
    }

    private scheduleReconnect(): void {
        const base = RECONNECT_BASE_DELAY * 2 ** this.reconnectAttempt;
        const jitter = Math.random() * RECONNECT_BASE_DELAY;
        const delay = Math.min(base + jitter, RECONNECT_MAX_DELAY);
        this.reconnectAttempt++;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldConnect) this.attemptConnect();
        }, delay);
    }

    // Bug #2 fix: only called after hello, not on connect
    // Bug #3 fix: timer ref stored and cleared on disconnect
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

    // Bug #7 fix: disconnect cleans up all timers
    private clearTimers(): void {
        this.clearPing();
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
