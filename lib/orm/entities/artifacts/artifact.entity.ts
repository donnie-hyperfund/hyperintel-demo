import { Collection, Entity, ManyToOne, OneToMany, OneToOne, Opt, Property } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import type { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import type { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';

@Entity({ tableName: 'artifacts' })
export class ArtifactEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    key!: string;

    @Property({ type: 'text' })
    title!: string;

    @Property({ type: 'int', default: 1 })
    version!: number & Opt;

    @ManyToOne(() => 'ProjectEntity', { fieldName: 'project_id', nullable: true, serializer: (project) => project?.id })
    project?: Nullable<ProjectEntity>;

    @ManyToOne(() => 'UserEntity', { fieldName: 'user_id', nullable: true, serializer: (user) => user?.id })
    user?: Nullable<UserEntity>;

    @OneToOne(() => 'ArtifactVersionEntity', { fieldName: 'current_version_id', eager: true, nullable: true })
    current_version!: ArtifactVersionEntity;

    @OneToMany(
        () => 'ArtifactVersionEntity',
        (v: ArtifactVersionEntity) => v.artifact,
    )
    versions = new Collection<ArtifactVersionEntity>(this);

    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;
}
