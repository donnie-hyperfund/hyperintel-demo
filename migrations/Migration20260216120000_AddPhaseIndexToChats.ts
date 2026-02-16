import { Migration } from '@mikro-orm/migrations';

export class Migration20260216120000_AddPhaseIndexToChats extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "chats" add column "phase_index" int not null default 0;`);

    this.addSql(`
      UPDATE "chats" SET "phase_index" = sub.rn - 1
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at ASC) AS rn
        FROM "chats"
      ) sub
      WHERE "chats".id = sub.id;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "chats" drop column "phase_index";`);
  }

}
