import { Entity, ManyToOne, Property, OneToMany, Collection } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';

@Entity({ tableName: 'projects' })
export class ProjectEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    name!: string;

    @Property({ type: 'text', nullable: true })
    description?: Nullable<string>;

    @Property({ type: 'text', nullable: true })
    current_phase?: Nullable<string>;

    @ManyToOne(() => UserEntity, { fieldName: 'user_id' })
    user!: UserEntity;

    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;
}
