import { Migration } from '@mikro-orm/migrations';

export class Migration20260309120000_AddChatIdToArtifactEmbeddings extends Migration {

  override async up(): Promise<void> {
    // -- artifact_embeddings: make project_id nullable, add chat_id --
    this.addSql(`alter table "artifact_embeddings" alter column "project_id" drop not null;`);
    this.addSql(`alter table "artifact_embeddings" add column "chat_id" uuid null;`);
    this.addSql(`alter table "artifact_embeddings" add constraint "artifact_embeddings_chat_id_foreign" foreign key ("chat_id") references "chats" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "artifact_embeddings_chat_id_artifact_version_id_index" on "artifact_embeddings" ("chat_id", "artifact_version_id");`);

    // -- artifacts: add chat_id for chat-scoped artifacts (intake uploads) --
    this.addSql(`alter table "artifacts" add column "chat_id" uuid null;`);
    this.addSql(`alter table "artifacts" add constraint "artifacts_chat_id_foreign" foreign key ("chat_id") references "chats" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "artifacts_chat_id_index" on "artifacts" ("chat_id");`);
  }

  override async down(): Promise<void> {
    // -- artifacts: drop chat_id --
    this.addSql(`drop index "artifacts_chat_id_index";`);
    this.addSql(`alter table "artifacts" drop constraint "artifacts_chat_id_foreign";`);
    this.addSql(`alter table "artifacts" drop column "chat_id";`);

    // -- artifact_embeddings: drop chat_id, restore project_id not null --
    this.addSql(`drop index "artifact_embeddings_chat_id_artifact_version_id_index";`);
    this.addSql(`alter table "artifact_embeddings" drop constraint "artifact_embeddings_chat_id_foreign";`);
    this.addSql(`alter table "artifact_embeddings" drop column "chat_id";`);
    this.addSql(`alter table "artifact_embeddings" alter column "project_id" set not null;`);
  }

}
