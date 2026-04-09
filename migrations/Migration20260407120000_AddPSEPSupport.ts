import { Migration } from '@mikro-orm/migrations';

export class Migration20260407120000_AddPECPSupport extends Migration {
    override async up(): Promise<void> {
        // PECP flag on artifacts (public summaries of internal documents, excluded from lists)
        this.addSql(`alter table "artifacts" add column "is_pecp" boolean not null default false;`);

        // Parent version reference on artifact_versions (links PECP to its source internal doc version)
        this.addSql(`alter table "artifact_versions" add column "parent_version_id" uuid;`);
        this.addSql(
            `alter table "artifact_versions" add constraint "artifact_versions_parent_version_id_foreign" foreign key ("parent_version_id") references "artifact_versions" ("id") on update cascade on delete set null;`,
        );
        this.addSql(
            `create index "artifact_versions_parent_version_id_index" on "artifact_versions" ("parent_version_id");`,
        );
    }

    override async down(): Promise<void> {
        this.addSql(`alter table "artifact_versions" drop constraint "artifact_versions_parent_version_id_foreign";`);
        this.addSql(`alter table "artifact_versions" drop column "parent_version_id";`);
        this.addSql(`alter table "artifacts" drop column "is_pecp";`);
    }
}
