import { Entity, Enum, ManyToOne, Opt, Property } from '@mikro-orm/core';
import { IdCreatedColumns } from '@/lib/orm/entities/columns.entity';
import type { ChatMessageEntity } from './chat-message.entity';

export const MESSAGE_FILE_STATUSES = ['pending_upload', 'uploaded'] as const;
export type MessageFileStatus = (typeof MESSAGE_FILE_STATUSES)[number];

@Entity({ tableName: 'chat_message_files' })
export class ChatMessageFileEntity extends IdCreatedColumns {
    @ManyToOne(() => 'ChatMessageEntity', { fieldName: 'chat_message_id', nullable: true })
    chat_message?: ChatMessageEntity;

    /** Chat ID — set at upload time so we can query files before message is created. Nullable for orphan cleanup on chat delete. */
    @Property({ type: 'uuid', nullable: true })
    chat_id?: string | null;

    @Property({ type: 'text' })
    storage_key!: string;

    @Property({ type: 'text' })
    original_name!: string;

    @Property({ type: 'text' })
    mime_type!: string;

    @Property({ type: 'int' })
    size_bytes!: number;

    @Enum({ items: () => MESSAGE_FILE_STATUSES, default: 'pending_upload' })
    status: MessageFileStatus & Opt = 'pending_upload';
}
