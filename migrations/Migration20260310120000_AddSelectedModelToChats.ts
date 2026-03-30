import { Migration } from '@mikro-orm/migrations';

export class Migration20260310120000_AddSelectedModelToChats extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "chats" add column "selected_model" text;`);
    }
    override async down(): Promise<void> {
        this.addSql(`alter table "chats" drop column "selected_model";`);
    }
}
