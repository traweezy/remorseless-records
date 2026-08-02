import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260802053000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "discography_entries" add column if not exists "archived_at" timestamptz null;'
    )
    this.addSql(
      'create index if not exists "idx_discography_entries_archived_at" on "discography_entries" ("archived_at") where "deleted_at" is null;'
    )

    this.addSql(
      'create table if not exists "discography_operations" (' +
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
        'constraint "discography_operations_pkey" primary key ("id"),' +
        'constraint "discography_operations_idempotency_key_key" unique ("idempotency_key"),' +
        'constraint "discography_operations_request_sha256_check" check ("request_sha256" ~ \'^[0-9a-f]{64}$\'),' +
        'constraint "discography_operations_expected_version_check" check ("expected_version" >= 0),' +
        "constraint \"discography_operations_status_check\" check (\"status\" in ('pending', 'succeeded'))" +
        ");"
    )
    this.addSql(
      'create index if not exists "idx_discography_operations_command" on "discography_operations" ("command") where "deleted_at" is null;'
    )
    this.addSql(
      'create index if not exists "idx_discography_operations_aggregate_id" on "discography_operations" ("aggregate_id") where "deleted_at" is null;'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "discography_operations" cascade;')
    this.addSql('drop index if exists "idx_discography_entries_archived_at";')
    this.addSql(
      'alter table "discography_entries" drop column if exists "archived_at";'
    )
  }
}
