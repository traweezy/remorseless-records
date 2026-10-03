import {
  migrationClient,
  migrationContext,
  migrationMode,
  waitForMigrationReceipt,
} from "./migration-receipt.mjs"

try {
  if (
    process.argv.length !== 2 ||
    migrationMode(process.env) !== "external" ||
    process.env.DATABASE_MIGRATION_URL ||
    process.env.DATABASE_BACKUP_URL ||
    process.env.DATABASE_SOURCE_IDENTITY_URL
  )
    throw new Error("invalid_runtime_migration_boundary")
  const context = migrationContext(process.env)
  await waitForMigrationReceipt({
    client: migrationClient(process.env.DATABASE_URL),
    context,
  })
  process.stdout.write("[migration-receipt] status=accepted\n")
} catch {
  process.stderr.write("[migration-receipt] status=failed\n")
  process.exitCode = 1
}
