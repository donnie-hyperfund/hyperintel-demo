import { Migration } from '@mikro-orm/migrations';

export class Migration20260401120000_AddNameToChats extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "chats" add column "name" text;`);
    }
    override async down(): Promise<void> {
        this.addSql(`alter table "chats" drop column "name";`);
    }
}
