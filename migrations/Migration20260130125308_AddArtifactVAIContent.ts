import { Migration } from '@mikro-orm/migrations';

export class Migration20260130125308_AddArtifactVAIContent extends Migration {
    override async up(): Promise<void> {
        this.addSql(`alter table "artifact_versions" add column "ai_content" text;`);
        this.addSql(`alter table "artifact_embeddings" add column "is_ai_content" boolean default false;`);
    }
}
