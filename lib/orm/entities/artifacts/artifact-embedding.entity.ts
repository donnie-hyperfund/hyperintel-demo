import { Entity, Index, ManyToOne, Property } from '@mikro-orm/core';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';
import type { ProjectEntity } from '../projects/project.entity';
import type { ArtifactVersionEntity } from './artifact-version.entity';

@Entity({ tableName: 'artifact_embeddings' })
@Index({ properties: ['project', 'artifact_version'] })
export class ArtifactEmbeddingEntity extends IdCreatedColumns {
    @ManyToOne(() => 'ArtifactVersionEntity', { fieldName: 'artifact_version_id' })
    artifact_version!: ArtifactVersionEntity;

    @ManyToOne(() => 'ProjectEntity', { fieldName: 'project_id' })
    project!: ProjectEntity;

    @Property({ type: 'int' })
    chunk_index!: number;

    @Property({ type: 'text' })
    chunk_content!: string;

    @Property({ type: 'int' })
    start_line!: number;

    @Property({ type: 'int' })
    end_line!: number;

    @Property({ columnType: 'vector(1024)' })
    embedding!: number[];
}
