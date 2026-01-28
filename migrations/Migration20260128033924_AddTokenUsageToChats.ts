import { Migration } from '@mikro-orm/migrations';

export class Migration20260128033924_AddTokenUsageToChats extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "chats" add column "token_usage" jsonb null;`);
    }
}
