import { Migration } from '@mikro-orm/migrations';

export class Migration20260422130000_MoveArtifactTitleToVersion extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "artifact_versions" add column "title" text;`);
        this.addSql(`
            update "artifact_versions" as av
            set "title" = a."title"
            from "artifacts" as a
            where av."artifact_id" = a."id";
        `);
        this.addSql(`alter table "artifact_versions" alter column "title" set not null;`);
        this.addSql(`alter table "artifacts" drop column "title";`);
    }

    override async down(): Promise<void> {
        this.addSql(`alter table "artifacts" add column "title" text;`);
        this.addSql(`
            update "artifacts" as a
            set "title" = av."title"
            from "artifact_versions" as av
            where a."current_version_id" = av."id";
        `);
        this.addSql(`
            update "artifacts" as a
            set "title" = (
                select av."title"
                from "artifact_versions" as av
                where av."artifact_id" = a."id"
                order by av."version" desc
                limit 1
            )
            where a."title" is null;
        `);
        this.addSql(`alter table "artifacts" alter column "title" set not null;`);
        this.addSql(`alter table "artifact_versions" drop column "title";`);
    }
}
