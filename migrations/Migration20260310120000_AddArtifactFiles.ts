import { Migration } from '@mikro-orm/migrations';

export class Migration20260310120000_AddArtifactFiles extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table "artifact_files" (
        "id" uuid not null default gen_random_uuid(),
        "artifact_version_id" uuid not null,
        "storage_key" text not null,
        "original_name" text not null,
        "mime_type" text not null,
        "size_bytes" int not null,
        "status" text not null default 'pending_upload',
        "extracted_content" text null,
        "extraction_error" text null,
        "created_at" timestamptz(3) not null default now(),
        constraint "artifact_files_pkey" primary key ("id"),
        constraint "artifact_files_artifact_version_id_foreign" foreign key ("artifact_version_id")
          references "artifact_versions" ("id") on update cascade on delete cascade
      );
    `);

    this.addSql(`create index "artifact_files_artifact_version_id_index" on "artifact_files" ("artifact_version_id");`);
    this.addSql(`create index "artifact_files_status_index" on "artifact_files" ("status");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "artifact_files";`);
  }

}
