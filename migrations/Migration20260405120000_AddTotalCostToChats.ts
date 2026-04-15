import { Migration } from '@mikro-orm/migrations';

export class Migration20260405120000_AddTotalCostToChats extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "chats" add column "total_cost" numeric(12,6);`);
    }
    override async down(): Promise<void> {
        this.addSql(`alter table "chats" drop column "total_cost";`);
    }
}
