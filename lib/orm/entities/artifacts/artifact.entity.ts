import { Entity, ManyToOne, Property, OneToMany, OneToOne, Collection, Unique, Opt } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import type { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import type { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import type { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';

@Entity({ tableName: 'artifacts' })
@Unique({ properties: ['project', 'key'] })
export class ArtifactEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    key!: string;

    @Property({ type: 'text' })
    title!: string;

    @Property({ type: 'int', default: 1 })
    version!: number & Opt;

    @ManyToOne(() => 'ChatEntity', { fieldName: 'chat_id', serializer: (chat) => chat.id })
    chat!: ChatEntity;

    @ManyToOne(() => 'ProjectEntity', { fieldName: 'project_id', serializer: (project) => project.id })
    project!: ProjectEntity;

    @OneToOne(() => 'ArtifactVersionEntity', { fieldName: 'current_version_id', eager: true })
    current_version!: ArtifactVersionEntity;

    @OneToMany(
        () => 'ArtifactVersionEntity',
        (v: ArtifactVersionEntity) => v.artifact,
    )
    versions = new Collection<ArtifactVersionEntity>(this);

    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;
}
