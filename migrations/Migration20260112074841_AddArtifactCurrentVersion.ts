import { Migration } from '@mikro-orm/migrations';

export class Migration20260112074841_AddArtifactCurrentVersion extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "artifacts" drop constraint "artifacts_fk";`);

    this.addSql(`alter table "artifacts" add column "current_version_id" uuid not null;`);
    this.addSql(`alter table "artifacts" add constraint "artifacts_fk" foreign key ("current_version_id") references "artifact_versions" ("id") on update cascade;`);
    this.addSql(`alter table "artifacts" add constraint "artifacts_current_version_id_unique" unique ("current_version_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "artifacts" drop constraint "artifacts_fk";`);

    this.addSql(`alter table "artifacts" drop constraint "artifacts_current_version_id_unique";`);
    this.addSql(`alter table "artifacts" drop column "current_version_id";`);

    this.addSql(`alter table "artifacts" add constraint "artifacts_fk" foreign key ("project_id") references "projects" ("id") on update cascade;`);
  }

}
