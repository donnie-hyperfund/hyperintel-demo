import { Migration } from '@mikro-orm/migrations';

export class Migration20260213094348_AddIsUploadedToArtifactVersions extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "artifact_versions" add column "is_uploaded" boolean not null default false;`);

        this.addSql(
            `update "artifact_versions" set "is_uploaded" = true, "status" = 'approved' where "status" = 'uploaded';`,
        );
    }

    override async down(): Promise<void> {
        this.addSql(`update "artifact_versions" set "status" = 'uploaded' where "is_uploaded" = true;`);

        this.addSql(`alter table "artifact_versions" drop column "is_uploaded";`);
    }
}
