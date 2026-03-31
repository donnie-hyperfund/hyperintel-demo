import { Migration } from '@mikro-orm/migrations';

export class Migration20260331120000_AddArtifactVersionIndexes extends Migration {
	override async up(): Promise<void> {
		this.addSql(
			`create index "artifact_versions_chat_id_status_index" on "artifact_versions" ("chat_id", "status");`,
		);
	}

	override async down(): Promise<void> {
		this.addSql(`drop index "artifact_versions_chat_id_status_index";`);
	}
}
