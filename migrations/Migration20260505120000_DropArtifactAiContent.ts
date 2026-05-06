import { Migration } from '@mikro-orm/migrations';

export class Migration20260505120000_DropArtifactAiContent extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "artifact_versions" drop column "ai_content";`);
        this.addSql(`alter table "artifact_embeddings" drop column "is_ai_content";`);
    }

    override async down(): Promise<void> {
        this.addSql(`alter table "artifact_versions" add column "ai_content" text;`);
        this.addSql(`alter table "artifact_embeddings" add column "is_ai_content" boolean default false;`);
    }
}
