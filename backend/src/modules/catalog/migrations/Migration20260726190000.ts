import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726190000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create table if not exists "catalog_authoring_operations" (' +
        '"id" text not null,' +
        '"idempotency_key" text not null,' +
        '"command" text not null,' +
        '"aggregate_id" text not null,' +
        '"actor_id" text null,' +
        '"request_sha256" text not null,' +
        '"expected_version" integer not null,' +
        "\"status\" text check (\"status\" in ('pending', 'succeeded', 'failed', 'compensated')) not null default 'pending'," +
        "\"result\" jsonb not null default '{}'::jsonb," +
        '"error_code" text null,' +
        '"error_detail" text null,' +
        '"completed_at" timestamptz null,' +
        "\"metadata\" jsonb not null default '{}'::jsonb," +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_authoring_operations_pkey" primary key ("id"),' +
        'constraint "catalog_authoring_operations_idempotency_key_key" unique ("idempotency_key"),' +
        'constraint "catalog_authoring_operations_request_sha256_check" check ("request_sha256" ~ \'^[0-9a-f]{64}$\'),' +
        'constraint "catalog_authoring_operations_expected_version_check" check ("expected_version" >= 0)' +
        ");"
    )
    this.addSql(
      'create index if not exists "idx_catalog_authoring_operations_command" on "catalog_authoring_operations" ("command") where "deleted_at" is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_authoring_operations_aggregate_id" on "catalog_authoring_operations" ("aggregate_id") where "deleted_at" is null;'
    )

    this.addSql(
      'create table if not exists "catalog_bundle_inventory_links" (' +
        '"id" text not null,' +
        '"bundle_profile_id" text not null,' +
        '"bundle_variant_id" text not null,' +
        '"inventory_item_id" text not null,' +
        '"required_quantity" integer not null,' +
        "\"metadata\" jsonb not null default '{}'::jsonb," +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_bundle_inventory_links_pkey" primary key ("id"),' +
        'constraint "catalog_bundle_inventory_links_required_quantity_check" check ("required_quantity" >= 1)' +
        ");"
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_inventory_links_bundle_profile_id" on "catalog_bundle_inventory_links" ("bundle_profile_id") where "deleted_at" is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_inventory_links_bundle_variant_id" on "catalog_bundle_inventory_links" ("bundle_variant_id") where "deleted_at" is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_inventory_links_inventory_item_id" on "catalog_bundle_inventory_links" ("inventory_item_id") where "deleted_at" is null;'
    )
    this.addSql(
      'create unique index if not exists "catalog_bundle_inventory_links_profile_variant_item_key" on "catalog_bundle_inventory_links" ("bundle_profile_id", "bundle_variant_id", "inventory_item_id") where "deleted_at" is null;'
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop table if exists "catalog_bundle_inventory_links" cascade;'
    )
    this.addSql('drop table if exists "catalog_authoring_operations" cascade;')
  }
}
