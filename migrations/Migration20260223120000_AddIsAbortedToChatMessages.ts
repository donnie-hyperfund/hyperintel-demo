import { Migration } from '@mikro-orm/migrations';

export class Migration20260223120000_AddIsAbortedToChatMessages extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "chat_messages" add column "is_aborted" boolean not null default false;`);
    }

    override async down(): Promise<void> {
        this.addSql(`alter table "chat_messages" drop column "is_aborted";`);
    }
}
