import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260207030000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      "update \"news_entries\" set \"status\" = 'draft' where \"status\" = 'scheduled';"
    )
    this.addSql(
      'alter table "news_entries" drop constraint if exists "news_entries_status_check";'
    )
    this.addSql(
      'alter table "news_entries" add constraint "news_entries_status_check" check ("status" in (\'draft\', \'published\', \'archived\'));'
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "news_entries" drop constraint if exists "news_entries_status_check";'
    )
    this.addSql(
      'alter table "news_entries" add constraint "news_entries_status_check" check ("status" in (\'draft\', \'published\', \'scheduled\', \'archived\'));'
    )
  }
}
