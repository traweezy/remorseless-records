import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260830150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      "alter table \"tax_provider_controls\" add column if not exists \"collection_mode\" text not null default 'collect' check (\"collection_mode\" in ('collect', 'disabled'));"
    )

    this.addSql(
      'alter table "tax_provider_audits" add column if not exists "acknowledgement_version" text not null default \'tax-collection-control-2026-08-30\';'
    )
    this.addSql(
      "alter table \"tax_provider_audits\" add column if not exists \"from_collection_mode\" text not null default 'collect' check (\"from_collection_mode\" in ('collect', 'disabled'));"
    )
    this.addSql(
      "alter table \"tax_provider_audits\" add column if not exists \"to_collection_mode\" text not null default 'collect' check (\"to_collection_mode\" in ('collect', 'disabled'));"
    )

    this.addSql(
      "alter table \"tax_quote_evidences\" add column if not exists \"collection_mode\" text not null default 'collect' check (\"collection_mode\" in ('collect', 'disabled'));"
    )
    this.addSql(
      'alter table "tax_quote_evidences" alter column "provider" drop not null;'
    )
    this.addSql(
      'alter table "tax_quote_evidences" add constraint "tax_quote_evidences_collection_identity_check" check (("collection_mode" = \'collect\' and "provider" is not null) or ("collection_mode" = \'disabled\' and "provider" is null and "calculation_id" is null and "tax_transaction_id" is null));'
    )
    this.addSql(
      'create index if not exists "idx_tax_quote_evidences_collection_mode" on "tax_quote_evidences" ("collection_mode", "last_verified_at") where deleted_at is null;'
    )
  }

  override async down(): Promise<void> {
    // Application rollback keeps expanded tax-decision history intact. Removing
    // these columns could destroy disabled-mode evidence or make it ambiguous.
    this.addSql("select 1;")
  }
}
