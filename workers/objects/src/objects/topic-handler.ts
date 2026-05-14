/**
 * TopicHandler — interface for domain-specific message handling within the UserGateway DO.
 *
 * Each handler is a module (NOT a separate DO) that runs within the UG's DO context,
 * with access to `ctx.storage` and `env`. UG dispatches messages to handlers based on
 * topic prefix routing, keeping UG itself free of domain-specific logic.
 */

/** Response shape returned by a handler's subscribe method */
export type SubscribeResponse =
    | { status: 'idle'; selectedModel?: string | null; completionBriefStatus?: string | null }
    | {
          status: 'streaming';
          agentMessageId: string;
          snapshot: unknown;
          seqHigh: number;
          streamType?: 'chat' | 'phase_transition';
          selectedModel?: string | null;
          completionBriefStatus?: string | null;
      }
    | { status: 'stale'; selectedModel?: string | null; completionBriefStatus?: string | null };

export type AllowedSubscribe<TSubscribeInfo = unknown> = {
    allowed: true;
    subscribeInfo: TSubscribeInfo;
};

export type SubscribeDecision<TSubscribeInfo = unknown> = { allowed: false } | AllowedSubscribe<TSubscribeInfo>;

/** Result returned by a handler's handleAction method */
export type ActionResult = {
    /** If set, UG broadcasts this to all sockets subscribed to the topic */
    broadcast?: unknown;
    /** Return value for the RPC caller (Worker→UG system action calls) */
    data?: unknown;
};

export interface TopicHandler {
    /** Check if a user is allowed to subscribe to a given identifier (part after prefix) */
    canSubscribe(userId: string, identifier: string, env: ObjectsEnv): Promise<SubscribeDecision>;

    /** Subscribe a user to a topic — returns snapshot or idle status */
    subscribe(
        userId: string,
        identifier: string,
        env: ObjectsEnv,
        decision: AllowedSubscribe,
    ): Promise<SubscribeResponse>;

    /** Unsubscribe a user from a topic */
    unsubscribe(userId: string, identifier: string): void;

    /** Handle a domain-specific action. UG broadcasts result.broadcast if set. */
    handleAction(userId: string, action: string, payload: unknown, env: ObjectsEnv): Promise<ActionResult | void>;

    /** Called when a socket closes. Handler can track connected-ness but should NOT unsubscribe. */
    onSocketClose?(userId: string, identifier: string): void;
}
