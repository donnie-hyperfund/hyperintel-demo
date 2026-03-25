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

import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { EntityManager } from '@mikro-orm/postgresql';

export interface SystemEventOptions {
    /** Chat to inject the message into */
    chatId: string;
    /** Short event name, e.g. 'artifact_approved', 'artifact_rejected' */
    event: string;
    /** Human-readable description the model will see inside <system> tags */
    description: string;
    /** Optional extra metadata stored alongside the message */
    extra?: Record<string, unknown>;
}

/**
 * Inject a synthetic system-event message into a chat.
 * Returns the persisted ChatMessageEntity (already flushed).
 */
export async function injectSystemEvent(
    em: EntityManager,
    options: SystemEventOptions,
): Promise<ChatMessageEntity> {
    const { chatId, event, description, extra } = options;

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

    return msg;
}
