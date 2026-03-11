import { Entity, Enum, ManyToOne, Opt, Property } from '@mikro-orm/core';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';
import type { ArtifactVersionEntity } from './artifact-version.entity';

export const FILE_STATUSES = ['pending_upload', 'uploaded', 'processing', 'processed', 'error'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

@Entity({ tableName: 'artifact_files' })
export class ArtifactFileEntity extends IdCreatedColumns {
    @ManyToOne(() => 'ArtifactVersionEntity', { fieldName: 'artifact_version_id' })
    artifact_version!: ArtifactVersionEntity;

    @Property({ type: 'text' })
    storage_key!: string;

    @Property({ type: 'text' })
    original_name!: string;

    @Property({ type: 'text' })
    mime_type!: string;

    @Property({ type: 'int' })
    size_bytes!: number;

    @Enum({ items: () => FILE_STATUSES, default: 'uploaded' })
    status: FileStatus & Opt = 'uploaded';

    @Property({ type: 'text', nullable: true })
    extracted_content?: string;

    @Property({ type: 'text', nullable: true })
    extraction_error?: string;
}
