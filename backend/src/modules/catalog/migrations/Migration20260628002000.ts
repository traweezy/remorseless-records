import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260628002000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create table if not exists "catalog_artists" (' +
        '"id" text not null,' +
        '"name" text not null,' +
        '"slug" text not null,' +
        '"sort_name" text null,' +
        '"image_url" text null,' +
        '"bio" text null,' +
        '"location" text null,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_artists_pkey" primary key ("id")' +
        ");"
    )

    this.addSql(
      'create unique index if not exists "catalog_artists_slug_key" on "catalog_artists" ("slug") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_artists_name" on "catalog_artists" ("name") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_artists_deleted_at" on "catalog_artists" ("deleted_at");'
    )

    this.addSql(
      'create table if not exists "catalog_reference_values" (' +
        '"id" text not null,' +
        '"kind" text not null check ("kind" in (\'format\', \'format_detail\', \'genre\', \'label\', \'merch_type\', \'product_type\', \'utility_tag\')),' +
        '"label" text not null,' +
        '"value" text not null,' +
        '"description" text null,' +
        '"rank" integer not null default 0,' +
        '"is_active" boolean not null default true,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_reference_values_pkey" primary key ("id")' +
        ");"
    )

    this.addSql(
      'create unique index if not exists "catalog_reference_values_kind_value_key" on "catalog_reference_values" ("kind", "value") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_reference_values_kind_rank" on "catalog_reference_values" ("kind", "rank", "label") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_reference_values_active" on "catalog_reference_values" ("is_active") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_reference_values_deleted_at" on "catalog_reference_values" ("deleted_at");'
    )

    this.addSql(
      'create table if not exists "catalog_product_profiles" (' +
        '"id" text not null,' +
        '"product_id" text not null,' +
        '"release_title" text null,' +
        '"label_id" text null,' +
        '"product_type_id" text null,' +
        '"release_date" timestamptz null,' +
        '"release_year" integer null check ("release_year" is null or ("release_year" >= 1900 and "release_year" <= 2200)),' +
        '"description_html" text null,' +
        '"search_keywords" text[] not null default \'{}\',' +
        '"tracklist" jsonb not null default \'[]\',' +
        '"credits" jsonb not null default \'{}\',' +
        '"pressing_notes" jsonb not null default \'{}\',' +
        '"merch_details" jsonb not null default \'{}\',' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_product_profiles_pkey" primary key ("id"),' +
        'constraint "catalog_product_profiles_label_id_fkey" foreign key ("label_id") references "catalog_reference_values" ("id") on delete set null,' +
        'constraint "catalog_product_profiles_product_type_id_fkey" foreign key ("product_type_id") references "catalog_reference_values" ("id") on delete set null' +
        ");"
    )

    this.addSql(
      'create unique index if not exists "catalog_product_profiles_product_id_key" on "catalog_product_profiles" ("product_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_profiles_label_id" on "catalog_product_profiles" ("label_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_profiles_product_type_id" on "catalog_product_profiles" ("product_type_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_profiles_release_date" on "catalog_product_profiles" ("release_date") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_profiles_release_year" on "catalog_product_profiles" ("release_year") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_profiles_deleted_at" on "catalog_product_profiles" ("deleted_at");'
    )

    this.addSql(
      'create table if not exists "catalog_product_artists" (' +
        '"id" text not null,' +
        '"product_profile_id" text not null,' +
        '"artist_id" text null,' +
        '"display_name" text not null,' +
        '"role" text not null default \'primary\',' +
        '"sort_order" integer not null default 0,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_product_artists_pkey" primary key ("id"),' +
        'constraint "catalog_product_artists_product_profile_id_fkey" foreign key ("product_profile_id") references "catalog_product_profiles" ("id") on delete cascade,' +
        'constraint "catalog_product_artists_artist_id_fkey" foreign key ("artist_id") references "catalog_artists" ("id") on delete set null' +
        ");"
    )

    this.addSql(
      'create index if not exists "idx_catalog_product_artists_profile_order" on "catalog_product_artists" ("product_profile_id", "sort_order") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_artists_artist_id" on "catalog_product_artists" ("artist_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_artists_deleted_at" on "catalog_product_artists" ("deleted_at");'
    )

    this.addSql(
      'create table if not exists "catalog_product_references" (' +
        '"id" text not null,' +
        '"product_profile_id" text not null,' +
        '"reference_value_id" text not null,' +
        '"kind" text not null check ("kind" in (\'format\', \'format_detail\', \'genre\', \'label\', \'merch_type\', \'product_type\', \'utility_tag\')),' +
        '"sort_order" integer not null default 0,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_product_references_pkey" primary key ("id"),' +
        'constraint "catalog_product_references_product_profile_id_fkey" foreign key ("product_profile_id") references "catalog_product_profiles" ("id") on delete cascade,' +
        'constraint "catalog_product_references_reference_value_id_fkey" foreign key ("reference_value_id") references "catalog_reference_values" ("id") on delete cascade' +
        ");"
    )

    this.addSql(
      'create unique index if not exists "catalog_product_references_profile_ref_key" on "catalog_product_references" ("product_profile_id", "reference_value_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_references_kind_order" on "catalog_product_references" ("kind", "sort_order") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_product_references_deleted_at" on "catalog_product_references" ("deleted_at");'
    )

    this.addSql(
      'create table if not exists "catalog_variant_profiles" (' +
        '"id" text not null,' +
        '"variant_id" text not null,' +
        '"product_profile_id" text null,' +
        '"format_id" text null,' +
        '"format_detail_id" text null,' +
        '"format_label" text null,' +
        '"format_detail_label" text null,' +
        '"display_label" text null,' +
        '"availability_status" text not null default \'available\' check ("availability_status" in (\'available\', \'preorder\', \'backorder\', \'coming_soon\', \'sold_out\')),' +
        '"preorder_release_date" timestamptz null,' +
        '"backorder_allowed" boolean not null default false,' +
        '"backorder_note" text null,' +
        '"image_url" text null,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_variant_profiles_pkey" primary key ("id"),' +
        'constraint "catalog_variant_profiles_product_profile_id_fkey" foreign key ("product_profile_id") references "catalog_product_profiles" ("id") on delete set null,' +
        'constraint "catalog_variant_profiles_format_id_fkey" foreign key ("format_id") references "catalog_reference_values" ("id") on delete set null,' +
        'constraint "catalog_variant_profiles_format_detail_id_fkey" foreign key ("format_detail_id") references "catalog_reference_values" ("id") on delete set null' +
        ");"
    )

    this.addSql(
      'create unique index if not exists "catalog_variant_profiles_variant_id_key" on "catalog_variant_profiles" ("variant_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_variant_profiles_product_profile_id" on "catalog_variant_profiles" ("product_profile_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_variant_profiles_format_id" on "catalog_variant_profiles" ("format_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_variant_profiles_availability" on "catalog_variant_profiles" ("availability_status") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_variant_profiles_deleted_at" on "catalog_variant_profiles" ("deleted_at");'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "catalog_variant_profiles";')
    this.addSql('drop table if exists "catalog_product_references";')
    this.addSql('drop table if exists "catalog_product_artists";')
    this.addSql('drop table if exists "catalog_product_profiles";')
    this.addSql('drop table if exists "catalog_reference_values";')
    this.addSql('drop table if exists "catalog_artists";')
  }
}
