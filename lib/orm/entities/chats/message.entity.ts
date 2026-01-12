import { Entity, Enum, ManyToOne, Property } from '@mikro-orm/postgresql';
import { type Nullable } from '@/common/orm/utils';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import { ChatEntity } from './chat.entity';
import { MessageAuthorType } from './message-author-type.enum';

@Entity({ tableName: 'messages' })
export class MessageEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    content!: string;

    @Enum(() => MessageAuthorType)
    authorType!: MessageAuthorType;

    @ManyToOne(() => ChatEntity)
    chat!: ChatEntity;

    @Property({ type: 'jsonb', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;
}

