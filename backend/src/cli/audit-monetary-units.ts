import {
  assertMonetaryAuditPasses,
  blockerCountsQuery,
  buildMonetaryAuditReport,
  migrationStateQuery,
  monetaryRowsQuery,
  rawParityQuery,
  type CountQueryRow,
  type MigrationStateQueryRow,
  type MonetaryQueryRow,
  type RawParityQueryRow,
} from "../scripts/audit-monetary-units"
import {
  createPostgreSqlClient,
  rollbackQuietly,
} from "../lib/database/standalone-postgres"

const run = async (): Promise<void> => {
  const client = await createPostgreSqlClient("remorseless_money_audit")
  let transactionOpen = false

  await client.connect()
  try {
    await client.query("begin transaction read only")
    transactionOpen = true

    const monetaryResult =
      await client.query<MonetaryQueryRow>(monetaryRowsQuery)
    const blockerResult =
      await client.query<CountQueryRow>(blockerCountsQuery)
    const rawParityResult =
      await client.query<RawParityQueryRow>(rawParityQuery)
    const migrationStateResult =
      await client.query<MigrationStateQueryRow>(migrationStateQuery)

    const report = buildMonetaryAuditReport({
      blockerRows: blockerResult.rows,
      migrationStateRows: migrationStateResult.rows,
      monetaryRows: monetaryResult.rows,
      rawParityRows: rawParityResult.rows,
    })

    await client.query("rollback")
    transactionOpen = false

    console.info(`[money-audit] ${JSON.stringify(report)}`)
    assertMonetaryAuditPasses(report)
    console.info(
      `[money-audit] Read-only audit passes. proposedConversions=${report.summary.proposedConversions} preservedMajorRows=${report.summary.preservedRecords} manifestSha256=${report.summary.manifestSha256}`
    )
  } catch (error) {
    if (transactionOpen) {
      await rollbackQuietly(client)
    }
    throw error
  } finally {
    await client.end()
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[money-audit] ${message}`)
  process.exitCode = 1
})
