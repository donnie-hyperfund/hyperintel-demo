/**
 * System Event Injection — synthetic "user" messages for non-chat actions.
 *
 * When a user performs an action outside of chat (e.g. approving an artifact
 * from the UI), we inject a synthetic message into the chat history so the
 * agent can see what happened. These messages:
 *
 * - Have `role: 'user'` so they appear as context for the model
 * - Wrap content in `<system>…</system>` so the model treats them as events
 * - Carry `metadata.systemEvent` for frontend filtering / display
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { Ctx } from '../context';
import { getUserGatewayStub } from './broadcast';

export interface SystemEventOptions {
    /** Chat to inject the message into */
    chatId: string;
    /** Chat type — determines the WS topic prefix ('intake' vs 'chat') */
    chatType?: string;
    /** Short event name, e.g. 'artifact_approved', 'artifact_rejected' */
    event: string;
    /** Human-readable description the model will see inside <system> tags */
    description: string;
    /** Optional extra metadata stored alongside the message */
    extra?: Record<string, unknown>;
}

/**
 * Inject a synthetic system-event message into a chat.
 * Persists to DB and broadcasts via WebSocket so the frontend receives it.
 */
export async function injectSystemEvent(
    ctx: Pick<Ctx, 'env' | 'user' | 'previewAlias'>,
    em: EntityManager,
    options: SystemEventOptions,
): Promise<ChatMessageEntity> {
    const { chatId, chatType = 'phase', event, description, extra } = options;

    const msg = em.create(ChatMessageEntity, {
        id: crypto.randomUUID(),
        chat: chatId,
        role: 'user',
        content: `<system>${description}</system>`,
        metadata: {
            systemEvent: event,
            ...extra,
        },
    });

    em.persist(msg);
    await em.flush();

    // Broadcast to WS subscribers so frontend can display / filter the event
    const ugStub = getUserGatewayStub(ctx);
    const topic = chatType === 'intake' ? `intake:${chatId}` : `chat:${chatId}`;
    await ugStub
        .systemAction(topic, 'messageCreated', { message: msg.toJSON() }, ctx.previewAlias ?? undefined)
        .catch(console.error);

    return msg;
}
