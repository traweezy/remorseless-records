import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726183100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "discography_entries" add column "product_id" text null;'
    )
    this.addSql(
      'alter table "discography_entries" add column "source_mode" text not null default \'manual\';'
    )
    this.addSql(
      'alter table "discography_entries" add column "cover_alt_text" text null;'
    )
    this.addSql(
      'alter table "discography_entries" add column "version" integer not null default 1;'
    )
    this.addSql(
      'alter table "discography_entries" add constraint "discography_entries_source_mode_check" check ("source_mode" in (\'catalog_product\', \'manual\'));'
    )
    this.addSql(
      'alter table "discography_entries" add constraint "discography_entries_catalog_product_check" check ("source_mode" <> \'catalog_product\' or "product_id" is not null);'
    )
    this.addSql(
      'alter table "discography_entries" add constraint "discography_entries_version_check" check ("version" >= 1);'
    )
    this.addSql(
      'create unique index "discography_entries_product_id_key" on "discography_entries" ("product_id") where "deleted_at" is null and "product_id" is not null;'
    )
    this.addSql(
      'create index "idx_discography_entries_source_mode" on "discography_entries" ("source_mode") where "deleted_at" is null;'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "idx_discography_entries_source_mode";')
    this.addSql('drop index if exists "discography_entries_product_id_key";')
    this.addSql(
      'alter table "discography_entries" drop constraint if exists "discography_entries_version_check";'
    )
    this.addSql(
      'alter table "discography_entries" drop constraint if exists "discography_entries_catalog_product_check";'
    )
    this.addSql(
      'alter table "discography_entries" drop constraint if exists "discography_entries_source_mode_check";'
    )
    this.addSql(
      'alter table "discography_entries" drop column if exists "version";'
    )
    this.addSql(
      'alter table "discography_entries" drop column if exists "cover_alt_text";'
    )
    this.addSql(
      'alter table "discography_entries" drop column if exists "source_mode";'
    )
    this.addSql(
      'alter table "discography_entries" drop column if exists "product_id";'
    )
  }
}
