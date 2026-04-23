import { Migration } from '@mikro-orm/migrations';

export class Migration20260422120000_AddIsDraftToArtifacts extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "artifacts" add column "is_draft" boolean not null default false;`);
        // Partial index covering the hot path: project resources list filters on (project_id, is_draft=false).
        this.addSql(
            `create index "artifacts_project_id_is_draft_index" on "artifacts" ("project_id", "is_draft") where "project_id" is not null;`,
        );
    }

    override async down(): Promise<void> {
        this.addSql(`drop index if exists "artifacts_project_id_is_draft_index";`);
        this.addSql(`alter table "artifacts" drop column "is_draft";`);
    }
}
