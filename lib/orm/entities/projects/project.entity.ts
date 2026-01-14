import { Collection, Entity, ManyToOne, OneToMany, Property } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import type { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';

@Entity({ tableName: 'projects' })
export class ProjectEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    name!: string;

    @Property({ type: 'text', nullable: true })
    description?: Nullable<string>;

    @Property({ type: 'text', nullable: true })
    current_phase?: Nullable<string>;

    @ManyToOne('UserEntity', { fieldName: 'user_id', serializer: (user) => user.id })
    user!: UserEntity;

    @OneToMany('ChatEntity', (chat: ChatEntity) => chat.project)
    chats = new Collection<ChatEntity>(this);

    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;
}
