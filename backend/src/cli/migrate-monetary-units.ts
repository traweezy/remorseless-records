import {
  createPostgreSqlClient,
  rollbackQuietly,
  type PostgreSqlClient,
} from "../lib/database/standalone-postgres"
import {
  auditMonetaryRecord,
  parseDatabaseAmount,
  type MonetaryAuditRecord,
} from "../lib/money/monetary-audit"
import { parseMonetaryMigrationArguments } from "../lib/money/monetary-migration"
import {
  assertMonetaryAuditPasses,
  blockerCountsQuery,
  buildMonetaryAuditReport,
  migrationStateQuery,
  monetaryRowsQuery,
  rawParityQuery,
  type CountQueryRow,
  type MigrationStateQueryRow,
  type MonetaryAuditReport,
  type MonetaryQueryRow,
  type RawParityQueryRow,
} from "../scripts/audit-monetary-units"

const lockTablesQuery = `
  lock table
    region,
    price,
    product_variant_price_set,
    shipping_option_price_set,
    product_variant,
    product,
    cart,
    cart_line_item,
    cart_shipping_method,
    shipping_option,
    "order",
    payment_collection,
    payment_session,
    payment,
    capture,
    refund,
    order_transaction,
    cart_line_item_adjustment,
    cart_shipping_method_adjustment,
    promotion
  in share mode
`

const updateProductPricesQuery = `
  update price
  set
    amount = trim_scale(amount / 100),
    raw_amount = jsonb_set(
      raw_amount,
      '{value}',
      to_jsonb(trim_scale(amount / 100)::text),
      false
    ),
    updated_at = now()
  where deleted_at is null
    and exists (
      select 1
      from product_variant_price_set
      inner join product_variant
        on product_variant.id = product_variant_price_set.variant_id
        and product_variant.deleted_at is null
      inner join product
        on product.id = product_variant.product_id
        and product.deleted_at is null
      where product_variant_price_set.price_set_id = price.price_set_id
        and product_variant_price_set.deleted_at is null
    )
    and not exists (
      select 1
      from shipping_option_price_set
      where shipping_option_price_set.price_set_id = price.price_set_id
        and shipping_option_price_set.deleted_at is null
    )
  returning id
`

const updateCartLinePricesQuery = `
  update cart_line_item
  set
    unit_price = trim_scale(unit_price / 100),
    raw_unit_price = jsonb_set(
      raw_unit_price,
      '{value}',
      to_jsonb(trim_scale(unit_price / 100)::text),
      false
    ),
    updated_at = now()
  from cart
  where cart.id = cart_line_item.cart_id
    and cart.deleted_at is null
    and cart.completed_at is null
    and cart_line_item.deleted_at is null
  returning cart_line_item.id
`

const updateCartComparePricesQuery = `
  update cart_line_item
  set
    compare_at_unit_price = trim_scale(compare_at_unit_price / 100),
    raw_compare_at_unit_price = jsonb_set(
      raw_compare_at_unit_price,
      '{value}',
      to_jsonb(trim_scale(compare_at_unit_price / 100)::text),
      false
    ),
    updated_at = now()
  from cart
  where cart.id = cart_line_item.cart_id
    and cart.deleted_at is null
    and cart.completed_at is null
    and cart_line_item.deleted_at is null
    and cart_line_item.compare_at_unit_price is not null
  returning cart_line_item.id
`

const updateCartShippingPricesQuery = `
  update cart_shipping_method
  set
    amount = trim_scale(amount / 100),
    raw_amount = jsonb_set(
      raw_amount,
      '{value}',
      to_jsonb(trim_scale(amount / 100)::text),
      false
    ),
    updated_at = now()
  from cart
  where cart.id = cart_shipping_method.cart_id
    and cart.deleted_at is null
    and cart.completed_at is null
    and cart_shipping_method.deleted_at is null
  returning cart_shipping_method.id
`

const updateShippingBaseQuery = `
  update shipping_option
  set
    data = jsonb_set(
      data,
      '{base_amount}',
      to_jsonb(trim_scale((data ->> 'base_amount')::numeric / 100)),
      false
    ),
    updated_at = now()
  where deleted_at is null
    and price_type = 'calculated'
    and data ? 'base_amount'
  returning id
`

const updateShippingAdditionalQuery = `
  update shipping_option
  set
    data = jsonb_set(
      data,
      '{additional_amount}',
      to_jsonb(trim_scale((data ->> 'additional_amount')::numeric / 100)),
      false
    ),
    updated_at = now()
  where deleted_at is null
    and price_type = 'calculated'
    and data ? 'additional_amount'
  returning id
`

const markMajorUnitModeQuery = `
  update region
  set
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'monetary_unit_mode', 'major',
      'monetary_unit_migration_manifest_sha256', $1::text,
      'monetary_unit_migrated_at', now()::text
    ),
    updated_at = now()
  where deleted_at is null
    and coalesce(metadata ->> 'monetary_unit_mode', 'legacy_minor')
      = 'legacy_minor'
  returning id
`

type IdentifierRow = {
  id: string
}

const loadAuditReport = async (
  client: PostgreSqlClient
): Promise<{
  monetaryRows: MonetaryQueryRow[]
  report: MonetaryAuditReport
}> => {
  const monetaryResult =
    await client.query<MonetaryQueryRow>(monetaryRowsQuery)
  const blockerResult =
    await client.query<CountQueryRow>(blockerCountsQuery)
  const rawParityResult =
    await client.query<RawParityQueryRow>(rawParityQuery)
  const migrationStateResult =
    await client.query<MigrationStateQueryRow>(migrationStateQuery)

  return {
    monetaryRows: monetaryResult.rows,
    report: buildMonetaryAuditReport({
      blockerRows: blockerResult.rows,
      migrationStateRows: migrationStateResult.rows,
      monetaryRows: monetaryResult.rows,
      rawParityRows: rawParityResult.rows,
    }),
  }
}

const expectedPostMigrationAmounts = (
  rows: MonetaryQueryRow[]
): Map<string, MonetaryAuditRecord> =>
  new Map(
    rows.map((row) => {
      const audited = auditMonetaryRecord({
        amount: parseDatabaseAmount(row.amount),
        currencyCode: row.currency_code,
        id: row.id,
        source: row.source,
      })
      return [`${row.source}:${row.id}`, audited]
    })
  )

const verifyPostMigrationAmounts = (
  expected: Map<string, MonetaryAuditRecord>,
  rows: MonetaryQueryRow[]
): void => {
  if (expected.size !== rows.length) {
    throw new Error(
      `[money-migration] Monetary row count changed from ${expected.size} to ${rows.length}.`
    )
  }

  for (const row of rows) {
    const identity = `${row.source}:${row.id}`
    const before = expected.get(identity)
    const actual = parseDatabaseAmount(row.amount)
    if (!before || before.proposedMajorAmount === null) {
      throw new Error(
        `[money-migration] Missing reviewed post-migration value for ${identity}.`
      )
    }
    if (Math.abs(actual - before.proposedMajorAmount) > Number.EPSILON) {
      throw new Error(
        `[money-migration] Unexpected post-migration amount for ${identity}.`
      )
    }
  }
}

const sourceCount = (
  report: MonetaryAuditReport,
  source: keyof MonetaryAuditReport["summary"]["bySource"]
): number => report.summary.bySource[source] ?? 0

const assertUpdatedCount = (
  label: string,
  actual: number,
  expected: number
): void => {
  if (actual !== expected) {
    throw new Error(
      `[money-migration] ${label} updated ${actual} row(s); expected ${expected}.`
    )
  }
}

const applyMigration = async (
  client: PostgreSqlClient,
  expectedCount: number,
  expectedManifestSha256: string
): Promise<void> => {
  await client.query("begin")
  let transactionOpen = true

  try {
    await client.query("set local lock_timeout = '10s'")
    await client.query(lockTablesQuery)

    const before = await loadAuditReport(client)
    assertMonetaryAuditPasses(before.report)

    if (before.report.summary.mode !== "legacy_minor") {
      throw new Error(
        `[money-migration] Expected legacy_minor mode, found ${before.report.summary.mode}.`
      )
    }
    if (before.report.summary.proposedConversions !== expectedCount) {
      throw new Error(
        `[money-migration] Expected ${expectedCount} conversions, audited ${before.report.summary.proposedConversions}.`
      )
    }
    if (
      before.report.summary.manifestSha256 !== expectedManifestSha256
    ) {
      throw new Error(
        "[money-migration] Manifest SHA-256 changed; refusing migration."
      )
    }

    const expectedAmounts = expectedPostMigrationAmounts(before.monetaryRows)
    // A single PostgreSQL client owns this transaction. Execute writes in a
    // deterministic order so each row count is attributable to one statement.
    const productPrices = await client.query<IdentifierRow>(
      updateProductPricesQuery
    )
    const cartLinePrices = await client.query<IdentifierRow>(
      updateCartLinePricesQuery
    )
    const cartComparePrices = await client.query<IdentifierRow>(
      updateCartComparePricesQuery
    )
    const cartShippingPrices = await client.query<IdentifierRow>(
      updateCartShippingPricesQuery
    )
    const shippingBaseValues = await client.query<IdentifierRow>(
      updateShippingBaseQuery
    )
    const shippingAdditionalValues = await client.query<IdentifierRow>(
      updateShippingAdditionalQuery
    )

    assertUpdatedCount(
      "Product prices",
      productPrices.rows.length,
      sourceCount(before.report, "active_product_price")
    )
    assertUpdatedCount(
      "Cart line prices",
      cartLinePrices.rows.length,
      sourceCount(before.report, "active_incomplete_cart_line_price")
    )
    assertUpdatedCount(
      "Cart compare-at prices",
      cartComparePrices.rows.length,
      sourceCount(before.report, "active_incomplete_cart_compare_price")
    )
    assertUpdatedCount(
      "Cart shipping prices",
      cartShippingPrices.rows.length,
      sourceCount(before.report, "active_incomplete_cart_shipping_price")
    )
    assertUpdatedCount(
      "Calculated shipping values",
      shippingBaseValues.rows.length + shippingAdditionalValues.rows.length,
      sourceCount(before.report, "calculated_shipping_option_data")
    )

    const updatedAmounts =
      productPrices.rows.length +
      cartLinePrices.rows.length +
      cartComparePrices.rows.length +
      cartShippingPrices.rows.length +
      shippingBaseValues.rows.length +
      shippingAdditionalValues.rows.length
    assertUpdatedCount("All monetary values", updatedAmounts, expectedCount)

    const markerResult = await client.query<IdentifierRow>(
      markMajorUnitModeQuery,
      [expectedManifestSha256]
    )
    assertUpdatedCount("Region migration markers", markerResult.rows.length, 1)

    const after = await loadAuditReport(client)
    assertMonetaryAuditPasses(after.report)
    if (
      after.report.summary.mode !== "major" ||
      after.report.summary.proposedConversions !== 0 ||
      after.report.summary.preservedRecords !==
        before.report.summary.totalRecords
    ) {
      throw new Error(
        "[money-migration] Post-migration major-unit audit failed."
      )
    }
    verifyPostMigrationAmounts(expectedAmounts, after.monetaryRows)

    await client.query("commit")
    transactionOpen = false
    console.info(
      `[money-migration] Applied ${updatedAmounts} monetary conversions atomically. postManifestSha256=${after.report.summary.manifestSha256}`
    )
  } catch (error) {
    if (transactionOpen) {
      await rollbackQuietly(client)
    }
    throw error
  }
}

const dryRun = async (client: PostgreSqlClient): Promise<void> => {
  await client.query("begin transaction read only")
  try {
    const { report } = await loadAuditReport(client)
    await client.query("rollback")
    assertMonetaryAuditPasses(report)
    console.info(`[money-migration] ${JSON.stringify(report)}`)
    console.info(
      "[money-migration] Dry run only. Supply --apply with the reviewed count and manifest SHA-256."
    )
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  }
}

const run = async (): Promise<void> => {
  const args = parseMonetaryMigrationArguments(process.argv.slice(2))
  const client = await createPostgreSqlClient(
    "remorseless_money_major_unit_migration"
  )

  await client.connect()
  try {
    if (args.apply) {
      await applyMigration(
        client,
        args.expectedCount,
        args.expectedManifestSha256
      )
    } else {
      await dryRun(client)
    }
  } finally {
    await client.end()
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[money-migration] ${message}`)
  process.exitCode = 1
})
