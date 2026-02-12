import { Migration } from '@mikro-orm/migrations';

export class Migration20260212085305_MakeArtifactChatIdNullable extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "artifacts" alter column "chat_id" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "artifacts" alter column "chat_id" set not null;`);
  }

}
