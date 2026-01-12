import { Collection, Entity, ManyToOne, OneToMany, Property } from '@mikro-orm/postgresql';
import { type Nullable } from '@/common/orm/utils';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';

@Entity({ tableName: 'projects' })
export class ProjectEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    name!: string;

    @Property({ type: 'text', nullable: true })
    description?: Nullable<string>;

    @ManyToOne(() => UserEntity)
    user!: UserEntity;

    @OneToMany(() => ChatEntity, (chat) => chat.project)
    chats = new Collection<ChatEntity>(this);
}

