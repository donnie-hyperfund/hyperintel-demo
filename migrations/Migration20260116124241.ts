import { Migration } from '@mikro-orm/migrations';

export class Migration20260116124241 extends Migration {
    override async up(): Promise<void> {
        this.addSql(
            `create table "artifact_embeddings" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz(3) not null default now(), "artifact_version_id" uuid not null, "project_id" uuid not null, "chunk_index" int not null, "chunk_content" text not null, "start_line" int not null, "end_line" int not null, "embedding" vector(1024) not null, constraint "artifact_embeddings_pkey" primary key ("id"));`,
        );
        this.addSql(
            `create index "artifact_embeddings_project_id_artifact_version_id_index" on "artifact_embeddings" ("project_id", "artifact_version_id");`,
        );

        this.addSql(
            `alter table "artifact_embeddings" add constraint "artifact_embeddings_fk" foreign key ("project_id") references "projects" ("id") on update cascade;`,
        );

        this.addSql(`
        create index "artifact_embeddings_embedding_idx"
        on "artifact_embeddings"
        using hnsw (embedding vector_cosine_ops)
        with (m = 16, ef_construction = 64);
    `);
    }
}
