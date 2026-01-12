import { Migration } from '@mikro-orm/migrations';

export class Migration20260112110000 extends Migration {
    override async up(): Promise<void> {
        this.addSql(
            `create table "projects" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz(3) not null default now(), "updated_at" timestamptz(3) not null default now(), "name" text not null, "description" text null, "current_phase" text null, "user_id" uuid not null, "metadata" jsonb null, constraint "projects_pkey" primary key ("id"));`
        );

        this.addSql(
            `create table "chats" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz(3) not null default now(), "updated_at" timestamptz(3) not null default now(), "phase" text not null, "summary" text null, "project_id" uuid not null, "metadata" jsonb null, constraint "chats_pkey" primary key ("id"));`
        );

        this.addSql(
            `create table "chat_messages" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz(3) not null default now(), "role" text not null, "content" text not null, "chat_id" uuid not null, "metadata" jsonb null, constraint "chat_messages_pkey" primary key ("id"));`
        );

        this.addSql(
            `create table "artifacts" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz(3) not null default now(), "updated_at" timestamptz(3) not null default now(), "key" text not null, "title" text not null, "version" int not null default 1, "chat_id" uuid not null, "project_id" uuid not null, "current_version_id" uuid null, "metadata" jsonb null, constraint "artifacts_pkey" primary key ("id"));`
        );
        this.addSql(
            `alter table "artifacts" add constraint "artifacts_project_id_key_unique" unique ("project_id", "key");`
        );

        this.addSql(
            `create table "artifact_versions" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz(3) not null default now(), "artifact_id" uuid not null, "version" int not null, "content" text not null, constraint "artifact_versions_pkey" primary key ("id"));`
        );

        this.addSql(
            `alter table "projects" add constraint "projects_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`
        );

        this.addSql(
            `alter table "chats" add constraint "chats_project_id_foreign" foreign key ("project_id") references "projects" ("id") on update cascade;`
        );

        this.addSql(
            `alter table "chat_messages" add constraint "chat_messages_chat_id_foreign" foreign key ("chat_id") references "chats" ("id") on update cascade;`
        );

        this.addSql(
            `alter table "artifacts" add constraint "artifacts_chat_id_foreign" foreign key ("chat_id") references "chats" ("id") on update cascade;`
        );
        this.addSql(
            `alter table "artifacts" add constraint "artifacts_project_id_foreign" foreign key ("project_id") references "projects" ("id") on update cascade;`
        );
        this.addSql(
            `alter table "artifacts" add constraint "artifacts_current_version_id_foreign" foreign key ("current_version_id") references "artifact_versions" ("id") on update cascade on delete set null;`
        );
        this.addSql(
            `alter table "artifacts" add constraint "artifacts_current_version_id_unique" unique ("current_version_id");`
        );

        this.addSql(
            `alter table "artifact_versions" add constraint "artifact_versions_artifact_id_foreign" foreign key ("artifact_id") references "artifacts" ("id") on update cascade;`
        );
    }
}

