import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260628043000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create table if not exists "catalog_shelves" (' +
        '"id" text not null,' +
        '"handle" text not null,' +
        '"title" text not null,' +
        '"description" text null,' +
        '"mode" text not null default \'manual\' check ("mode" in (\'manual\', \'automatic\', \'hybrid\')),' +
        '"automation_type" text not null default \'none\' check ("automation_type" in (\'none\', \'new_release\')),' +
        '"show_ribbon" boolean not null default false,' +
        '"ribbon_label" text null,' +
        '"ribbon_priority" integer not null default 100 check ("ribbon_priority" >= 0),' +
        '"product_limit" integer null check ("product_limit" is null or "product_limit" > 0),' +
        '"starts_at" timestamptz null,' +
        '"ends_at" timestamptz null,' +
        '"is_active" boolean not null default true,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_shelves_pkey" primary key ("id")' +
        ");"
    )
    this.addSql(
      'create unique index if not exists "catalog_shelves_handle_key" on "catalog_shelves" ("handle") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_shelves_active_mode" on "catalog_shelves" ("is_active", "mode") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_shelves_ribbon_priority" on "catalog_shelves" ("show_ribbon", "ribbon_priority") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_shelves_deleted_at" on "catalog_shelves" ("deleted_at");'
    )

    this.addSql(
      'create table if not exists "catalog_shelf_products" (' +
        '"id" text not null,' +
        '"shelf_id" text not null,' +
        '"product_id" text not null,' +
        '"product_profile_id" text null,' +
        '"sort_order" integer not null default 0,' +
        '"is_pinned" boolean not null default false,' +
        '"starts_at" timestamptz null,' +
        '"ends_at" timestamptz null,' +
        '"metadata" jsonb not null default \'{}\',' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "catalog_shelf_products_pkey" primary key ("id"),' +
        'constraint "catalog_shelf_products_shelf_id_fkey" foreign key ("shelf_id") references "catalog_shelves" ("id") on delete cascade,' +
        'constraint "catalog_shelf_products_product_profile_id_fkey" foreign key ("product_profile_id") references "catalog_product_profiles" ("id") on delete set null' +
        ");"
    )
    this.addSql(
      'create unique index if not exists "catalog_shelf_products_shelf_product_key" on "catalog_shelf_products" ("shelf_id", "product_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_shelf_products_shelf_order" on "catalog_shelf_products" ("shelf_id", "sort_order") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_shelf_products_product_id" on "catalog_shelf_products" ("product_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_shelf_products_deleted_at" on "catalog_shelf_products" ("deleted_at");'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "catalog_shelf_products";')
    this.addSql('drop table if exists "catalog_shelves";')
  }
}
