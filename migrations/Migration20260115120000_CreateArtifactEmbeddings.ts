import { Migration } from '@mikro-orm/migrations';

export class Migration20260115120000_CreateArtifactEmbeddings extends Migration {
    override async up(): Promise<void> {
        this.addSql(`CREATE EXTENSION IF NOT EXISTS vector;`);

        this.addSql(`
            CREATE TABLE "artifact_embeddings" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "created_at" timestamptz(3) NOT NULL DEFAULT now(),
                "artifact_version_id" uuid NOT NULL,
                "project_id" uuid NOT NULL,
                "chunk_index" int NOT NULL,
                "chunk_content" text NOT NULL,
                "start_line" int NOT NULL,
                "end_line" int NOT NULL,
                "embedding" vector(1024) NOT NULL,
                CONSTRAINT "artifact_embeddings_pkey" PRIMARY KEY ("id")
            );
        `);

        this.addSql(`
            CREATE INDEX "artifact_embeddings_project_artifact_version_idx"
            ON "artifact_embeddings" ("project_id", "artifact_version_id");
        `);

        this.addSql(`
            CREATE INDEX "artifact_embeddings_embedding_idx"
            ON "artifact_embeddings"
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);
        `);

        this.addSql(`
            ALTER TABLE "artifact_embeddings"
            ADD CONSTRAINT "artifact_embeddings_artifact_version_fk"
            FOREIGN KEY ("artifact_version_id")
            REFERENCES "artifact_versions" ("id") ON DELETE CASCADE;
        `);

        this.addSql(`
            ALTER TABLE "artifact_embeddings"
            ADD CONSTRAINT "artifact_embeddings_project_fk"
            FOREIGN KEY ("project_id")
            REFERENCES "projects" ("id") ON DELETE CASCADE;
        `);
    }
}

