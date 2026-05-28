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
import { callChatServicesSystemAction } from './chat-services';

/**
 * Known system-event names. Persistence and history reconstruction may switch
 * on these values, so add a string here when introducing a new event kind.
 *
 * - `artifact_approved` — manual user approval via UI.
 * - `artifact_auto_approved` — programmatic approval (e.g. context hard-gate
 *   forces a Completion Brief to auto-approve before phase transition).
 *   Distinct from `artifact_approved` so the transcript does not falsely claim
 *   the user approved.
 * - `artifact_rejected` — manual user rejection via UI.
 * - `artifact_restored` — user proposed a restore of an older version via UI.
 */
export type SystemEventName =
    | 'artifact_approved'
    | 'artifact_auto_approved'
    | 'artifact_rejected'
    | 'artifact_restored';

export interface SystemEventOptions {
    /** Chat to inject the message into */
    chatId: string;
    /** Chat type — determines the WS topic prefix ('intake' vs 'chat') */
    chatType?: string;
    /** Short event name, e.g. 'artifact_approved', 'artifact_rejected' */
    event: SystemEventName;
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
    const prefix = chatType === 'intake' ? 'intake' : 'chat';
    await callChatServicesSystemAction(ctx, {
        action: 'messageCreated',
        prefix,
        identifier: chatId,
        userId: ctx.user.userId,
        previewAlias: ctx.previewAlias,
        message: msg.toJSON(),
    }).catch(console.error);

    return msg;
}
