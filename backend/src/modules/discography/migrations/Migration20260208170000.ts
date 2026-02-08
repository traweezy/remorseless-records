import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260208170000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "discography_entries" add column if not exists "tags" text[] not null default \'{}\';'
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "discography_entries" drop column if exists "tags";'
    )
  }
}
