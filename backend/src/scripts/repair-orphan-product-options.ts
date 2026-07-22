import { deleteProductOptionsWorkflow } from "@medusajs/core-flows"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Knex } from "@mikro-orm/knex"

import {
  parseExpectedCount,
  selectSafeOrphanProductOptions,
  type OrphanProductOptionRow,
} from "../lib/catalog/orphan-product-options"

const BATCH_SIZE = 50
const HISTORICAL_CUTOFF = new Date("2026-07-20T00:00:00.000Z")

type AuditRow = {
  active_value_count: string | number
  active_variant_count: string | number
  created_at: Date | string
  deleted_variant_count: string | number
  option_id: string
  product_link_count: string | number
  title: string
}

const auditQuery = `
  select
    product_option.id as option_id,
    product_option.title,
    product_option.created_at,
    count(distinct product_option_link.id) as product_link_count,
    count(distinct product_option_value.id) filter (
      where product_option_value.deleted_at is null
    ) as active_value_count,
    count(distinct product_variant_option.variant_id) filter (
      where product_variant.deleted_at is null
    ) as active_variant_count,
    count(distinct product_variant_option.variant_id) filter (
      where product_variant.deleted_at is not null
    ) as deleted_variant_count
  from product_option
  left join product_product_option as product_option_link
    on product_option_link.product_option_id = product_option.id
  left join product_option_value
    on product_option_value.option_id = product_option.id
  left join product_variant_option
    on product_variant_option.option_value_id = product_option_value.id
  left join product_variant
    on product_variant.id = product_variant_option.variant_id
  where product_option.deleted_at is null
    and lower(trim(product_option.title)) = 'format'
    and product_option.created_at < ?
    and not exists (
      select 1
      from product_product_option as active_product_option_link
      where active_product_option_link.product_option_id = product_option.id
        and active_product_option_link.deleted_at is null
    )
  group by product_option.id, product_option.title, product_option.created_at
  order by product_option.created_at, product_option.id
`

const loadAuditRows = async (database: Knex): Promise<OrphanProductOptionRow[]> => {
  const result = await database.raw<{ rows: AuditRow[] }>(auditQuery, [
    HISTORICAL_CUTOFF,
  ])
  return result.rows.map((row) => ({
    activeValueCount: Number(row.active_value_count),
    activeVariantCount: Number(row.active_variant_count),
    createdAt: new Date(row.created_at),
    deletedVariantCount: Number(row.deleted_variant_count),
    optionId: row.option_id,
    productLinkCount: Number(row.product_link_count),
    title: row.title,
  }))
}

export default async function repairOrphanProductOptions({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const database = container.resolve<Knex>(
    ContainerRegistrationKeys.PG_CONNECTION
  )
  const apply = process.argv.includes("--apply")
  const expectedCount = parseExpectedCount(process.argv)
  const cleanup = selectSafeOrphanProductOptions(
    await loadAuditRows(database),
    HISTORICAL_CUTOFF
  )

  logger.info(
    `[catalog-option-orphans] ${cleanup.deleteIds.length} safe historical unowned Format option(s), ${cleanup.activeValueCount} active value(s), and ${cleanup.deletedVariantCount} deleted-variant reference(s). cutoff=${HISTORICAL_CUTOFF.toISOString()} mode=${apply ? "apply" : "dry-run"}`
  )
  if (!apply || cleanup.deleteIds.length === 0) {
    return
  }
  if (expectedCount === undefined) {
    throw new Error(
      "[catalog-option-orphans] Apply mode requires --expected-count=<dry-run count>."
    )
  }
  if (cleanup.deleteIds.length !== expectedCount) {
    throw new Error(
      `[catalog-option-orphans] Expected ${expectedCount} options but audited ${cleanup.deleteIds.length}; refusing cleanup.`
    )
  }

  for (let index = 0; index < cleanup.deleteIds.length; index += BATCH_SIZE) {
    const ids = cleanup.deleteIds.slice(index, index + BATCH_SIZE)
    await deleteProductOptionsWorkflow(container).run({ input: { ids } })
    logger.info(
      `[catalog-option-orphans] Removed batch ${Math.floor(index / BATCH_SIZE) + 1} (${ids.length} option(s)).`
    )
  }

  const remaining = selectSafeOrphanProductOptions(
    await loadAuditRows(database),
    HISTORICAL_CUTOFF
  )
  if (remaining.deleteIds.length > 0) {
    throw new Error(
      `[catalog-option-orphans] ${remaining.deleteIds.length} historical orphan option(s) remain after cleanup.`
    )
  }
  logger.info("[catalog-option-orphans] Historical orphan option audit passes.")
}
