import { Migration } from '@mikro-orm/migrations';

export class Migration20260428120000_AddMetadataToArtifactVersions extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "artifact_versions" add column "metadata" jsonb null;`);
    }

    override async down(): Promise<void> {
        this.addSql(`alter table "artifact_versions" drop column "metadata";`);
    }
}
