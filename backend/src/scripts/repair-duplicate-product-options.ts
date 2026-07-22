import { deleteProductOptionsWorkflow } from "@medusajs/core-flows"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Knex } from "@mikro-orm/knex"

import {
  selectSafeDuplicateProductOptions,
  type DuplicateProductOptionRow,
} from "../lib/catalog/duplicate-product-options"

const BATCH_SIZE = 50

type AuditRow = {
  product_id: string
  handle: string
  title: string
  option_id: string
  values: string[] | null
  variant_count: string | number
}

const auditQuery = `
  with option_stats as (
    select
      p.id as product_id,
      p.handle,
      po.title,
      po.id as option_id,
      array_remove(
        array_agg(distinct pov.value order by pov.value),
        null
      ) as values,
      count(distinct pvo.variant_id) as variant_count
    from product p
    join product_product_option ppo
      on ppo.product_id = p.id
      and ppo.deleted_at is null
    join product_option po
      on po.id = ppo.product_option_id
      and po.deleted_at is null
    left join product_option_value pov
      on pov.option_id = po.id
      and pov.deleted_at is null
    left join product_variant_option pvo
      on pvo.option_value_id = pov.id
    where p.deleted_at is null
    group by p.id, p.handle, po.title, po.id
  ), duplicate_groups as (
    select product_id, title
    from option_stats
    group by product_id, title
    having count(*) > 1
  )
  select option_stats.*
  from option_stats
  join duplicate_groups using (product_id, title)
  order by handle, title, option_id
`

const loadAuditRows = async (database: Knex): Promise<DuplicateProductOptionRow[]> => {
  const result = await database.raw<{ rows: AuditRow[] }>(auditQuery)
  return result.rows.map((row) => ({
    productId: row.product_id,
    handle: row.handle,
    title: row.title,
    optionId: row.option_id,
    values: row.values ?? [],
    variantCount: Number(row.variant_count),
  }))
}

export default async function repairDuplicateProductOptions({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const database = container.resolve<Knex>(
    ContainerRegistrationKeys.PG_CONNECTION
  )
  const apply = process.argv.includes("--apply")
  const rows = await loadAuditRows(database)
  const repair = selectSafeDuplicateProductOptions(rows)

  logger.info(
    `[catalog-options] ${repair.productCount} product(s) have ${repair.deleteIds.length} safe unlinked duplicate option(s). mode=${apply ? "apply" : "dry-run"}`
  )
  if (!apply || repair.deleteIds.length === 0) {
    return
  }

  for (let index = 0; index < repair.deleteIds.length; index += BATCH_SIZE) {
    const ids = repair.deleteIds.slice(index, index + BATCH_SIZE)
    await deleteProductOptionsWorkflow(container).run({ input: { ids } })
    logger.info(
      `[catalog-options] Removed batch ${Math.floor(index / BATCH_SIZE) + 1} (${ids.length} option(s)).`
    )
  }

  const remaining = selectSafeDuplicateProductOptions(
    await loadAuditRows(database)
  )
  if (remaining.deleteIds.length > 0) {
    throw new Error(
      `[catalog-options] ${remaining.deleteIds.length} duplicate option(s) remain after repair.`
    )
  }
  logger.info("[catalog-options] Duplicate product option audit passes.")
}
