import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260628210000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create table if not exists "catalog_media_assets" (' +
        '"id" text not null,' +
        '"source_url" text not null,' +
        '"source_file_key" text null,' +
        '"original_filename" text null,' +
        '"mime_type" text null,' +
        '"byte_size" integer null check ("byte_size" is null or "byte_size" >= 0),' +
        '"width" integer null check ("width" is null or "width" > 0),' +
        '"height" integer null check ("height" is null or "height" > 0),' +
        '"alt_text" text null,' +
        '"caption" text null,' +
        '"focal_x" numeric null check ("focal_x" is null or ("focal_x" >= 0 and "focal_x" <= 1)),' +
        '"focal_y" numeric null check ("focal_y" is null or ("focal_y" >= 0 and "focal_y" <= 1)),' +
        '"crop_intent" text null,' +
        '"derivative_status" text not null default \'source_only\' check ("derivative_status" in (\'source_only\', \'pending\', \'processing\', \'ready\', \'failed\')),' +
        '"derivatives" jsonb not null default \'{}\',' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_media_assets_pkey" primary key ("id")' +
        ");"
    )
    this.addSql(
      'create index if not exists "idx_catalog_media_assets_source_file_key" on "catalog_media_assets" ("source_file_key") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_media_assets_source_url" on "catalog_media_assets" ("source_url") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_media_assets_deleted_at" on "catalog_media_assets" ("deleted_at");'
    )

    this.addSql(
      'create table if not exists "catalog_product_media" (' +
        '"id" text not null,' +
        '"product_id" text not null,' +
        '"variant_id" text null,' +
        '"product_profile_id" text null,' +
        '"media_asset_id" text not null,' +
        '"role" text not null default \'gallery\' check ("role" in (\'gallery\', \'primary\', \'variant\', \'artist_photo\', \'news_cover\', \'open_graph\')),' +
        '"sort_order" integer not null default 0 check ("sort_order" >= 0),' +
        '"is_primary" boolean not null default false,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_product_media_pkey" primary key ("id"),' +
        'constraint "catalog_product_media_asset_id_fkey" foreign key ("media_asset_id") references "catalog_media_assets" ("id") on delete restrict,' +
        'constraint "catalog_product_media_product_profile_id_fkey" foreign key ("product_profile_id") references "catalog_product_profiles" ("id") on delete set null' +
        ");"
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_media_product_order" on "catalog_product_media" ("product_id", "sort_order") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_media_variant_id" on "catalog_product_media" ("variant_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_media_asset_id" on "catalog_product_media" ("media_asset_id") where deleted_at is null;'
    )
    this.addSql(
      'create unique index if not exists "catalog_product_media_primary_product_key" on "catalog_product_media" ("product_id") where deleted_at is null and is_primary = true and variant_id is null;'
    )
    this.addSql(
      'create unique index if not exists "catalog_product_media_primary_variant_key" on "catalog_product_media" ("variant_id") where deleted_at is null and is_primary = true and variant_id is not null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_media_deleted_at" on "catalog_product_media" ("deleted_at");'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "catalog_product_media";')
    this.addSql('drop table if exists "catalog_media_assets";')
  }
}
