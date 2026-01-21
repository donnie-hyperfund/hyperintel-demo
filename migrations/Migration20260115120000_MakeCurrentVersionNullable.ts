import { Migration } from '@mikro-orm/migrations';

export class Migration20260115120000_MakeCurrentVersionNullable extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "artifacts" alter column "current_version_id" drop not null;`);
    }

    override async down(): Promise<void> {
        // Note: This will fail if any NULL values exist
        this.addSql(`alter table "artifacts" alter column "current_version_id" set not null;`);
    }
}
