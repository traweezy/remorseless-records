import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260901100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "tax_provider_controls" alter column "collection_mode" set default \'disabled\';'
    )
    this.addSql(`
      with initial_control as (
        select
          "id",
          "active_provider",
          "collection_mode",
          "generation"
        from "tax_provider_controls"
        where "id" = 'taxctrl_default'
          and "collection_mode" = 'collect'
          and "generation" = 1
          and "last_switched_by" is null
          and "last_switch_reason" is null
          and "deleted_at" is null
          and not exists (
            select 1
            from "tax_provider_audits"
            where "deleted_at" is null
          )
        for update
      ), recorded_transition as (
        insert into "tax_provider_audits" (
          "id",
          "idempotency_key",
          "actor_id",
          "from_provider",
          "to_provider",
          "from_generation",
          "to_generation",
          "reason",
          "metadata",
          "acknowledgement_version",
          "from_collection_mode",
          "to_collection_mode"
        )
        select
          'taxaudit_safe_default_20260901',
          '00000000-0000-4000-8000-000000000901',
          'system:migration',
          "active_provider",
          "active_provider",
          "generation",
          "generation" + 1,
          'Initialize tax collection off until a configured provider is deliberately enabled.',
          '{"source":"safe_default_migration"}'::jsonb,
          'tax-collection-safe-default-2026-09-01',
          "collection_mode",
          'disabled'
        from initial_control
        on conflict ("idempotency_key") where "deleted_at" is null do nothing
        returning "to_generation"
      )
      update "tax_provider_controls"
      set
        "collection_mode" = 'disabled',
        "generation" = recorded_transition."to_generation",
        "last_switched_by" = 'system:migration',
        "last_switch_reason" = 'Initialize tax collection off until a configured provider is deliberately enabled.',
        "updated_at" = now()
      from recorded_transition
      where "tax_provider_controls"."id" = 'taxctrl_default';
    `)
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "tax_provider_controls" alter column "collection_mode" set default \'collect\';'
    )
    // Preserve the audited operating decision. Rewriting it during rollback
    // could silently re-enable collection after a later administrator change.
  }
}
