import { Migration } from '@mikro-orm/migrations';

export class Migration20260213_AddArtifactUserAndNullableProject extends Migration {

    override async up(): Promise<void> {
        // Add user_id column to artifacts
        this.addSql(`ALTER TABLE "artifacts" ADD COLUMN "user_id" uuid NULL;`);
        this.addSql(`ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE CASCADE;`);

        // Backfill user_id from project for existing artifacts
        this.addSql(`UPDATE "artifacts" a SET "user_id" = p."user_id" FROM "projects" p WHERE a."project_id" = p."id" AND a."user_id" IS NULL;`);

        // Make project_id nullable (user-scoped artifacts don't belong to a project)
        this.addSql(`ALTER TABLE "artifacts" ALTER COLUMN "project_id" DROP NOT NULL;`);

        // Replace composite unique constraint with partial indexes
        // Old: UNIQUE(project_id, key) — breaks with NULL project_id
        // New: separate indexes for project-scoped and user-scoped artifacts
        this.addSql(`ALTER TABLE "artifacts" DROP CONSTRAINT IF EXISTS "artifacts_project_id_key_unique";`);
        this.addSql(`CREATE UNIQUE INDEX "artifacts_project_key_unique" ON "artifacts" ("project_id", "key") WHERE "project_id" IS NOT NULL;`);
        this.addSql(`CREATE UNIQUE INDEX "artifacts_user_key_unique" ON "artifacts" ("user_id", "key") WHERE "project_id" IS NULL;`);
    }

    override async down(): Promise<void> {
        // Restore original unique constraint
        this.addSql(`DROP INDEX IF EXISTS "artifacts_user_key_unique";`);
        this.addSql(`DROP INDEX IF EXISTS "artifacts_project_key_unique";`);
        this.addSql(`ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_key_unique" UNIQUE ("project_id", "key");`);

        // Delete user-scoped artifacts and restore NOT NULL
        this.addSql(`DELETE FROM "artifacts" WHERE "project_id" IS NULL;`);
        this.addSql(`ALTER TABLE "artifacts" ALTER COLUMN "project_id" SET NOT NULL;`);

        // Drop user_id
        this.addSql(`ALTER TABLE "artifacts" DROP CONSTRAINT IF EXISTS "artifacts_user_id_fk";`);
        this.addSql(`ALTER TABLE "artifacts" DROP COLUMN "user_id";`);
    }

}
