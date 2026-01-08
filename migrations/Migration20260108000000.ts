import { Migration } from '@mikro-orm/migrations';

export class Migration20260108000000 extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "users" add column "clerk_id" text null;`);
        this.addSql(`create unique index "users_clerk_id_unique" on "users" ("clerk_id");`);
    }
}
