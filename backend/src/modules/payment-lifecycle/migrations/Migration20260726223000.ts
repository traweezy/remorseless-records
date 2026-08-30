import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260726223000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create table if not exists "stripe_lifecycle_events" (' +
        '"id" text not null,' +
        '"provider_event_id" text not null,' +
        '"event_type" text not null,' +
        '"object_id" text not null,' +
        '"payment_intent_id" text null,' +
        '"charge_id" text null,' +
        '"order_id" text null,' +
        '"livemode" boolean not null,' +
        '"event_created_at" timestamptz not null,' +
        "\"status\" text not null default 'received' check (\"status\" in ('received', 'processing', 'processed', 'ignored', 'failed'))," +
        '"attempt_count" integer not null default 0 check ("attempt_count" >= 0),' +
        '"received_at" timestamptz not null,' +
        '"processing_started_at" timestamptz null,' +
        '"processed_at" timestamptz null,' +
        '"next_retry_at" timestamptz null,' +
        '"last_error_code" text null,' +
        '"amount_minor" integer null check ("amount_minor" is null or "amount_minor" >= 0),' +
        '"currency_code" text null check ("currency_code" is null or "currency_code" = lower("currency_code")),' +
        '"provider_object_status" text null,' +
        "\"metadata\" jsonb not null default '{}'," +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "stripe_lifecycle_events_pkey" primary key ("id")' +
        ");"
    )
    this.addSql(
      'create unique index if not exists "stripe_lifecycle_events_provider_event_id_key" on "stripe_lifecycle_events" ("provider_event_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_stripe_lifecycle_events_event_type" on "stripe_lifecycle_events" ("event_type") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_stripe_lifecycle_events_object_id" on "stripe_lifecycle_events" ("object_id") where deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_stripe_lifecycle_events_payment_intent_id" on "stripe_lifecycle_events" ("payment_intent_id") where payment_intent_id is not null and deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_stripe_lifecycle_events_charge_id" on "stripe_lifecycle_events" ("charge_id") where charge_id is not null and deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_stripe_lifecycle_events_order_id" on "stripe_lifecycle_events" ("order_id") where order_id is not null and deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_stripe_lifecycle_events_retry" on "stripe_lifecycle_events" ("status", "next_retry_at", "received_at") where status in (\'received\', \'processing\', \'failed\') and deleted_at is null;'
    )
    this.addSql(
      'create index if not exists "idx_stripe_lifecycle_events_deleted_at" on "stripe_lifecycle_events" ("deleted_at");'
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "stripe_lifecycle_events";')
  }
}
