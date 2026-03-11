import { Migration } from '@mikro-orm/migrations';

export class Migration20260311130000_ArtifactVersionContentNullable extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "artifact_versions" alter column "content" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "artifact_versions" alter column "content" set not null;`);
  }

}
