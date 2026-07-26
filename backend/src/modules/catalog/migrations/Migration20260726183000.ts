import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726183000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "catalog_product_profiles" add column "release_date_precision" text not null default \'unknown\';'
    )
    this.addSql(
      'alter table "catalog_product_profiles" add column "content_schema_version" integer not null default 1;'
    )
    this.addSql(
      'alter table "catalog_product_profiles" add column "version" integer not null default 1;'
    )
    this.addSql(
      'alter table "catalog_product_profiles" add constraint "catalog_product_profiles_release_date_precision_check" check ("release_date_precision" in (\'unknown\', \'year\', \'month\', \'day\'));'
    )
    this.addSql(
      'alter table "catalog_product_profiles" add constraint "catalog_product_profiles_content_schema_version_check" check ("content_schema_version" >= 1);'
    )
    this.addSql(
      'alter table "catalog_product_profiles" add constraint "catalog_product_profiles_version_check" check ("version" >= 1);'
    )

    this.addSql(
      'alter table "catalog_variant_profiles" add column "version" integer not null default 1;'
    )
    this.addSql(
      'alter table "catalog_variant_profiles" add constraint "catalog_variant_profiles_version_check" check ("version" >= 1);'
    )

    this.addSql(
      'alter table "catalog_bundle_profiles" add column "version" integer not null default 1;'
    )
    this.addSql(
      'alter table "catalog_bundle_profiles" add constraint "catalog_bundle_profiles_version_check" check ("version" >= 1);'
    )

    this.addSql(
      'alter table "catalog_media_assets" add column "content_sha256" text null;'
    )
    this.addSql(
      'alter table "catalog_media_assets" add column "version" integer not null default 1;'
    )
    this.addSql(
      'alter table "catalog_media_assets" add constraint "catalog_media_assets_content_sha256_check" check ("content_sha256" is null or "content_sha256" ~ \'^[0-9a-f]{64}$\');'
    )
    this.addSql(
      'alter table "catalog_media_assets" add constraint "catalog_media_assets_version_check" check ("version" >= 1);'
    )
    this.addSql(
      'create index "idx_catalog_media_assets_content_sha256" on "catalog_media_assets" ("content_sha256") where "deleted_at" is null and "content_sha256" is not null;'
    )

    this.addSql(
      'alter table "catalog_shelves" add column "version" integer not null default 1;'
    )
    this.addSql(
      'alter table "catalog_shelves" add constraint "catalog_shelves_version_check" check ("version" >= 1);'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "idx_catalog_media_assets_content_sha256";')
    this.addSql(
      'alter table "catalog_media_assets" drop constraint if exists "catalog_media_assets_version_check";'
    )
    this.addSql(
      'alter table "catalog_media_assets" drop constraint if exists "catalog_media_assets_content_sha256_check";'
    )
    this.addSql(
      'alter table "catalog_media_assets" drop column if exists "version";'
    )
    this.addSql(
      'alter table "catalog_media_assets" drop column if exists "content_sha256";'
    )

    this.addSql(
      'alter table "catalog_shelves" drop constraint if exists "catalog_shelves_version_check";'
    )
    this.addSql(
      'alter table "catalog_shelves" drop column if exists "version";'
    )

    this.addSql(
      'alter table "catalog_bundle_profiles" drop constraint if exists "catalog_bundle_profiles_version_check";'
    )
    this.addSql(
      'alter table "catalog_bundle_profiles" drop column if exists "version";'
    )

    this.addSql(
      'alter table "catalog_variant_profiles" drop constraint if exists "catalog_variant_profiles_version_check";'
    )
    this.addSql(
      'alter table "catalog_variant_profiles" drop column if exists "version";'
    )

    this.addSql(
      'alter table "catalog_product_profiles" drop constraint if exists "catalog_product_profiles_version_check";'
    )
    this.addSql(
      'alter table "catalog_product_profiles" drop constraint if exists "catalog_product_profiles_content_schema_version_check";'
    )
    this.addSql(
      'alter table "catalog_product_profiles" drop constraint if exists "catalog_product_profiles_release_date_precision_check";'
    )
    this.addSql(
      'alter table "catalog_product_profiles" drop column if exists "version";'
    )
    this.addSql(
      'alter table "catalog_product_profiles" drop column if exists "content_schema_version";'
    )
    this.addSql(
      'alter table "catalog_product_profiles" drop column if exists "release_date_precision";'
    )
  }
}
