import { Migration } from '@mikro-orm/migrations';

export class Migration20260329120000_AddProjectArchivedAt extends Migration {
    override up(): Promise<void> {
        this.addSql(`alter table "projects" add column "archived_at" timestamptz null;`);
        this.addSql(`create index "projects_user_id_archived_at_index" on "projects" ("user_id", "archived_at");`);
        return Promise.resolve();
    }

    override down(): Promise<void> {
        this.addSql(`drop index if exists "projects_user_id_archived_at_index";`);
        this.addSql(`alter table "projects" drop column "archived_at";`);
        return Promise.resolve();
    }
}
