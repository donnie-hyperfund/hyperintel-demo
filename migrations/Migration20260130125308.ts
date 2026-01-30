import { Migration } from '@mikro-orm/migrations';

export class Migration20260130125308 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "artifact_versions" add column "audience" text not null default 'user';`);
  }

}
