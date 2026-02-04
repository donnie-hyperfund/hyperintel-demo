import { Entity, Index, ManyToOne, Opt, Property } from '@mikro-orm/core';
import type { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import type { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';

export type VersionStatus = 'proposed' | 'approved' | 'rejected' | 'superseded';

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

    // TODO: When user roles are implemented, update serializer to show ai_content for admin users
    // Example: serializer: (value, entity, context) => isAdmin(context.user) ? value : undefined
    @Property({ type: 'text', nullable: true, serializer: () => undefined })
    ai_content?: string & Opt;

    @Property({ type: 'text', default: 'approved' })
    status!: VersionStatus & Opt;

    @Property({ type: 'text', nullable: true })
    rejection_reason?: string;

    @Property({ type: 'timestamptz', nullable: true, serializer: (value) => value?.toISOString() })
    status_changed_at?: Date;

    @Property({ type: 'uuid', nullable: true })
    status_changed_by?: string;

    @Property({
        type: 'timestamptz',
        nullable: true,
        defaultRaw: 'now()',
        onUpdate: () => new Date(),
        serializer: (value) => value?.toISOString(),
    })
    updated_at?: Date & Opt;
}
