import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260725220000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create table if not exists "tax_quote_evidences" (' +
        '"id" text not null,' +
        '"cart_id" text not null,' +
        '"order_id" text null,' +
        "\"provider\" text not null check (\"provider\" in ('taxrate_io', 'stripe_tax'))," +
        '"generation" integer not null check ("generation" > 0),' +
        '"fingerprint" text not null,' +
        '"calculation_id" text null,' +
        '"payment_intent_id" text not null,' +
        '"amount_minor" integer not null check ("amount_minor" >= 0),' +
        '"currency_code" text not null check ("currency_code" = lower("currency_code")),' +
        "\"status\" text not null default 'prepared' check (\"status\" in ('prepared', 'succeeded', 'canceled', 'failed', 'association_failed', 'disputed', 'partially_refunded', 'refunded'))," +
        '"linked_at" timestamptz not null,' +
        '"last_verified_at" timestamptz not null,' +
        '"tax_transaction_id" text null,' +
        '"association_status" text null,' +
        "\"metadata\" jsonb not null default '{}'," +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "tax_quote_evidences_pkey" primary key ("id")' +
        ");",
    );
    this.addSql(
      'create unique index if not exists "tax_quote_evidences_payment_intent_id_key" on "tax_quote_evidences" ("payment_intent_id") where deleted_at is null;',
    );
    this.addSql(
      'create unique index if not exists "tax_quote_evidences_calculation_id_key" on "tax_quote_evidences" ("calculation_id") where calculation_id is not null and deleted_at is null;',
    );
    this.addSql(
      'create index if not exists "idx_tax_quote_evidences_cart_id" on "tax_quote_evidences" ("cart_id") where deleted_at is null;',
    );
    this.addSql(
      'create index if not exists "idx_tax_quote_evidences_order_id" on "tax_quote_evidences" ("order_id") where order_id is not null and deleted_at is null;',
    );
    this.addSql(
      'create index if not exists "idx_tax_quote_evidences_fingerprint" on "tax_quote_evidences" ("fingerprint") where deleted_at is null;',
    );
    this.addSql(
      'create index if not exists "idx_tax_quote_evidences_status" on "tax_quote_evidences" ("status", "last_verified_at") where deleted_at is null;',
    );
    this.addSql(
      'create index if not exists "idx_tax_quote_evidences_deleted_at" on "tax_quote_evidences" ("deleted_at");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "tax_quote_evidences";');
  }
}
