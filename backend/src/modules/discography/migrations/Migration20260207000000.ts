import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260207000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create table if not exists "discography_entries" (' +
        '"id" text not null,' +
        '"title" text not null,' +
        '"artist" text not null,' +
        '"album" text not null,' +
        '"product_handle" text null,' +
        '"collection_title" text null,' +
        '"catalog_number" text null,' +
        '"release_date" timestamptz null,' +
        '"release_year" integer null,' +
        '"formats" text[] not null default \'{}\',' +
        '"genres" text[] not null default \'{}\',' +
        '"availability" text not null default \'unknown\' check ("availability" in (\'in_print\', \'out_of_print\', \'preorder\', \'digital_only\', \'unknown\')),' +
        '"cover_url" text null,' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "discography_entries_pkey" primary key ("id")' +
        ");"
    )

    this.addSql(
      'create index if not exists "IDX_discography_entries_product_handle" on "discography_entries" ("product_handle") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "IDX_discography_entries_release_year" on "discography_entries" ("release_year") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "IDX_discography_entries_release_date" on "discography_entries" ("release_date") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "IDX_discography_entries_deleted_at" on "discography_entries" ("deleted_at");'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "discography_entries";')
  }
}
