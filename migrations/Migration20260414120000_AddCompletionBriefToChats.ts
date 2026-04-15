import { Migration } from '@mikro-orm/migrations';

export class Migration20260414120000_AddCompletionBriefToChats extends Migration {
    override async up(): Promise<void> {
        // FK to the Completion Brief artifact for this phase
        this.addSql(`alter table "chats" add column "completion_brief_id" uuid;`);
        this.addSql(
            `alter table "chats" add constraint "chats_completion_brief_id_foreign" foreign key ("completion_brief_id") references "artifacts" ("id") on update cascade on delete set null;`,
        );
        this.addSql(`create index "chats_completion_brief_id_index" on "chats" ("completion_brief_id");`);

        // Approval status: null = no CB, 'proposed' | 'approved' | 'rejected'
        this.addSql(`alter table "chats" add column "completion_brief_status" text;`);

        // Backfill: link existing Completion Brief artifacts to their chats.
        // Existing CBs were auto-approved by the summarizer, so we find them via
        // artifact_versions with document_type = 'Completion Brief' linked to a chat.
        this.addSql(`
            update "chats" c
            set
                "completion_brief_id" = sub.artifact_id,
                "completion_brief_status" = 'approved'
            from (
                select distinct on (av.chat_id)
                    av.chat_id,
                    av.artifact_id
                from "artifact_versions" av
                where av.document_type = 'Completion Brief'
                  and av.chat_id is not null
                order by av.chat_id, av.created_at desc
            ) sub
            where c.id = sub.chat_id;
        `);
    }

    override async down(): Promise<void> {
        this.addSql(`alter table "chats" drop constraint "chats_completion_brief_id_foreign";`);
        this.addSql(`alter table "chats" drop column "completion_brief_id";`);
        this.addSql(`alter table "chats" drop column "completion_brief_status";`);
    }
}
