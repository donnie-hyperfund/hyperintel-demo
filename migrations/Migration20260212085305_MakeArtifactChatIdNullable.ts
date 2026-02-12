import { Migration } from '@mikro-orm/migrations';

export class Migration20260212085305_MakeArtifactChatIdNullable extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "artifact_versions" add column "chat_id" uuid null;`);
    this.addSql(`alter table "artifact_versions" add constraint "artifact_versions_chat_id_fk" foreign key ("chat_id") references "chats" ("id") on update cascade;`);

    this.addSql(`update "artifact_versions" av set "chat_id" = a."chat_id" from "artifacts" a where av."artifact_id" = a."id";`);

    this.addSql(`alter table "artifacts" drop constraint "artifacts_chat_id_fk";`);
    this.addSql(`alter table "artifacts" drop column "chat_id";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "artifacts" add column "chat_id" uuid null;`);
    this.addSql(`alter table "artifacts" add constraint "artifacts_chat_id_fk" foreign key ("chat_id") references "chats" ("id") on update cascade;`);

    this.addSql(`update "artifacts" a set "chat_id" = sub."chat_id" from (select distinct on ("artifact_id") "artifact_id", "chat_id" from "artifact_versions" where "chat_id" is not null order by "artifact_id", "version" desc) sub where a."id" = sub."artifact_id";`);

    this.addSql(`alter table "artifact_versions" drop constraint "artifact_versions_chat_id_fk";`);
    this.addSql(`alter table "artifact_versions" drop column "chat_id";`);
  }

}
