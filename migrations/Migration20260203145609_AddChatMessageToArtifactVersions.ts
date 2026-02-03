import { Migration } from '@mikro-orm/migrations';

export class Migration20260203145609_AddChatMessageToArtifactVersions extends Migration {

  override async up(): Promise<void> {
    // Rename FKs from old naming ({table}_fk) to new naming ({table}_{column}_fk)
    // Note: artifacts_chat_id_fk already exists from initial migration - skip it

    this.addSql(`alter table "projects" drop constraint "projects_fk";`);
    this.addSql(`alter table "projects" add constraint "projects_user_id_fk" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "chats" drop constraint "chats_fk";`);
    this.addSql(`alter table "chats" add constraint "chats_project_id_fk" foreign key ("project_id") references "projects" ("id") on update cascade;`);

    this.addSql(`alter table "chat_messages" drop constraint "chat_messages_fk";`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_chat_id_fk" foreign key ("chat_id") references "chats" ("id") on update cascade;`);

    // artifacts_fk points to current_version_id (per Migration20260112074841)
    this.addSql(`alter table "artifacts" drop constraint "artifacts_fk";`);
    this.addSql(`alter table "artifacts" add constraint "artifacts_project_id_fk" foreign key ("project_id") references "projects" ("id") on update cascade;`);
    this.addSql(`alter table "artifacts" add constraint "artifacts_current_version_id_fk" foreign key ("current_version_id") references "artifact_versions" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "artifact_versions" drop constraint "artifact_versions_fk";`);
    this.addSql(`alter table "artifact_versions" add constraint "artifact_versions_artifact_id_fk" foreign key ("artifact_id") references "artifacts" ("id") on update cascade;`);

    this.addSql(`alter table "artifact_embeddings" drop constraint "artifact_embeddings_fk";`);
    this.addSql(`alter table "artifact_embeddings" add constraint "artifact_embeddings_artifact_version_id_fk" foreign key ("artifact_version_id") references "artifact_versions" ("id") on update cascade;`);
    this.addSql(`alter table "artifact_embeddings" add constraint "artifact_embeddings_project_id_fk" foreign key ("project_id") references "projects" ("id") on update cascade;`);

    // Add the new chat_message_id column and FK
    this.addSql(`alter table "artifact_versions" add column "chat_message_id" uuid null;`);
    this.addSql(`alter table "artifact_versions" add constraint "artifact_versions_chat_message_id_fk" foreign key ("chat_message_id") references "chat_messages" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    // Drop the new chat_message_id column and FK
    this.addSql(`alter table "artifact_versions" drop constraint "artifact_versions_chat_message_id_fk";`);
    this.addSql(`alter table "artifact_versions" drop column "chat_message_id";`);

    // Revert FK names back to old naming
    this.addSql(`alter table "projects" drop constraint "projects_user_id_fk";`);
    this.addSql(`alter table "projects" add constraint "projects_fk" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "chats" drop constraint "chats_project_id_fk";`);
    this.addSql(`alter table "chats" add constraint "chats_fk" foreign key ("project_id") references "projects" ("id") on update cascade;`);

    this.addSql(`alter table "chat_messages" drop constraint "chat_messages_chat_id_fk";`);
    this.addSql(`alter table "chat_messages" add constraint "chat_messages_fk" foreign key ("chat_id") references "chats" ("id") on update cascade;`);

    // artifacts_chat_id_fk stays as is (existed before this migration)
    this.addSql(`alter table "artifacts" drop constraint "artifacts_project_id_fk";`);
    this.addSql(`alter table "artifacts" drop constraint "artifacts_current_version_id_fk";`);
    this.addSql(`alter table "artifacts" add constraint "artifacts_fk" foreign key ("current_version_id") references "artifact_versions" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "artifact_versions" drop constraint "artifact_versions_artifact_id_fk";`);
    this.addSql(`alter table "artifact_versions" add constraint "artifact_versions_fk" foreign key ("artifact_id") references "artifacts" ("id") on update cascade;`);

    this.addSql(`alter table "artifact_embeddings" drop constraint "artifact_embeddings_artifact_version_id_fk";`);
    this.addSql(`alter table "artifact_embeddings" drop constraint "artifact_embeddings_project_id_fk";`);
    this.addSql(`alter table "artifact_embeddings" add constraint "artifact_embeddings_fk" foreign key ("project_id") references "projects" ("id") on update cascade;`);
  }

}
