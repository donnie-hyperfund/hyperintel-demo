import { Collection, Entity, ManyToOne, OneToMany, Property } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import type { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { TokenUsage } from '@/lib/schema/chat';
import type { ChatMessageEntity } from './chat-message.entity';

@Entity({ tableName: 'chats' })
export class ChatEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text' })
    phase!: string;

    @Property({ type: 'number', default: 0 })
    phase_index!: number;

    @Property({ type: 'text', nullable: true })
    summary?: Nullable<string>;

    @ManyToOne('ProjectEntity', { fieldName: 'project_id', serializer: (project) => project.id })
    project!: ProjectEntity;

    @OneToMany('ChatMessageEntity', (message: ChatMessageEntity) => message.chat)
    messages = new Collection<ChatMessageEntity>(this);

    @Property({ type: 'json', nullable: true })
    metadata?: Nullable<Record<string, unknown>>;

    @Property({ type: 'json', nullable: true })
    token_usage?: Nullable<TokenUsage>;

    @Property({ type: 'number', persist: false })
    message_count?: number;

    @Property({ type: 'boolean', persist: false })
    has_pending_changes?: boolean;

    @Property({ type: 'text', persist: false })
    first_message_content?: Nullable<string>;
}
