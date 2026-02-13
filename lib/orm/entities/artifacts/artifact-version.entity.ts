import { Entity, Index, ManyToOne, Opt, Property, wrap } from '@mikro-orm/core';
import type { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import type { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';

export { VERSION_STATUSES } from '@/lib/schema/artifact';
export type { VersionStatus } from '@/lib/schema/artifact';

@Entity({ tableName: 'artifact_versions' })
@Index({ properties: ['artifact', 'status'] })
export class ArtifactVersionEntity extends IdCreatedColumns {
    @ManyToOne(() => 'ArtifactEntity', { fieldName: 'artifact_id', serializer: (artifact) => artifact.id })
    artifact!: ArtifactEntity;

    /**
     * The assistant message that created this version.
     * Nullable for backwards compatibility with existing versions created before this field was added.
     * TODO: Consider backfilling old versions if chat association can be inferred.
     */
    @ManyToOne(() => 'ChatMessageEntity', {
        fieldName: 'chat_message_id',
        nullable: true,
        serializer: (msg) => msg?.id,
    })
    chat_message?: ChatMessageEntity;

    @Property({ type: 'int' })
    version!: number;

    @Property({ type: 'text' })
    content!: string;

    @Property({ type: 'text', nullable: true })
    ai_content?: string & Opt;

    @Property({ type: 'text', default: 'approved' })
    status!: VersionStatus & Opt;

    @Property({ type: 'text', nullable: true })
    rejection_reason?: string;

    @Property({ type: 'timestamptz', nullable: true, serializer: (value) => value?.toISOString() })
    status_changed_at?: Date;

    @Property({ type: 'uuid', nullable: true })
    status_changed_by?: string;

    @Property({ type: 'boolean', default: true })
    is_internal: boolean & Opt = true;

    @Property({
        type: 'timestamptz',
        nullable: true,
        defaultRaw: 'now()',
        onUpdate: () => new Date(),
        serializer: (value) => value?.toISOString(),
    })
    updated_at?: Date & Opt;

    /**
     * Custom serialization: ai_content always redacted, content conditional on is_internal.
     */
    toJSON(): Record<string, unknown> {
        const obj = wrap(this).toObject() as Record<string, unknown>;

        delete obj.ai_content;

        if (this.is_internal) {
            delete obj.content;
        }

        return obj;
    }
}
