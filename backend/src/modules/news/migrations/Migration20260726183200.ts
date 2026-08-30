import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726183200 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "news_entries" add column "version" integer not null default 1;'
    )
    this.addSql(
      'alter table "news_entries" add constraint "news_entries_version_check" check ("version" >= 1);'
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "news_entries" drop constraint if exists "news_entries_version_check";'
    )
    this.addSql('alter table "news_entries" drop column if exists "version";')
  }
}
