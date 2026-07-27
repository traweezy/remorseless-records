import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726235500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "catalog_media_assets" add column if not exists "lifecycle_status" text not null default \'active\';',
    )
    this.addSql(
      'alter table "catalog_media_assets" add column if not exists "quarantined_at" timestamptz null;',
    )
    this.addSql(
      'alter table "catalog_media_assets" add column if not exists "quarantined_by" text null;',
    )
    this.addSql(
      'alter table "catalog_media_assets" add column if not exists "purge_eligible_at" timestamptz null;',
    )
    this.addSql(
      'alter table "catalog_media_assets" add constraint "catalog_media_assets_lifecycle_status_check" check ("lifecycle_status" in (\'active\', \'quarantined\'));',
    )
    this.addSql(
      'alter table "catalog_media_assets" add constraint "catalog_media_assets_quarantine_state_check" check (("lifecycle_status" = \'active\' and "quarantined_at" is null and "quarantined_by" is null and "purge_eligible_at" is null) or ("lifecycle_status" = \'quarantined\' and "quarantined_at" is not null and "quarantined_by" is not null and "purge_eligible_at" > "quarantined_at"));',
    )
    this.addSql(
      'create index if not exists "idx_catalog_media_assets_lifecycle_created_id" on "catalog_media_assets" ("lifecycle_status", "created_at" desc, "id" desc) where "deleted_at" is null;',
    )
    this.addSql(
      'create index if not exists "idx_catalog_media_assets_purge_eligible_at" on "catalog_media_assets" ("purge_eligible_at") where "deleted_at" is null and "lifecycle_status" = \'quarantined\';',
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop index if exists "idx_catalog_media_assets_purge_eligible_at";',
    )
    this.addSql(
      'drop index if exists "idx_catalog_media_assets_lifecycle_created_id";',
    )
    this.addSql(
      'alter table "catalog_media_assets" drop constraint if exists "catalog_media_assets_quarantine_state_check";',
    )
    this.addSql(
      'alter table "catalog_media_assets" drop constraint if exists "catalog_media_assets_lifecycle_status_check";',
    )
    this.addSql(
      'alter table "catalog_media_assets" drop column if exists "purge_eligible_at";',
    )
    this.addSql(
      'alter table "catalog_media_assets" drop column if exists "quarantined_by";',
    )
    this.addSql(
      'alter table "catalog_media_assets" drop column if exists "quarantined_at";',
    )
    this.addSql(
      'alter table "catalog_media_assets" drop column if exists "lifecycle_status";',
    )
  }
}
