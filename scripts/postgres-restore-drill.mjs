import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import { createPostgresClientEnvironment } from "./lib/postgres-logical-backup.mjs"
import {
  parseRestoreInventory,
  readBackupManifest,
  restoreArchiveLimit,
  RESTORE_TARGET_PREFLIGHT_SQL,
  snapshotBackupArchive,
} from "./lib/postgres-restore.mjs"
import {
  createRecoveryScope,
  parseRecoveryArguments,
  recoveryEnvironment,
  recoveryTimeoutMs,
  runRecoveryCommand,
} from "./lib/recovery-process.mjs"

const help = `Usage: postgres-restore-drill --archive <absolute-path> --manifest <absolute-path> [--apply]
Default: read-only database preflight; creates and removes a private local archive snapshot.
Requires DATABASE_RESTORE_URL. Apply also requires DATABASE_RESTORE_CONFIRM from dry-run.
Only use a trusted archive and an isolated, empty disposable target with no other writers.
Checksums establish integrity, not archive trust or endpoint-alias identity.
DATABASE_RECOVERY_TIMEOUT_MS: overall deadline (default 30 minutes, maximum 4 hours).
DATABASE_RESTORE_MAX_ARCHIVE_BYTES: snapshot budget (default 10 GiB, maximum 1 TiB).
Budget free space in the system temporary directory for one complete archive copy.
SIGINT/SIGTERM cancel and reap the active client before temporary-file cleanup.
Apply uses one transaction without --clean or --create. After a timeout or lost response,
inspect the disposable target: a committed restore may require manual acceptance.
No live provider or application smoke-test acceptance is implied.
`

const main = async () => {
  const inputArguments = normalizeScriptArguments(process.argv.slice(2))
  if (inputArguments.length === 1 && inputArguments[0] === "--help") {
    process.stdout.write(help)
    return
  }
  let phase = "arguments"
  let scope
  let directory
  let evidence
  const startedAt = Date.now()
  try {
    const args = parseRecoveryArguments(
      inputArguments,
      ["--archive", "--manifest"],
      true
    )
    scope = createRecoveryScope(
      recoveryTimeoutMs(process.env.DATABASE_RECOVERY_TIMEOUT_MS)
    )
    const maxBytes = restoreArchiveLimit(
      process.env.DATABASE_RESTORE_MAX_ARCHIVE_BYTES
    )
    const connection = createPostgresClientEnvironment(
      process.env.DATABASE_RESTORE_URL ?? "",
      "DATABASE_RESTORE_URL"
    )
    if (args.apply)
      assert.equal(process.env.DATABASE_RESTORE_CONFIRM, connection.fingerprint)
    const run = (command, values) =>
      runRecoveryCommand(command, values, {
        environment: recoveryEnvironment(connection),
        signal: scope.signal,
      })
    phase = "archive_verification"
    const manifest = await readBackupManifest(args["--manifest"], scope.signal)
    assert.ok(manifest.bytes <= maxBytes)
    assert.notEqual(connection.fingerprint, manifest.sourceFingerprint)
    directory = await mkdtemp(join(tmpdir(), "remorseless-restore-"))
    const snapshot = join(directory, "verified.dump")
    await snapshotBackupArchive(
      args["--archive"],
      snapshot,
      manifest,
      scope.signal
    )
    await run("pg_restore", ["--format=custom", "--list", snapshot])
    const inventory = async () =>
      parseRestoreInventory(
        await run("psql", [
          "--no-psqlrc",
          "--no-password",
          "--quiet",
          "--set=ON_ERROR_STOP=1",
          "--tuples-only",
          "--no-align",
          `--command=${RESTORE_TARGET_PREFLIGHT_SQL}`,
        ])
      )
    phase = "target_preflight"
    const before = await inventory()
    assert.equal(before.objects, 0)
    assert.equal(before.tables, 0)
    if (!args.apply) {
      evidence = {
        confirmation: connection.fingerprint,
        sourceChecksum: manifest.sha256,
        status: "dry_run_verified",
        targetTables: before.tables,
        targetObjects: before.objects,
      }
    } else {
      phase = "restore"
      await run("pg_restore", [
        "--format=custom",
        "--no-password",
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
        `--dbname=${connection.environment.PGDATABASE}`,
        snapshot,
      ])
      phase = "target_verification"
      const after = await inventory()
      assert.ok(after.tables > 0)
      evidence = {
        sourceChecksum: manifest.sha256,
        status: "restore_verified",
        targetTables: after.tables,
        targetObjects: after.objects,
      }
    }
  } catch {
    process.stderr.write(
      `${JSON.stringify({ status: "failed", phase, durationMs: Date.now() - startedAt })}\n`
    )
    process.exitCode = 1
  } finally {
    scope?.close()
    if (directory) {
      try {
        await rm(directory, { force: true, recursive: true })
      } catch {
        process.stderr.write(
          '{"status":"failed","phase":"temporary_cleanup"}\n'
        )
        process.exitCode = 1
      }
    }
  }
  if (evidence && !process.exitCode)
    process.stdout.write(
      `${JSON.stringify({ ...evidence, durationMs: Date.now() - startedAt })}\n`
    )
}
await main()
