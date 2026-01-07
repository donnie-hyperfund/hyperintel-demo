import { Migration } from '@mikro-orm/migrations';

export class Migration20260107082402 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "users" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz(3) not null default now(), "updated_at" timestamptz(3) not null default now(), "email" text not null, "email_confirmed" boolean not null default false, "role" text null, "name" text null, constraint "users_pkey" primary key ("id"));`);
  }

}
