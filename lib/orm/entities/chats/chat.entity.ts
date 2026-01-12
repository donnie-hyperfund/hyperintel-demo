import { Collection, Entity, ManyToOne, OneToMany, Property } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import type { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { ChatMessageEntity } from './chat-message.entity';

@Entity({ tableName: 'chats' })
export class ChatEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    phase!: string;

    @Property({ type: 'text', nullable: true })
    summary?: Nullable<string>;

    @ManyToOne('ProjectEntity', { fieldName: 'project_id' })
    project!: ProjectEntity;

    @OneToMany('ChatMessageEntity', (message: ChatMessageEntity) => message.chat)
    messages = new Collection<ChatMessageEntity>(this);

    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;
}
