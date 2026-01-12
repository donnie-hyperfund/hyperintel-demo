import { Collection, Entity, ManyToOne, OneToMany, Property } from '@mikro-orm/postgresql';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { MessageEntity } from './message.entity';

@Entity({ tableName: 'chats' })
export class ChatEntity extends IdCreatedUpdatedColumns {
    @ManyToOne(() => ProjectEntity)
    project!: ProjectEntity;

    @OneToMany(() => MessageEntity, (message) => message.chat)
    messages = new Collection<MessageEntity>(this);
}

