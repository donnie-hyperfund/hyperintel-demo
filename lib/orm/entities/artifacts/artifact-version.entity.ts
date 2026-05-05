import { Entity, Index, ManyToOne, type Opt, Property, wrap } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import type { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import type { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import type { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';

import type { DocumentType, VersionStatus } from '@/lib/schema/artifact';

export type { DocumentType, VersionStatus } from '@/lib/schema/artifact';
export { DOCUMENT_TYPES, VERSION_STATUSES } from '@/lib/schema/artifact';

@Entity({ tableName: 'artifact_versions' })
@Index({ properties: ['artifact', 'status'] })
export class ArtifactVersionEntity extends IdCreatedColumns {
    @ManyToOne(() => 'ArtifactEntity', { fieldName: 'artifact_id', serializer: (artifact) => artifact.id })
    artifact!: ArtifactEntity;

    @ManyToOne(() => 'ChatEntity', {
        fieldName: 'chat_id',
        nullable: true,
        serializer: (chat) => chat?.id,
    })
    chat?: ChatEntity;

    /**
     * The assistant message that created this version.
     * Nullable for backwards compatibility with existing versions created before this field was added.
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
    title!: string;

    @Property({ type: 'text', nullable: true })
    content?: string;

    @Property({ type: 'text', nullable: true })
    ai_content?: string & Opt;

    @Property({ type: 'text', default: 'approved' })
    status!: VersionStatus & Opt;

    @Property({ type: 'boolean', default: false })
    is_uploaded!: boolean & Opt;

    @Property({ type: 'text', nullable: true })
    rejection_reason?: string;

    @Property({ type: 'timestamptz', nullable: true, serializer: (value) => value?.toISOString() })
    status_changed_at?: Date;

    @Property({ type: 'uuid', nullable: true })
    status_changed_by?: string;

    @Property({ type: 'boolean', default: true })
    is_internal: boolean & Opt = true;

    @Property({ type: 'text', default: 'Other' })
    document_type: DocumentType & Opt = 'Other';

    /** PE-facing summary of this internal document version. Generated automatically on finalize for internal docs. */
    @Property({ type: 'text', nullable: true })
    summary_internal?: string;

    @Property({
        type: 'timestamptz',
        nullable: true,
        defaultRaw: 'now()',
        onUpdate: () => new Date(),
        serializer: (value) => value?.toISOString(),
    })
    updated_at?: Date & Opt;

    /** Free-form provenance bag. Known keys: `restoredFrom` (set by the restore flow). Open for future provenance types. */
    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;

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
