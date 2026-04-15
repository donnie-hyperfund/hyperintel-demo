import { Migration } from '@mikro-orm/migrations';

export class Migration20260415120000_AddPreferredModelToProjects extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "projects" add column "preferred_model" text;`);
    }
    override async down(): Promise<void> {
        this.addSql(`alter table "projects" drop column "preferred_model";`);
    }
}
