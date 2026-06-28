import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260628193000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "catalog_variant_profiles" add column if not exists "preorder_allowed" boolean not null default false;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_variant_profiles_preorder_allowed" on "catalog_variant_profiles" ("preorder_allowed") where deleted_at is null;'
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop index if exists "idx_catalog_variant_profiles_preorder_allowed";'
    )
    this.addSql(
      'alter table "catalog_variant_profiles" drop column if exists "preorder_allowed";'
    )
  }
}
