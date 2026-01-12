import {
    Collection,
    Entity,
    OneToMany,
    Property,
} from '@mikro-orm/core';
import { type Nullable } from '@/common/orm/utils';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';

@Entity({ tableName: 'users' })
export class UserEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    email!: string;

    @Property({ type: 'boolean', default: false })
    emailConfirmed!: boolean;

    @Property({ type: 'text', nullable: true })
    role?: Nullable<string>;

    @Property({ type: 'text', nullable: true })
    name?: Nullable<string>;

    @Property({ type: 'text', nullable: true, unique: true })
    clerkId?: Nullable<string>;

    @OneToMany(() => ProjectEntity, (project) => project.user)
    projects = new Collection<ProjectEntity>(this);
}
