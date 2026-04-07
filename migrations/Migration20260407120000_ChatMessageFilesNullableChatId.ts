import { Migration } from '@mikro-orm/migrations';

export class Migration20260407120000_ChatMessageFilesNullableChatId extends Migration {

  override async up(): Promise<void> {
    // Make chat_id nullable
    this.addSql(`alter table "chat_message_files" alter column "chat_id" drop not null;`);

    // Change FK from cascade delete to set null (so files survive chat deletion for cleanup)
    this.addSql(`alter table "chat_message_files" drop constraint "chat_message_files_chat_id_foreign";`);
    this.addSql(`
      alter table "chat_message_files"
        add constraint "chat_message_files_chat_id_foreign"
        foreign key ("chat_id") references "chats" ("id")
        on update cascade on delete set null;
    `);
  }

  override async down(): Promise<void> {
    // Delete orphaned rows first so NOT NULL can be restored
    this.addSql(`delete from "chat_message_files" where "chat_id" is null;`);

    this.addSql(`alter table "chat_message_files" drop constraint "chat_message_files_chat_id_foreign";`);
    this.addSql(`
      alter table "chat_message_files"
        add constraint "chat_message_files_chat_id_foreign"
        foreign key ("chat_id") references "chats" ("id")
        on update cascade on delete cascade;
    `);

    this.addSql(`alter table "chat_message_files" alter column "chat_id" set not null;`);
  }

}
