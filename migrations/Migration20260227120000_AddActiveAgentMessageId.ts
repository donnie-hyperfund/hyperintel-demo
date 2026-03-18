import { Migration } from '@mikro-orm/migrations';

export class Migration20260227120000_AddActiveAgentMessageId extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "chats" add column "active_agent_message_id" text;`);
    }

    override async down(): Promise<void> {
        this.addSql(`alter table "chats" drop column "active_agent_message_id";`);
    }
}
