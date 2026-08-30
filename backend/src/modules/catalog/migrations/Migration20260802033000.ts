import { Migration } from "@mikro-orm/migrations"

export class Migration20260802033000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table if exists "catalog_shelves" add column if not exists "archived_at" timestamptz null;'
    )
    this.addSql(
      'create index if not exists "idx_catalog_shelves_archived_at" on "catalog_shelves" ("archived_at");'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "idx_catalog_shelves_archived_at";')
    this.addSql(
      'alter table if exists "catalog_shelves" drop column if exists "archived_at";'
    )
  }
}
