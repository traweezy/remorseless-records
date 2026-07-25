import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Knex } from "@mikro-orm/knex"

import {
  buildMonetaryAuditSummary,
  parseDatabaseAmount,
  type MonetaryAuditInput,
  type MonetaryRecordSource,
  type MonetaryUnitMode,
} from "../lib/money/monetary-audit"

export type MonetaryQueryRow = {
  amount: string | number
  currency_code: string | null
  id: string
  source: MonetaryRecordSource
}

export type CountQueryRow = {
  entity: string
  rows: string | number
}

export type RawParityQueryRow = {
  entity: string
  mismatches: string | number
}

export type MigrationStateQueryRow = {
  id: string
  mode: string | null
}

export type MonetaryAuditReport = {
  blockers: Record<string, number>
  rawAmountMismatches: Record<string, number>
  summary: ReturnType<typeof buildMonetaryAuditSummary>
}

export const monetaryRowsQuery = `
  select distinct
    price.id,
    price.currency_code,
    price.amount::text as amount,
    'active_product_price' as source
  from price
  inner join product_variant_price_set
    on product_variant_price_set.price_set_id = price.price_set_id
    and product_variant_price_set.deleted_at is null
  inner join product_variant
    on product_variant.id = product_variant_price_set.variant_id
    and product_variant.deleted_at is null
  inner join product
    on product.id = product_variant.product_id
    and product.deleted_at is null
  where price.deleted_at is null

  union all

  select distinct
    price.id,
    price.currency_code,
    price.amount::text,
    'shipping_option_price'
  from price
  inner join shipping_option_price_set
    on shipping_option_price_set.price_set_id = price.price_set_id
    and shipping_option_price_set.deleted_at is null
  where price.deleted_at is null

  union all

  select
    cart_line_item.id,
    cart.currency_code,
    cart_line_item.unit_price::text,
    'active_incomplete_cart_line_price'
  from cart_line_item
  inner join cart
    on cart.id = cart_line_item.cart_id
    and cart.deleted_at is null
    and cart.completed_at is null
  where cart_line_item.deleted_at is null

  union all

  select
    cart_line_item.id || ':compare',
    cart.currency_code,
    cart_line_item.compare_at_unit_price::text,
    'active_incomplete_cart_compare_price'
  from cart_line_item
  inner join cart
    on cart.id = cart_line_item.cart_id
    and cart.deleted_at is null
    and cart.completed_at is null
  where cart_line_item.deleted_at is null
    and cart_line_item.compare_at_unit_price is not null

  union all

  select
    cart_shipping_method.id,
    cart.currency_code,
    cart_shipping_method.amount::text,
    'active_incomplete_cart_shipping_price'
  from cart_shipping_method
  inner join cart
    on cart.id = cart_shipping_method.cart_id
    and cart.deleted_at is null
    and cart.completed_at is null
  where cart_shipping_method.deleted_at is null

  union all

  select
    shipping_option.id || ':base_amount',
    coalesce(nullif(shipping_option.data ->> 'currency_code', ''), 'usd'),
    shipping_option.data ->> 'base_amount',
    'calculated_shipping_option_data'
  from shipping_option
  where shipping_option.deleted_at is null
    and shipping_option.price_type = 'calculated'
    and shipping_option.data ? 'base_amount'

  union all

  select
    shipping_option.id || ':additional_amount',
    coalesce(nullif(shipping_option.data ->> 'currency_code', ''), 'usd'),
    shipping_option.data ->> 'additional_amount',
    'calculated_shipping_option_data'
  from shipping_option
  where shipping_option.deleted_at is null
    and shipping_option.price_type = 'calculated'
    and shipping_option.data ? 'additional_amount'
`

export const blockerCountsQuery = `
  select 'orders' as entity, count(*) as rows
  from "order"
  where deleted_at is null

  union all

  select 'payment_collections', count(*)
  from payment_collection
  where deleted_at is null

  union all

  select 'payment_sessions', count(*)
  from payment_session
  where deleted_at is null

  union all

  select 'payments', count(*)
  from payment
  where deleted_at is null

  union all

  select 'captures', count(*)
  from capture
  where deleted_at is null

  union all

  select 'refunds', count(*)
  from refund
  where deleted_at is null

  union all

  select 'order_transactions', count(*)
  from order_transaction
  where deleted_at is null

  union all

  select 'cart_line_item_adjustments', count(*)
  from cart_line_item_adjustment
  where deleted_at is null

  union all

  select 'cart_shipping_method_adjustments', count(*)
  from cart_shipping_method_adjustment
  where deleted_at is null

  union all

  select 'promotions', count(*)
  from promotion
  where deleted_at is null
`

export const rawParityQuery = `
  select
    'active_prices' as entity,
    count(*) filter (
      where raw_amount is null
        or (raw_amount ->> 'value')::numeric is distinct from amount
    ) as mismatches
  from price
  where deleted_at is null

  union all

  select
    'active_incomplete_cart_line_prices',
    count(*) filter (
      where cart_line_item.raw_unit_price is null
        or (cart_line_item.raw_unit_price ->> 'value')::numeric
          is distinct from cart_line_item.unit_price
    )
  from cart_line_item
  inner join cart
    on cart.id = cart_line_item.cart_id
    and cart.deleted_at is null
    and cart.completed_at is null
  where cart_line_item.deleted_at is null

  union all

  select
    'active_incomplete_cart_compare_prices',
    count(*) filter (
      where cart_line_item.raw_compare_at_unit_price is null
        or (cart_line_item.raw_compare_at_unit_price ->> 'value')::numeric
          is distinct from cart_line_item.compare_at_unit_price
    )
  from cart_line_item
  inner join cart
    on cart.id = cart_line_item.cart_id
    and cart.deleted_at is null
    and cart.completed_at is null
  where cart_line_item.deleted_at is null
    and cart_line_item.compare_at_unit_price is not null

  union all

  select
    'active_incomplete_cart_shipping_prices',
    count(*) filter (
      where cart_shipping_method.raw_amount is null
        or (cart_shipping_method.raw_amount ->> 'value')::numeric
          is distinct from cart_shipping_method.amount
    )
  from cart_shipping_method
  inner join cart
    on cart.id = cart_shipping_method.cart_id
    and cart.deleted_at is null
    and cart.completed_at is null
  where cart_shipping_method.deleted_at is null
`

export const migrationStateQuery = `
  select
    id,
    metadata ->> 'monetary_unit_mode' as mode
  from region
  where deleted_at is null
  order by id
`

const toCountRecord = (rows: CountQueryRow[]): Record<string, number> =>
  Object.fromEntries(rows.map((row) => [row.entity, Number(row.rows)]))

const toAuditInput = (row: MonetaryQueryRow): MonetaryAuditInput => ({
  amount: parseDatabaseAmount(row.amount),
  currencyCode: row.currency_code,
  id: row.id,
  source: row.source,
})

export const resolveMonetaryUnitMode = (
  rows: MigrationStateQueryRow[]
): MonetaryUnitMode => {
  if (rows.length !== 1) {
    throw new Error(
      `[money-audit] Expected one active region, found ${rows.length}.`
    )
  }

  const mode = rows[0]?.mode?.trim() || "legacy_minor"
  if (mode !== "legacy_minor" && mode !== "major") {
    throw new Error(`[money-audit] Unsupported monetary unit mode: ${mode}`)
  }
  return mode
}

export const buildMonetaryAuditReport = ({
  blockerRows,
  migrationStateRows,
  monetaryRows,
  rawParityRows,
}: {
  blockerRows: CountQueryRow[]
  migrationStateRows: MigrationStateQueryRow[]
  monetaryRows: MonetaryQueryRow[]
  rawParityRows: RawParityQueryRow[]
}): MonetaryAuditReport => ({
  blockers: toCountRecord(blockerRows),
  rawAmountMismatches: Object.fromEntries(
    rawParityRows.map((row) => [row.entity, Number(row.mismatches)])
  ),
  summary: buildMonetaryAuditSummary(
    monetaryRows.map(toAuditInput),
    resolveMonetaryUnitMode(migrationStateRows)
  ),
})

const loadAuditReport = async (database: Knex): Promise<MonetaryAuditReport> =>
  database.transaction(async (transaction) => {
    await transaction.raw("set transaction read only")

    const [
      monetaryResult,
      blockerResult,
      rawParityResult,
      migrationStateResult,
    ] = await Promise.all([
      transaction.raw<{ rows: MonetaryQueryRow[] }>(monetaryRowsQuery),
      transaction.raw<{ rows: CountQueryRow[] }>(blockerCountsQuery),
      transaction.raw<{ rows: RawParityQueryRow[] }>(rawParityQuery),
      transaction.raw<{ rows: MigrationStateQueryRow[] }>(migrationStateQuery),
    ])

    return buildMonetaryAuditReport({
      blockerRows: blockerResult.rows,
      migrationStateRows: migrationStateResult.rows,
      monetaryRows: monetaryResult.rows,
      rawParityRows: rawParityResult.rows,
    })
  })

const sumRecordValues = (record: Record<string, number>): number =>
  Object.values(record).reduce((total, value) => total + value, 0)

export const assertMonetaryAuditPasses = (
  report: MonetaryAuditReport
): void => {
  const blockerCount = sumRecordValues(report.blockers)
  const rawMismatchCount = sumRecordValues(report.rawAmountMismatches)
  const reviewCount = report.summary.manualReviewRecords

  if (blockerCount > 0 || rawMismatchCount > 0 || reviewCount > 0) {
    throw new Error(
      `[money-audit] Audit is blocked: transactional/adjustment rows=${blockerCount}, raw amount mismatches=${rawMismatchCount}, manual reviews=${reviewCount}.`
    )
  }
}

export default async function auditMonetaryUnits({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const database = container.resolve<Knex>(
    ContainerRegistrationKeys.PG_CONNECTION
  )
  const report = await loadAuditReport(database)

  logger.info(`[money-audit] ${JSON.stringify(report)}`)
  assertMonetaryAuditPasses(report)

  logger.info(
    `[money-audit] Read-only audit passes. proposedConversions=${report.summary.proposedConversions} preservedMajorRows=${report.summary.preservedRecords} manifestSha256=${report.summary.manifestSha256}`
  )
}
