import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260725210000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create table if not exists "tax_provider_controls" (' +
        '"id" text not null,' +
        "\"active_provider\" text not null default 'taxrate_io' check (\"active_provider\" in ('taxrate_io', 'stripe_tax'))," +
        '"generation" integer not null default 1 check ("generation" > 0),' +
        '"last_switched_by" text null,' +
        '"last_switch_reason" text null,' +
        "\"metadata\" jsonb not null default '{}'," +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "tax_provider_controls_pkey" primary key ("id")' +
        ");",
    );
    this.addSql(
      'create index if not exists "idx_tax_provider_controls_deleted_at" on "tax_provider_controls" ("deleted_at");',
    );

    this.addSql(
      'create table if not exists "tax_provider_audits" (' +
        '"id" text not null,' +
        '"idempotency_key" text not null,' +
        '"actor_id" text not null,' +
        "\"from_provider\" text not null check (\"from_provider\" in ('taxrate_io', 'stripe_tax'))," +
        "\"to_provider\" text not null check (\"to_provider\" in ('taxrate_io', 'stripe_tax'))," +
        '"from_generation" integer not null check ("from_generation" > 0),' +
        '"to_generation" integer not null check ("to_generation" > "from_generation"),' +
        '"reason" text not null,' +
        "\"metadata\" jsonb not null default '{}'," +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "tax_provider_audits_pkey" primary key ("id")' +
        ");",
    );
    this.addSql(
      'create unique index if not exists "tax_provider_audits_idempotency_key_key" on "tax_provider_audits" ("idempotency_key") where deleted_at is null;',
    );
    this.addSql(
      'create index if not exists "idx_tax_provider_audits_created_at" on "tax_provider_audits" ("created_at" desc) where deleted_at is null;',
    );
    this.addSql(
      'create index if not exists "idx_tax_provider_audits_deleted_at" on "tax_provider_audits" ("deleted_at");',
    );

    this.addSql(
      'create table if not exists "tax_provider_quotas" (' +
        '"id" text not null,' +
        '"provider" text not null,' +
        '"usage" integer not null check ("usage" >= 0),' +
        '"quota" integer not null check ("quota" >= 0),' +
        '"remaining" integer not null check ("remaining" >= 0),' +
        '"usage_percent" numeric not null check ("usage_percent" >= 0),' +
        '"observed_at" timestamptz not null,' +
        '"source" text not null,' +
        "\"metadata\" jsonb not null default '{}'," +
        '"created_at" timestamptz not null default now(),' +
        '"updated_at" timestamptz not null default now(),' +
        '"deleted_at" timestamptz null,' +
        'constraint "tax_provider_quotas_pkey" primary key ("id")' +
        ");",
    );
    this.addSql(
      'create unique index if not exists "tax_provider_quotas_provider_key" on "tax_provider_quotas" ("provider") where deleted_at is null;',
    );
    this.addSql(
      'create index if not exists "idx_tax_provider_quotas_deleted_at" on "tax_provider_quotas" ("deleted_at");',
    );

    this.addSql(
      'insert into "tax_provider_controls" ("id", "active_provider", "generation") ' +
        "values ('taxctrl_default', 'taxrate_io', 1) " +
        'on conflict ("id") do nothing;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "tax_provider_quotas";');
    this.addSql('drop table if exists "tax_provider_audits";');
    this.addSql('drop table if exists "tax_provider_controls";');
  }
}
