import { Migration } from '@mikro-orm/migrations';

export class Migration20260213120000_AddIsInternalToArtifactVersions extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "artifact_versions" add column "is_internal" boolean not null default true;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "artifact_versions" drop column "is_internal";`);
  }

}
