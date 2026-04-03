import { Migration } from '@mikro-orm/migrations';

export class Migration20260403120000_AddChatMessageFiles extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table "chat_message_files" (
        "id" uuid not null default gen_random_uuid(),
        "chat_message_id" uuid null,
        "chat_id" uuid not null,
        "storage_key" text not null,
        "original_name" text not null,
        "mime_type" text not null,
        "size_bytes" int not null,
        "status" text not null default 'pending_upload',
        "created_at" timestamptz(3) not null default now(),
        constraint "chat_message_files_pkey" primary key ("id"),
        constraint "chat_message_files_chat_message_id_foreign" foreign key ("chat_message_id")
          references "chat_messages" ("id") on update cascade on delete set null,
        constraint "chat_message_files_chat_id_foreign" foreign key ("chat_id")
          references "chats" ("id") on update cascade on delete cascade
      );
    `);

    this.addSql(`create index "chat_message_files_chat_message_id_index" on "chat_message_files" ("chat_message_id");`);
    this.addSql(`create index "chat_message_files_chat_id_index" on "chat_message_files" ("chat_id");`);
    this.addSql(`create index "chat_message_files_status_index" on "chat_message_files" ("status");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "chat_message_files";`);
  }

}
