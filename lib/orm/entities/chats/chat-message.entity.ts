import { Entity, ManyToOne, Property } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';

@Entity({ tableName: 'chat_messages' })
export class ChatMessageEntity extends IdCreatedColumns {
    @Property({ type: 'text' })
    role!: string;

    @Property({ type: 'text' })
    content!: string;

    @ManyToOne(() => ChatEntity, { fieldName: 'chat_id' })
    chat!: ChatEntity;

    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;
}
