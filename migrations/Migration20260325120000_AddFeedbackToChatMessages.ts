import { Migration } from '@mikro-orm/migrations';

export class Migration20260325120000_AddFeedbackToChatMessages extends Migration {
	override async up(): Promise<void> {
		this.addSql(`alter table "chat_messages" add column "feedback_score" boolean null;`);
		this.addSql(`alter table "chat_messages" add column "feedback" text null;`);
	}

	override async down(): Promise<void> {
		this.addSql(`alter table "chat_messages" drop column "feedback_score";`);
		this.addSql(`alter table "chat_messages" drop column "feedback";`);
	}
}
