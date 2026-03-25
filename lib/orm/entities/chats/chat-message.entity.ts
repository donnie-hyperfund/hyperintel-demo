import { Entity, ManyToOne, Property, wrap } from '@mikro-orm/core';
import type { StreamBlock } from '@/common/ai/agent/types';
import type { Nullable } from '@/common/orm/utils';
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
    @Property({ type: 'json', nullable: true })
    debug_data?: Nullable<Record<string, unknown>>;

    /**
     * Custom JSON serialization with document tool block redaction.
     * Pass serialization groups to control what gets included.
     */
    toJSON(groups?: string[]): Record<string, unknown> {
        const base = wrap(this).toObject() as Record<string, unknown>;
        delete base.debug_data;

        if (this.blocks) {
            base.blocks = this.redactBlocks(this.blocks, groups);
        }

        return base;
    }

    /**
     * Redact write_document/edit_document tool call blocks from chat messages.
     * Always unconditional — the real content lives on ArtifactVersionEntity
     * which handles is_internal visibility via its own toJSON().
     */
    private redactBlocks(blocks: StreamBlock[], groups?: string[]): StreamBlock[] {
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
