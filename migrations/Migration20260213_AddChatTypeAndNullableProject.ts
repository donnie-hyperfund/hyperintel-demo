import { Migration } from '@mikro-orm/migrations';

export class Migration20260213_AddChatTypeAndNullableProject extends Migration {

    override async up(): Promise<void> {
        // Add type column with default 'phase' for existing chats
        this.addSql(`ALTER TABLE "chats" ADD COLUMN "type" text NOT NULL DEFAULT 'phase';`);

        // Add user_id column (nullable - will be populated for intake chats, backfilled for existing)
        this.addSql(`ALTER TABLE "chats" ADD COLUMN "user_id" uuid NULL;`);
        this.addSql(`ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE CASCADE;`);

        // Backfill user_id from project for existing chats
        this.addSql(`UPDATE "chats" c SET "user_id" = p."user_id" FROM "projects" p WHERE c."project_id" = p."id" AND c."user_id" IS NULL;`);

        // Make project_id nullable (intake chats don't belong to a project)
        this.addSql(`ALTER TABLE "chats" ALTER COLUMN "project_id" DROP NOT NULL;`);
    }

    override async down(): Promise<void> {
        // Restore project_id NOT NULL (delete any intake chats first)
        this.addSql(`DELETE FROM "chats" WHERE "project_id" IS NULL;`);
        this.addSql(`ALTER TABLE "chats" ALTER COLUMN "project_id" SET NOT NULL;`);

        // Drop user_id column
        this.addSql(`ALTER TABLE "chats" DROP CONSTRAINT IF EXISTS "chats_user_id_fk";`);
        this.addSql(`ALTER TABLE "chats" DROP COLUMN "user_id";`);

        // Drop type column
        this.addSql(`ALTER TABLE "chats" DROP COLUMN "type";`);
    }

}
