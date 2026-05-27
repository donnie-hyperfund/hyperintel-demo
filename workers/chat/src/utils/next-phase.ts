/**
 * Lookup helper: find the chat that was created as the next phase from a given
 * source chat. The transition flow stamps
 * `metadata.transitionedFrom = <sourceChatId>` on the new phase chat (see
 * `phase-transition/chat-lifecycle.ts` where the new chat is created), which is the only signal of
 * the parent → child phase relationship.
 *
 * The query narrows by `project_id` first (FK index) so the JSON-expression
 * predicate runs against a small per-project subset rather than the whole
 * `chats` table.
 */

import { raw } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';

export async function findNextPhaseChat(
    em: EntityManager,
    opts: { sourceChatId: string; projectId: string },
): Promise<ChatEntity | null> {
    return em.findOne(
        ChatEntity,
        {
            project: opts.projectId,
            [raw("metadata->>'transitionedFrom'")]: opts.sourceChatId,
        },
        { orderBy: { created_at: 'ASC' } },
    );
}
