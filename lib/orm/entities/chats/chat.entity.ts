import { Collection, Entity, ManyToOne, OneToMany, Opt, Property } from '@mikro-orm/core';
import type { Nullable } from '@/common/orm/utils';
import { IdCreatedUpdatedColumns } from '@/lib/orm/entities/columns.entity';
import type { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import type { TokenUsage } from '@/lib/schema/chat';
import type { ChatMessageEntity } from './chat-message.entity';

@Entity({ tableName: 'chats' })
export class ChatEntity extends IdCreatedUpdatedColumns {
    @Property({ type: 'text', default: 'phase' })
    type!: string & Opt;

    @Property({ type: 'text' })
    phase!: string;

    @Property({ type: 'text', nullable: true })
    summary?: Nullable<string>;

    @ManyToOne('ProjectEntity', { fieldName: 'project_id', nullable: true, serializer: (project) => project?.id })
    project?: Nullable<ProjectEntity>;

    @ManyToOne('UserEntity', { fieldName: 'user_id', nullable: true, serializer: (user) => user?.id })
    user?: Nullable<UserEntity>;

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
