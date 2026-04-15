import { Entity, ManyToOne, Property, wrap } from '@mikro-orm/core';
import type { StreamBlock } from '@/common/ai/agent/types';
import type { Nullable } from '@/common/orm/utils';
import { hasGroup } from '@/common/orm/serialization';
import type { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';

@Entity({ tableName: 'chat_messages' })
export class ChatMessageEntity extends IdCreatedColumns {
    @Property({ type: 'text' })
    role!: string;

    @Property({ type: 'text' })
    content!: string;

    @Property({ type: 'text', nullable: true })
    reasoning?: Nullable<string>;

    @Property({ type: 'json', nullable: true })
    blocks?: Nullable<StreamBlock[]>;

    @ManyToOne('ChatEntity', { fieldName: 'chat_id', serializer: (chat) => chat.id })
    chat!: ChatEntity;

    @Property({ type: 'boolean', default: false })
    is_error?: boolean;

    @Property({ type: 'boolean', default: false })
    is_aborted?: boolean;

    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;

    @Property({ type: 'boolean', nullable: true })
    feedback_score?: Nullable<boolean>;

    @Property({ type: 'text', nullable: true })
    feedback?: Nullable<string>;

    /** Internal debug data (serialized errors, raw responses, inference logs). Never sent to frontend. */
    @Property({ type: 'json', nullable: true, hidden: true })
    debug_data?: Nullable<Record<string, unknown>>;

    /**
     * Custom JSON serialization with document tool block redaction.
     * - `debug_data` is hidden via `@Property({ hidden: true })` — never in toObject output.
     * - Dev-only metadata fields stripped unless `dev` group is active (deployment-level).
     * - Document tool blocks always redacted (content lives on ArtifactVersionEntity).
     *
     * Group access is resolved automatically via the entity's EM (ScopedEntityManager) —
     * no need to pass groups as a parameter.
     */
    toJSON(): Record<string, unknown> {
        const base = wrap(this).toObject() as Record<string, unknown>;

        // Strip dev-only fields from metadata when not in dev deployment
        if (!hasGroup(this, 'dev') && base.metadata) {
            const meta = { ...(base.metadata as Record<string, unknown>) };
            delete meta.preset;
            delete meta.inference;
            delete meta.usage;
            base.metadata = Object.keys(meta).length > 0 ? meta : null;
        }

        if (this.blocks) {
            base.blocks = this.redactBlocks(this.blocks);
        }

        return base;
    }

    /**
     * Redact write_document/edit_document tool call blocks from chat messages.
     * Always unconditional — the real content lives on ArtifactVersionEntity
     * which handles is_internal visibility via its own toJSON().
     */
    private redactBlocks(blocks: StreamBlock[]): StreamBlock[] {
        return blocks.map((b) => {
            if (b.type === 'tool_call' && ['write_document', 'edit_document', 'patch_document'].includes(b.toolName)) {
                return {
                    ...b,
                    content: 'REDACTED',
                    toolInput: 'REDACTED',
                    toolOutput: 'REDACTED',
                };
            }
            return b;
        });
    }
}
