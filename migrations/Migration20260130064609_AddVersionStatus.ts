import { Migration } from '@mikro-orm/migrations';

export class Migration20260130064609_AddVersionStatus extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "artifact_versions" add column "status" text not null default 'approved', add column "rejection_reason" text null, add column "status_changed_at" timestamptz null, add column "status_changed_by" uuid null, add column "updated_at" timestamptz null default now();`);
    this.addSql(`create index "artifact_versions_artifact_id_status_index" on "artifact_versions" ("artifact_id", "status");`);

    // Backfill: set status_changed_at for existing versions
    this.addSql(`update "artifact_versions" set status_changed_at = created_at where status_changed_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "artifact_versions_artifact_id_status_index";`);
    this.addSql(`alter table "artifact_versions" drop column "status", drop column "rejection_reason", drop column "status_changed_at", drop column "status_changed_by", drop column "updated_at";`);
  }

}
