import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260628035000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "catalog_variant_profiles" drop constraint if exists "catalog_variant_profiles_availability_status_check";'
    )
    this.addSql(
      'alter table "catalog_variant_profiles" add constraint "catalog_variant_profiles_availability_status_check" check ("availability_status" in (\'available\', \'in_stock\', \'low_stock\', \'preorder\', \'backorder\', \'coming_soon\', \'sold_out\', \'unknown\'));'
    )

    this.addSql(
      'create table if not exists "catalog_bundle_profiles" (' +
        '"id" text not null,' +
        '"product_id" text not null,' +
        '"product_profile_id" text null,' +
        '"bundle_type" text not null default \'fixed\' check ("bundle_type" in (\'fixed\', \'mystery\', \'deal\', \'selectable\')),' +
        '"inventory_mode" text not null default \'component_derived\' check ("inventory_mode" in (\'component_derived\', \'manual\')),' +
        '"fulfillment_mode" text not null default \'ship_components\' check ("fulfillment_mode" in (\'ship_components\', \'manual\')),' +
        '"display_title" text null,' +
        '"description_html" text null,' +
        '"is_active" boolean not null default true,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_bundle_profiles_pkey" primary key ("id"),' +
        'constraint "catalog_bundle_profiles_product_profile_id_fkey" foreign key ("product_profile_id") references "catalog_product_profiles" ("id") on delete set null' +
        ");"
    )
    this.addSql(
      'create unique index if not exists "catalog_bundle_profiles_product_id_key" on "catalog_bundle_profiles" ("product_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_profiles_product_profile_id" on "catalog_bundle_profiles" ("product_profile_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_profiles_type_active" on "catalog_bundle_profiles" ("bundle_type", "is_active") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_profiles_deleted_at" on "catalog_bundle_profiles" ("deleted_at");'
    )

    this.addSql(
      'create table if not exists "catalog_bundle_components" (' +
        '"id" text not null,' +
        '"bundle_profile_id" text not null,' +
        '"component_product_id" text not null,' +
        '"component_variant_id" text null,' +
        '"component_inventory_item_id" text null,' +
        '"title" text null,' +
        '"variant_title" text null,' +
        '"sku" text null,' +
        '"quantity" integer not null default 1 check ("quantity" > 0),' +
        '"sort_order" integer not null default 0,' +
        '"is_required" boolean not null default true,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_bundle_components_pkey" primary key ("id"),' +
        'constraint "catalog_bundle_components_bundle_profile_id_fkey" foreign key ("bundle_profile_id") references "catalog_bundle_profiles" ("id") on delete cascade' +
        ");"
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_components_bundle_order" on "catalog_bundle_components" ("bundle_profile_id", "sort_order") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_components_product_id" on "catalog_bundle_components" ("component_product_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_components_variant_id" on "catalog_bundle_components" ("component_variant_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_components_inventory_item_id" on "catalog_bundle_components" ("component_inventory_item_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_bundle_components_deleted_at" on "catalog_bundle_components" ("deleted_at");'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "catalog_bundle_components";')
    this.addSql('drop table if exists "catalog_bundle_profiles";')
    this.addSql(
      'alter table "catalog_variant_profiles" drop constraint if exists "catalog_variant_profiles_availability_status_check";'
    )
    this.addSql(
      'alter table "catalog_variant_profiles" add constraint "catalog_variant_profiles_availability_status_check" check ("availability_status" in (\'available\', \'preorder\', \'backorder\', \'coming_soon\', \'sold_out\'));'
    )
  }
}
