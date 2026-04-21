import { Migration } from '@mikro-orm/migrations';

export class Migration20260421120000_BackfillImportedArtifactSourceChatId extends Migration {
    override async up(): Promise<void> {
        // Source "origin chat" lives in two places depending on how the artifact was created:
        //   - intake uploads set it on artifacts.chat_id
        //   - agent-tool creations set it on artifact_versions.chat_id (the source's current_version)
        // Prefer the version-level chat (matches the live code path), fall back to artifact-level.
        this.addSql(`
            update "artifacts" as dest
            set "metadata" = dest."metadata" || jsonb_build_object('sourceChatId', coalesce(sv."chat_id", src."chat_id")::text)
            from "artifacts" as src
            left join "artifact_versions" as sv on sv."id" = src."current_version_id"
            where dest."metadata" ? 'importedFrom'
              and src."id"::text = dest."metadata"->>'importedFrom'
              -- "authuser" guard: source was owned by the same user who owns the destination's project
              and src."user_id" = (select "user_id" from "projects" where "id" = dest."project_id")
              and coalesce(sv."chat_id", src."chat_id") is not null
              and not (dest."metadata" ? 'sourceChatId');
        `);
    }

    override async down(): Promise<void> {
        this.addSql(`update "artifacts" set "metadata" = "metadata" - 'sourceChatId' where "metadata" ? 'sourceChatId';`);
    }
}
