import { Entity, ManyToOne, Property } from '@mikro-orm/core';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';
import type { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';

@Entity({ tableName: 'artifact_versions' })
export class ArtifactVersionEntity extends IdCreatedColumns {
    @ManyToOne('ArtifactEntity', { fieldName: 'artifact_id' })
    artifact!: ArtifactEntity;

    @Property({ type: 'int' })
    version!: number;

    @Property({ type: 'text' })
    content!: string;
}
