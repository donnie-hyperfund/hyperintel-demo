import { Migration } from '@mikro-orm/migrations';

export class Migration20260521120000_BackfillPublishedLegacyDnaSummaryInternal extends Migration {
    override async up(): Promise<void> {
        this.addSql(`
            UPDATE "artifact_versions" AS dest
            SET "summary_internal" = src."summary_internal"
            FROM "artifacts" AS a
            JOIN "artifact_versions" AS src
              ON src."id"::text = (a."metadata"->'publishedFrom'->>'versionId')
            WHERE dest."artifact_id" = a."id"
              AND a."project_id" IS NULL
              AND a."metadata" ? 'publishedFrom'
              AND dest."summary_internal" IS NULL
              AND src."summary_internal" IS NOT NULL;
        `);
    }
}
