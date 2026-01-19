import { Migration } from '@mikro-orm/migrations';

export class Migration20260117053321_AddReasoningBlocksToMessages extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "artifacts" drop constraint "artifacts_fk";`);

        this.addSql(`alter table "chat_messages" add column "reasoning" text null, add column "blocks" jsonb null;`);

        this.addSql(
            `alter table "artifacts" add constraint "artifacts_fk" foreign key ("current_version_id") references "artifact_versions" ("id") on update cascade on delete set null;`,
        );
    }

    override async down(): Promise<void> {
        this.addSql(`alter table "artifacts" drop constraint "artifacts_fk";`);

        this.addSql(`alter table "chat_messages" drop column "reasoning", drop column "blocks";`);

        this.addSql(
            `alter table "artifacts" add constraint "artifacts_fk" foreign key ("current_version_id") references "artifact_versions" ("id") on update cascade;`,
        );
    }
}
