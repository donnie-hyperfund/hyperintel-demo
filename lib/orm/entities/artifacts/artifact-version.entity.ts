import { Entity, Index, ManyToOne, Opt, Property } from '@mikro-orm/core';
import type { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';

export type VersionStatus = 'proposed' | 'approved' | 'rejected' | 'superseded';

@Entity({ tableName: 'artifact_versions' })
@Index({ properties: ['artifact', 'status'] })
export class ArtifactVersionEntity extends IdCreatedColumns {
    @ManyToOne(() => 'ArtifactEntity', { fieldName: 'artifact_id', serializer: (artifact) => artifact.id })
    artifact!: ArtifactEntity;

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

    @Property({
        type: 'timestamptz',
        nullable: true,
        defaultRaw: 'now()',
        onUpdate: () => new Date(),
        serializer: (value) => value?.toISOString(),
    })
    updated_at?: Date & Opt;
}
