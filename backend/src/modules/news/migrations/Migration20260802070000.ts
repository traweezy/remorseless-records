import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260802070000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "news_entries" add column if not exists "cover_alt_text" text null;'
    )
    this.addSql(
      'alter table "news_entries" add column if not exists "archived_at" timestamptz null;'
    )
    this.addSql(
      'update "news_entries" set "archived_at" = coalesce("updated_at", now()), "status" = \'draft\' where "status" = \'archived\' and "archived_at" is null;'
    )
    this.addSql(
      'alter table "news_entries" drop constraint if exists "news_entries_status_check";'
    )
    this.addSql(
      "alter table \"news_entries\" add constraint \"news_entries_status_check\" check (\"status\" in ('draft', 'scheduled', 'published', 'archived'));"
    )
    this.addSql(
      'create index if not exists "idx_news_entries_archived_at" on "news_entries" ("archived_at") where "deleted_at" is null;'
    )
    this.addSql(
      'create index if not exists "idx_news_entries_store_visibility" on "news_entries" ("published_at" desc, "created_at" desc, "id") where "deleted_at" is null and "archived_at" is null and "status" in (\'published\', \'scheduled\');'
    )

    this.addSql(
      'create table if not exists "news_operations" (' +
        '"id" text not null,' +
        '"idempotency_key" text not null,' +
        '"command" text not null,' +
        '"aggregate_id" text not null,' +
        '"actor_id" text null,' +
        '"request_sha256" text not null,' +
        '"expected_version" integer not null,' +
        "\"status\" text not null default 'pending'," +
        "\"result\" jsonb not null default '{}'::jsonb," +
        '"completed_at" timestamptz null,' +
        "\"metadata\" jsonb not null default '{}'::jsonb," +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "news_operations_pkey" primary key ("id"),' +
        'constraint "news_operations_idempotency_key_key" unique ("idempotency_key"),' +
        'constraint "news_operations_request_sha256_check" check ("request_sha256" ~ \'^[0-9a-f]{64}$\'),' +
        'constraint "news_operations_expected_version_check" check ("expected_version" >= 0),' +
        "constraint \"news_operations_status_check\" check (\"status\" in ('pending', 'succeeded'))" +
        ");"
    )
    this.addSql(
      'create index if not exists "idx_news_operations_command" on "news_operations" ("command") where "deleted_at" is null;'
    )
    this.addSql(
      'create index if not exists "idx_news_operations_aggregate_id" on "news_operations" ("aggregate_id") where "deleted_at" is null;'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "news_operations" cascade;')
    this.addSql('drop index if exists "idx_news_entries_store_visibility";')
    this.addSql('drop index if exists "idx_news_entries_archived_at";')
    this.addSql(
      'update "news_entries" set "status" = \'archived\' where "archived_at" is not null;'
    )
    this.addSql(
      'update "news_entries" set "status" = \'draft\', "published_at" = null where "status" = \'scheduled\';'
    )
    this.addSql(
      'alter table "news_entries" drop constraint if exists "news_entries_status_check";'
    )
    this.addSql(
      "alter table \"news_entries\" add constraint \"news_entries_status_check\" check (\"status\" in ('draft', 'published', 'archived'));"
    )
    this.addSql(
      'alter table "news_entries" drop column if exists "archived_at";'
    )
    this.addSql(
      'alter table "news_entries" drop column if exists "cover_alt_text";'
    )
  }
}
