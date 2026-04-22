import { Collection, Entity, ManyToOne, OneToMany, OneToOne, type Opt, Property } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import type { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import type { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
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

    /** Chat scope — for intake uploads (artifacts scoped to a specific chat) */
    @ManyToOne(() => 'ChatEntity', { fieldName: 'chat_id', nullable: true, serializer: (chat) => chat?.id })
    chat?: Nullable<ChatEntity>;

    @OneToOne(() => 'ArtifactVersionEntity', { fieldName: 'current_version_id', eager: true, nullable: true })
    current_version!: ArtifactVersionEntity;

    @OneToMany(
        () => 'ArtifactVersionEntity',
        (v: ArtifactVersionEntity) => v.artifact,
    )
    versions = new Collection<ArtifactVersionEntity>(this);

    /** Public artifacts are global read-only resources available to all projects (e.g. Company Profile) */
    @Property({ type: 'boolean', default: false })
    is_public!: boolean & Opt;

    /** PECP artifacts are public summaries of internal documents, excluded from list endpoints */
    @Property({ type: 'boolean', default: false })
    is_pecp!: boolean & Opt;

    /** Chat-input uploads start as drafts and are hidden from the project resources list until the send flow clears the flag. */
    @Property({ type: 'boolean', default: false })
    is_draft!: boolean & Opt;

    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;
}
