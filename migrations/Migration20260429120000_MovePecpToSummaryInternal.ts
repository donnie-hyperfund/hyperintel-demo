import { Migration } from '@mikro-orm/migrations';

export class Migration20260429120000_MovePecpToSummaryInternal extends Migration {
    override async up(): Promise<void> {
        // Step 1: add summary_internal column on artifact_versions
        this.addSql(`alter table "artifact_versions" add column "summary_internal" text;`);

        // Step 2: copy the latest PECP content into summary_internal on the parent version it belonged to.
        // Each parent version has at most one approved PECP version pointing at it via parent_version_id;
        // the DISTINCT ON guards against duplicates by keeping the highest-numbered PECP per parent.
        this.addSql(`
            UPDATE "artifact_versions" parent
            SET "summary_internal" = pecp.content
            FROM (
                SELECT DISTINCT ON (parent_version_id)
                    "parent_version_id",
                    "content"
                FROM "artifact_versions"
                WHERE "parent_version_id" IS NOT NULL
                  AND "document_type" = 'PECP'
                  AND "content" IS NOT NULL
                ORDER BY "parent_version_id", "version" DESC
            ) AS pecp
            WHERE parent."id" = pecp."parent_version_id";
        `);

        // Step 3: delete PECP artifact versions, then their owning artifacts.
        // The parent_version_id FK is ON DELETE SET NULL so deleting PECP rows is safe even before drop.
        this.addSql(`DELETE FROM "artifact_versions" WHERE "artifact_id" IN (SELECT "id" FROM "artifacts" WHERE "is_pecp" = true);`);
        this.addSql(`DELETE FROM "artifacts" WHERE "is_pecp" = true;`);

        // Step 4: drop the parent_version FK + index + column from artifact_versions
        this.addSql(`alter table "artifact_versions" drop constraint "artifact_versions_parent_version_id_foreign";`);
        this.addSql(`drop index "artifact_versions_parent_version_id_index";`);
        this.addSql(`alter table "artifact_versions" drop column "parent_version_id";`);

        // Step 5: drop is_pecp from artifacts
        this.addSql(`alter table "artifacts" drop column "is_pecp";`);
    }

    override async down(): Promise<void> {
        // Reverse only restores the schema. Original PECP artifact rows are NOT reconstructed —
        // they were merged into summary_internal on the parent version and that data is preserved
        // there if the column survives the rollback.
        this.addSql(`alter table "artifacts" add column "is_pecp" boolean not null default false;`);

        this.addSql(`alter table "artifact_versions" add column "parent_version_id" uuid;`);
        this.addSql(
            `alter table "artifact_versions" add constraint "artifact_versions_parent_version_id_foreign" foreign key ("parent_version_id") references "artifact_versions" ("id") on update cascade on delete set null;`,
        );
        this.addSql(
            `create index "artifact_versions_parent_version_id_index" on "artifact_versions" ("parent_version_id");`,
        );

        this.addSql(`alter table "artifact_versions" drop column "summary_internal";`);
    }
}
