import { Migration } from '@mikro-orm/migrations';

export class Migration20260217120000_AddDocumentTypeToArtifactVersions extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "artifact_versions" add column "document_type" text not null default 'Other';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "artifact_versions" drop column "document_type";`);
  }

}
