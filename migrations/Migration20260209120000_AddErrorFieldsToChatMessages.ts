import { Migration } from '@mikro-orm/migrations';

export class Migration20260209120000_AddErrorFieldsToChatMessages extends Migration {
    override async up(): Promise<void> {
        this.addSql(`ALTER TABLE "chat_messages" ADD COLUMN "is_error" boolean NOT NULL DEFAULT false;`);
        this.addSql(`ALTER TABLE "chat_messages" ADD COLUMN "debug_data" jsonb NULL;`);
    }

    override async down(): Promise<void> {
        this.addSql(`ALTER TABLE "chat_messages" DROP COLUMN "debug_data";`);
        this.addSql(`ALTER TABLE "chat_messages" DROP COLUMN "is_error";`);
    }
}
