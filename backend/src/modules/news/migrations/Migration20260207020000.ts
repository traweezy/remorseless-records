import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260207020000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create table if not exists "news_entries" (' +
        '"id" text not null,' +
        '"title" text not null,' +
        '"slug" text not null,' +
        '"excerpt" text null,' +
        '"content" text not null,' +
        '"author" text null,' +
        '"status" text not null default \'draft\' check ("status" in (\'draft\', \'published\', \'scheduled\', \'archived\')),' +
        '"published_at" timestamptz null,' +
        '"tags" text[] not null default \'{}\',' +
        '"cover_url" text null,' +
        '"seo_title" text null,' +
        '"seo_description" text null,' +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "news_entries_pkey" primary key ("id")' +
        ");"
    )

    this.addSql(
      'create unique index if not exists "news_entries_slug_key" on "news_entries" ("slug") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_news_entries_status" on "news_entries" ("status") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_news_entries_published_at" on "news_entries" ("published_at") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_news_entries_created_at" on "news_entries" ("created_at") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_news_entries_deleted_at" on "news_entries" ("deleted_at");'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "news_entries";')
  }
}
