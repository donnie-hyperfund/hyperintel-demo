import { z } from 'zod';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import createNeonSql from '@/workers/_common/vendor/neon';
import type { StreamEvent, StreamSnapshot } from './chat-stream-do';
import type { ActionResult, SubscribeResponse, TopicHandler } from './topic-handler';

// ============================================================================
// CHAT STREAM DO RPC INTERFACE (same-worker DO — typed for RPC calls)
// ============================================================================

export interface ChatStreamDOStub {
    init(
        chatId: string,
        agentMessageId: string,
        userMessageId: string,
        topicPrefix?: string,
        previewAlias?: string,
    ): Promise<void>;

    /** Push events with a sequence number for reorder-safe fire-and-forget delivery. */
    push(events: StreamEvent[], seq: number): Promise<void>;
    subscribe(userId: string, ugDoName: string): Promise<StreamSnapshot>;
    unsubscribe(userId: string): Promise<void>;
    abort(): Promise<void>;
    toolApprove(toolCallId: string): Promise<void>;
    toolReject(toolCallId: string): Promise<void>;
    /**
     * Resolve a pending user-decision long-poll.
     * `freeText` is populated when the user picked "Other" and typed a custom answer.
     */
    decisionSelect(toolCallId: string, value: string, freeText?: string): Promise<void>;
    /**
     * Dismiss a pending user-decision long-poll without picking — resolves it
     * with `null` (the agent's tool gets the cancelled path).
     */
    decisionDismiss(toolCallId: string): Promise<void>;
}

// ============================================================================
// SHARED SCHEMAS
// ============================================================================

const AbortActionSchema = z.object({ identifier: z.string() });

// Storage key prefix for the stream registry (shared by all streaming topic handlers)
export const STREAM_SK_PREFIX = 'stream:registry:';

// ============================================================================
// STREAM TOPIC HANDLER — ABSTRACT BASE CLASS
// ============================================================================

/**
 * StreamTopicHandler — abstract base class for topic handlers that manage ChatStreamDO streaming.
 *
 * Provides shared logic for:
 *  - Permission checking (via abstract `checkPermission()`)
 *  - Stream registry: `identifier → agentMessageId` in DO storage
 *  - Subscribe flow: idle / streaming (with snapshot) / stale DO cleanup
 *  - Unsubscribe: no-op (DO expiry handles cleanup)
 *  - Abort action: forwarded to ChatStreamDO
 *
 * Subclasses must implement:
 *  - `checkPermission(userId, id, env)` — domain-specific DB permission check
 *  - `handleAction(userId, action, payload, env)` — domain-specific actions.
 *    Call `super.handleAction()` to handle the shared 'abort' case.
 *
 * Each subclass should define its own storage key prefix to avoid collisions:
 *  ```typescript
 *  protected get skPrefix() { return 'intake:stream:'; }
 *  ```
 */
export abstract class StreamTopicHandler implements TopicHandler {
    /** In-memory permission cache: `${userId}:${identifier}` → allowed */
    // TODO: re-enable once we confirm the forbidden bug is fixed — disabled to rule out stale cache as cause
    // private permissionCache = new Map<string, boolean>();
    /** Cached postgres client — avoids reconnecting per query */
    private sqlPromise: ReturnType<typeof createNeonSql> | null = null;
    /** Preview branch alias — set by UG on dev, used for PREVIEW_DB_MAP KV resolution */
    previewAlias: string | null = null;

    constructor(protected storage: DurableObjectStorage) {}

    // ========================================================================
    // ABSTRACT METHODS (implemented by subclasses)
    // ========================================================================

    /**
     * Domain-specific permission check.
     * Result is cached in-memory for the lifetime of the UG DO instance.
     */
    abstract checkPermission(userId: string, identifier: string, env: Env): Promise<boolean>;

    // ========================================================================
    // STORAGE KEY PREFIX (overridable by subclasses)
    // ========================================================================

    /**
     * Storage key prefix for this handler's stream registry.
     * Subclasses MUST override to avoid key collisions between handlers.
     * Default: uses the shared constant — subclasses provide their own prefix (e.g., 'chat:stream:', 'intake:stream:').
     */
    protected get skPrefix(): string {
        return STREAM_SK_PREFIX;
    }

    // ========================================================================
    // PERMISSION CHECK
    // ========================================================================

    async canSubscribe(userId: string, identifier: string, env: Env): Promise<boolean> {
        // const cacheKey = `${userId}:${identifier}`;
        // const cached = this.permissionCache.get(cacheKey);
        // if (cached !== undefined) return cached;

        try {
            const allowed = await this.checkPermission(userId, identifier, env);
            if (!allowed) {
                console.warn(
                    `[${this.constructor.name}] canSubscribe DENIED: userId=${userId}, identifier=${identifier}, previewAlias=${this.previewAlias}`,
                );
            }
            // this.permissionCache.set(cacheKey, allowed);
            return allowed;
        } catch (err) {
            console.error(
                `[${this.constructor.name}] canSubscribe ERROR: userId=${userId}, identifier=${identifier}, previewAlias=${this.previewAlias}`,
                err,
            );
            return false;
        }
    }

    // ========================================================================
    // SUBSCRIBE
    // ========================================================================

    async subscribe(userId: string, identifier: string, env: Env): Promise<SubscribeResponse> {
        const agentMessageId = await this.storage.get<string>(`${this.skPrefix}${identifier}`);

        if (!agentMessageId) {
            return { status: 'idle' };
        }

        // Active stream — try to subscribe to ChatStream DO
        try {
            const stub = this.getStreamStub(env, agentMessageId);
            // UG DO name = userId (or userId@alias on dev preview branches)
            const snapshot = await stub.subscribe(userId, branchDoName(userId, this.previewAlias));
            if (snapshot.status === 'done' || snapshot.status === 'aborted' || snapshot.status === 'error') {
                await this.cleanupStreamKeys(identifier);
                await this.clearActiveAgentMessageId(identifier, agentMessageId, env);
                return { status: 'idle' };
            }
            return { status: 'streaming', agentMessageId, snapshot };
        } catch (err) {
            // ChatStream DO is gone (already finalized) — stale registry entry
            console.warn(`${this.constructor.name}: ChatStream DO gone for ${identifier}, cleaning up`, err);
            await this.cleanupStreamKeys(identifier);
            // Also clear activeAgentMessageId on the entity (lazy fallback cleanup)
            await this.clearActiveAgentMessageId(identifier, agentMessageId, env);
            return { status: 'idle' };
        }
    }

    // ========================================================================
    // UNSUBSCRIBE
    // ========================================================================

    unsubscribe(_userId: string, _identifier: string): void {
        // No-op — UG doesn't unsubscribe from streams on close.
        // ChatStream DO subscriber cleanup happens on finalize().
    }

    // ========================================================================
    // ACTION HANDLING (base handles 'abort'; subclasses handle domain actions)
    // ========================================================================

    async handleAction(_userId: string, action: string, payload: unknown, env: Env): Promise<ActionResult | void> {
        switch (action) {
            case 'abort': {
                const { identifier } = AbortActionSchema.parse(payload);
                const stub = await this.resolveStream(identifier, env);
                if (stub) await stub.abort();
                return;
            }

            default:
                throw new Error(`${this.constructor.name}: unknown action "${action}"`);
        }
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    /**
     * Delete all stream registry keys for a given identifier.
     * Base implementation deletes only the `skPrefix + identifier` key.
     * Subclasses that store additional suffix keys (e.g., streamType) should override.
     */
    protected async cleanupStreamKeys(identifier: string): Promise<void> {
        await this.storage.delete(`${this.skPrefix}${identifier}`);
    }

    /** Resolve identifier → ChatStream DO stub. Returns null if no active stream. */
    protected async resolveStream(identifier: string, env: Env): Promise<ChatStreamDOStub | null> {
        const agentMessageId = await this.storage.get<string>(`${this.skPrefix}${identifier}`);
        if (!agentMessageId) return null;
        return this.getStreamStub(env, agentMessageId);
    }

    /** Get ChatStream DO stub from the local binding */
    protected getStreamStub(env: Env, agentMessageId: string): ChatStreamDOStub {
        const id = env.CHAT_STREAM_DO.idFromName(branchDoName(agentMessageId, this.previewAlias));
        return env.CHAT_STREAM_DO.get(id) as unknown as ChatStreamDOStub;
    }

    /** Clear activeAgentMessageId on the Chat entity (lazy fallback for stale DOs) */
    protected async clearActiveAgentMessageId(identifier: string, agentMessageId: string, env: Env): Promise<void> {
        try {
            const sql = await this.getSql(env);
            await sql`
				UPDATE chats SET active_agent_message_id = NULL
				WHERE id = ${identifier} AND active_agent_message_id = ${agentMessageId}
			`;
        } catch (err) {
            console.error(`${this.constructor.name}: failed to clear activeAgentMessageId`, err);
        }
    }

    /** Get (or initialize) a postgres client for DB queries */
    protected getSql(env: Env) {
        if (!this.sqlPromise) {
            this.sqlPromise = createNeonSql(env, this.previewAlias ?? undefined);
        }
        return this.sqlPromise;
    }
}
