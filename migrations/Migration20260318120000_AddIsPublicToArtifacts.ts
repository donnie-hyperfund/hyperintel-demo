import { Migration } from '@mikro-orm/migrations';

export class Migration20260318120000_AddIsPublicToArtifacts extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "artifacts" add column "is_public" boolean not null default false;`);
    }

    override async down(): Promise<void> {
        this.addSql(`alter table "artifacts" drop column "is_public";`);
    }
}
