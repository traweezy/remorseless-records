import assert from "node:assert/strict"
import { lstat, open, realpath, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import { createPostgresClientEnvironment } from "./lib/postgres-logical-backup.mjs"
import {
  buildRestoreInvariantsSql,
  parseRestoreInvariants,
  parseRestoreReceipt,
  parseRestoreTableList,
  readBackupManifest,
  RESTORE_TABLE_LIST_SQL,
} from "./lib/postgres-restore.mjs"
import {
  createRecoveryScope,
  parseRecoveryArguments,
  recoveryEnvironment,
  recoveryTimeoutMs,
  runRecoveryCommand,
} from "./lib/recovery-process.mjs"

const help = `Usage: postgres-restore-receipt --manifest <absolute-path> --output <absolute-private-path>
Requires DATABASE_BACKUP_URL for the trusted, quiesced source of this archive.
Captures exact per-table row counts and schema counts with read-only queries.
The source must have no writers between archive creation and receipt capture.
Output parent must already exist, be canonical and private; output is 0600.
DATABASE_RECOVERY_TIMEOUT_MS: overall deadline (default 30 minutes, maximum 4 hours).
SIGINT/SIGTERM cancel and reap the active client before cleanup.
This receipt does not authenticate an untrusted archive or prove a consistent
snapshot if source data changed after pg_dump.
`

const psqlArguments = (sql) => [
  "--no-psqlrc",
  "--no-password",
  "--quiet",
  "--set=ON_ERROR_STOP=1",
  "--tuples-only",
  "--no-align",
  `--command=${sql}`,
]

const main = async () => {
  const inputArguments = normalizeScriptArguments(process.argv.slice(2))
  if (inputArguments.length === 1 && inputArguments[0] === "--help") {
    process.stdout.write(help)
    return
  }
  let phase = "arguments"
  let scope
  let ownedOutput
  let evidence
  const startedAt = Date.now()
  try {
    const args = parseRecoveryArguments(inputArguments, [
      "--manifest",
      "--output",
    ])
    assert.equal(resolve(args["--output"]), args["--output"])
    scope = createRecoveryScope(
      recoveryTimeoutMs(process.env.DATABASE_RECOVERY_TIMEOUT_MS)
    )
    const connection = createPostgresClientEnvironment(
      process.env.DATABASE_BACKUP_URL ?? "",
      "DATABASE_BACKUP_URL"
    )
    phase = "source_verification"
    const manifest = await readBackupManifest(args["--manifest"], scope.signal)
    assert.equal(connection.fingerprint, manifest.sourceFingerprint)
    const parent = dirname(args["--output"])
    const metadata = await lstat(parent)
    assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink())
    assert.equal(metadata.mode & 0o077, 0)
    assert.equal(await realpath(parent), parent)
    const run = (sql) =>
      runRecoveryCommand("psql", psqlArguments(sql), {
        environment: recoveryEnvironment(connection),
        signal: scope.signal,
      })
    phase = "source_inventory"
    const tables = parseRestoreTableList(await run(RESTORE_TABLE_LIST_SQL))
    const invariants = parseRestoreInvariants(
      await run(buildRestoreInvariantsSql(tables))
    )
    assert.deepEqual(
      invariants.tableRows.map(({ schema, table }) => ({ schema, table })),
      tables
    )
    const receipt = parseRestoreReceipt({
      schemaVersion: 1,
      archiveSha256: manifest.sha256,
      sourceFingerprint: manifest.sourceFingerprint,
      invariants,
    })
    phase = "publish"
    scope.signal.throwIfAborted()
    const file = await open(args["--output"], "wx", 0o600)
    ownedOutput = args["--output"]
    try {
      await file.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8")
      await file.sync()
    } finally {
      await file.close()
    }
    evidence = {
      archiveSha256: receipt.archiveSha256,
      sourceMajor: receipt.invariants.serverMajor,
      tableCount: receipt.invariants.counts.tables,
      status: "receipt_captured",
    }
  } catch {
    process.stderr.write(
      `${JSON.stringify({ status: "failed", phase, durationMs: Date.now() - startedAt })}\n`
    )
    process.exitCode = 1
  } finally {
    scope?.close()
    if (ownedOutput && process.exitCode) {
      try {
        await rm(ownedOutput)
      } catch {
        process.stderr.write('{"status":"failed","phase":"receipt_cleanup"}\n')
      }
    }
  }
  if (evidence && !process.exitCode)
    process.stdout.write(
      `${JSON.stringify({ ...evidence, durationMs: Date.now() - startedAt })}\n`
    )
}
await main()
