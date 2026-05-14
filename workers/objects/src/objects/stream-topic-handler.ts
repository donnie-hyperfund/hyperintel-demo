import { z } from 'zod';
import type { ClearActiveStreamRequest } from '@/lib/schema/stream-cleanup';
import type { StreamTopicPrefix } from '@/lib/schema/stream-topic';
import type { SubscribeInfoRequest } from '@/lib/schema/subscribe-info';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import { writeStreamMetric } from '@/workers/_common/vendor/analytics-engine';
import type { StreamEvent, StreamSubscribeResult } from './chat-stream-do';
import type {
    ActionResult,
    AllowedSubscribe,
    SubscribeDecision,
    SubscribeResponse,
    TopicHandler,
} from './topic-handler';

// ============================================================================
// CHAT STREAM DO RPC INTERFACE (same-worker DO — typed for RPC calls)
// ============================================================================

export interface ChatStreamDOStub {
    init(
        chatId: string,
        agentMessageId: string,
        userMessageId: string,
        topicPrefix?: StreamTopicPrefix,
        previewAlias?: string,
    ): Promise<void>;

    /** Push events with a sequence number for reorder-safe fire-and-forget delivery. */
    push(events: StreamEvent[], seq: number): Promise<void>;
    subscribe(userId: string, ugDoName: string): Promise<StreamSubscribeResult>;
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

export type SubscribePolicyResult = { allowed: boolean };

// ============================================================================
// STREAM TOPIC HANDLER — ABSTRACT BASE CLASS
// ============================================================================

/**
 * StreamTopicHandler — abstract base class for topic handlers that manage ChatStreamDO streaming.
 *
 * Provides shared logic for:
 *  - Permission checking through a subclass-provided subscribe policy request
 *  - Stream registry: `identifier → agentMessageId` in DO storage
 *  - Subscribe flow: idle / streaming (with snapshot) / stale DO cleanup
 *  - Unsubscribe: no-op (DO expiry handles cleanup)
 *  - Abort action: forwarded to ChatStreamDO
 *
 * Subclasses must implement:
 *  - `topicPrefix` — topic namespace used for services policy/cleanup requests
 *  - `handleAction(userId, action, payload, env)` — domain-specific actions.
 *    Call `super.handleAction()` to handle the shared 'abort' case.
 *
 * Each subclass should define its own storage key prefix to avoid collisions:
 *  ```typescript
 *  protected get skPrefix() { return 'intake:stream:'; }
 *  ```
 */
export abstract class StreamTopicHandler<TSubscribeInfo extends SubscribePolicyResult = SubscribePolicyResult>
    implements TopicHandler
{
    /** In-memory permission cache: `${userId}:${identifier}` → allowed */
    // TODO: re-enable once we confirm the forbidden bug is fixed — disabled to rule out stale cache as cause
    // private permissionCache = new Map<string, boolean>();
    /** Preview branch alias — set by UG on dev, used for PREVIEW_DB_MAP KV resolution */
    previewAlias: string | null = null;

    constructor(protected storage: DurableObjectStorage) {}

    // ========================================================================
    // ABSTRACT METHODS (implemented by subclasses)
    // ========================================================================

    /** Topic namespace used for service policy/cleanup requests. */
    protected abstract readonly topicPrefix: StreamTopicPrefix;

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

    async canSubscribe(
        userId: string,
        identifier: string,
        env: ObjectsEnv,
    ): Promise<SubscribeDecision<TSubscribeInfo>> {
        // const cacheKey = `${userId}:${identifier}`;
        // const cached = this.permissionCache.get(cacheKey);
        // if (cached !== undefined) return cached;

        try {
            const info = await this.fetchSubscribeInfo(userId, identifier, env);
            if (!info.allowed) {
                console.warn(
                    `[${this.constructor.name}] canSubscribe DENIED: userId=${userId}, identifier=${identifier}, previewAlias=${this.previewAlias}`,
                );
                return { allowed: false };
            }
            // this.permissionCache.set(cacheKey, allowed);
            return { allowed: true, subscribeInfo: info };
        } catch (err) {
            console.error(
                `[${this.constructor.name}] canSubscribe ERROR: userId=${userId}, identifier=${identifier}, previewAlias=${this.previewAlias}`,
                err,
            );
            return { allowed: false };
        }
    }

    // ========================================================================
    // SUBSCRIBE
    // ========================================================================

    async subscribe(
        userId: string,
        identifier: string,
        env: ObjectsEnv,
        _decision: AllowedSubscribe<TSubscribeInfo>,
    ): Promise<SubscribeResponse> {
        const agentMessageId = await this.storage.get<string>(`${this.skPrefix}${identifier}`);

        if (!agentMessageId) {
            return { status: 'idle' };
        }

        // Active stream — try to subscribe to ChatStream DO
        try {
            const stub = this.getStreamStub(env, agentMessageId);
            // UG DO name = userId (or userId@alias on dev preview branches)
            const { snapshot, seqHigh } = await stub.subscribe(userId, branchDoName(userId, this.previewAlias));
            if (snapshot.status === 'done' || snapshot.status === 'aborted' || snapshot.status === 'error') {
                await this.cleanupStreamKeys(identifier);
                await this.clearActiveAgentMessageId(identifier, agentMessageId, env);
                return { status: 'idle' };
            }
            return { status: 'streaming', agentMessageId, snapshot, seqHigh };
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

    async handleAction(
        _userId: string,
        action: string,
        payload: unknown,
        env: ObjectsEnv,
    ): Promise<ActionResult | void> {
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
    protected async resolveStream(identifier: string, env: ObjectsEnv): Promise<ChatStreamDOStub | null> {
        const agentMessageId = await this.storage.get<string>(`${this.skPrefix}${identifier}`);
        if (!agentMessageId) return null;
        return this.getStreamStub(env, agentMessageId);
    }

    /** Get ChatStream DO stub from the local binding */
    protected getStreamStub(env: ObjectsEnv, agentMessageId: string): ChatStreamDOStub {
        const id = env.CHAT_STREAM_DO.idFromName(branchDoName(agentMessageId, this.previewAlias));
        return env.CHAT_STREAM_DO.get(id) as unknown as ChatStreamDOStub;
    }

    private topicName(identifier: string): string {
        return `${this.topicPrefix}:${identifier}`;
    }

    private buildSubscribeInfoRequest(userId: string, identifier: string): SubscribeInfoRequest {
        return {
            userId,
            topic: this.topicName(identifier),
            prefix: this.topicPrefix,
            identifier,
            previewAlias: this.previewAlias ?? undefined,
        };
    }

    private async fetchSubscribeInfo(userId: string, identifier: string, env: ObjectsEnv): Promise<TSubscribeInfo> {
        // Metadata is returned by the same policy RPC, so there is no separate services_metadata_rpc metric.
        return this.trackServicesRpc(
            env,
            () => env.CHAT_SERVICES.getTopicSubscribeInfo(this.buildSubscribeInfoRequest(userId, identifier)),
            {
                metric: 'services_permission_rpc',
                identifier,
                successDoubles: (info) => [(info as TSubscribeInfo).allowed ? 1 : 0],
            },
        ) as Promise<TSubscribeInfo>;
    }

    private buildClearActiveStreamRequest(identifier: string, agentMessageId: string): ClearActiveStreamRequest {
        return {
            topic: this.topicName(identifier),
            prefix: this.topicPrefix,
            identifier,
            agentMessageId,
            previewAlias: this.previewAlias ?? undefined,
        };
    }

    /** Clear activeAgentMessageId on the Chat entity (lazy fallback for stale DOs) */
    protected async clearActiveAgentMessageId(
        identifier: string,
        agentMessageId: string,
        env: ObjectsEnv,
    ): Promise<void> {
        try {
            await this.trackServicesRpc(
                env,
                () =>
                    env.CHAT_SERVICES.clearActiveStream(this.buildClearActiveStreamRequest(identifier, agentMessageId)),
                {
                    metric: 'services_stale_cleanup_rpc',
                    identifier,
                    agentMessageId,
                },
            );
        } catch (err) {
            console.error(`${this.constructor.name}: failed to clear activeAgentMessageId`, err);
        }
    }

    private async trackServicesRpc<T>(
        env: ObjectsEnv,
        fn: () => Promise<T>,
        options: {
            metric: string;
            identifier: string;
            agentMessageId?: string;
            successDoubles?: (result: T) => number[];
        },
    ): Promise<T> {
        const t0 = performance.now();
        try {
            const result = await fn();
            this.writeServicesRpcMetric(env, options, performance.now() - t0, true, options.successDoubles?.(result));
            return result;
        } catch (err) {
            this.writeServicesRpcMetric(env, options, performance.now() - t0, false);
            throw err;
        }
    }

    private writeServicesRpcMetric(
        env: ObjectsEnv,
        options: {
            metric: string;
            identifier: string;
            agentMessageId?: string;
        },
        durationMs: number,
        success: boolean,
        extraDoubles: number[] = [],
    ) {
        writeStreamMetric(env, {
            metric: options.metric,
            // Permission checks happen before the active stream lookup, so agentMessageId is not always known.
            // In that path indexes[0] falls back to the topic identifier.
            indexes: [options.agentMessageId ?? options.identifier],
            blobs: [options.identifier, this.previewAlias, options.agentMessageId, this.topicPrefix],
            doubles: [durationMs, success ? 1 : 0, ...extraDoubles],
        });
    }
}
