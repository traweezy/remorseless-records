import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import {
  createPostgresClientEnvironment,
  hashFileSha256,
  parseBackupManifest,
} from "./lib/postgres-logical-backup.mjs"
import {
  buildRestoreInvariantsSql,
  buildRestoreTableListSql,
  parseRestoreInvariants,
  parseRestoreReceipt,
  parseRestoreTableList,
} from "./lib/postgres-restore.mjs"
import {
  openPostgresSnapshot,
  openPrivateOutputDirectory,
  publishSnapshotDirectory,
} from "./lib/postgres-snapshot.mjs"
import {
  createRecoveryScope,
  parseRecoveryArguments,
  recoveryEnvironment,
  recoveryTimeoutMs,
  runRecoveryCommand,
} from "./lib/recovery-process.mjs"

const help = `Usage: postgres-snapshot-backup --output-dir <absolute-private-dir>
Creates a custom archive, checksum manifest and restore receipt from one
exported PostgreSQL snapshot. Requires DATABASE_BACKUP_URL and matching-major
trusted pg_dump, pg_restore and psql binaries on PATH. No source write pause is
needed for DML; pause schema DDL until the command finishes.
DATABASE_RECOVERY_TIMEOUT_MS: overall deadline (default 30 minutes, max 4 hours).
SIGINT/SIGTERM cancel and reap all clients before private cleanup.
The private output directory must have mode 0700 and enough free space.
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
  let exporter
  let outputDirectory
  let pendingDirectory
  const startedAt = Date.now()
  try {
    const args = parseRecoveryArguments(inputArguments, ["--output-dir"])
    const output = args["--output-dir"]
    assert.equal(resolve(output), output)
    scope = createRecoveryScope(
      recoveryTimeoutMs(process.env.DATABASE_RECOVERY_TIMEOUT_MS)
    )
    const connection = createPostgresClientEnvironment(
      process.env.DATABASE_BACKUP_URL ?? "",
      "DATABASE_BACKUP_URL"
    )
    const environment = recoveryEnvironment(connection)
    const run = (command, values) =>
      runRecoveryCommand(command, values, {
        environment,
        signal: scope.signal,
      })
    phase = "output_directory"
    await mkdir(output, { mode: 0o700, recursive: true })
    outputDirectory = await openPrivateOutputDirectory(output)
    pendingDirectory = await mkdtemp(join(output, ".postgres-snapshot-"))
    await outputDirectory.assertStable()
    const archive = join(pendingDirectory, "database.dump")
    const manifestPath = join(pendingDirectory, "database.manifest.json")
    const receiptPath = join(pendingDirectory, "database.restore-receipt.json")
    phase = "client_version"
    const version = await run("pg_dump", ["--version"])
    const clientMajor = /^pg_dump \(PostgreSQL\) (\d+)(?:\.|\s)/u.exec(version)
    assert.ok(version.length <= 128 && clientMajor)
    phase = "snapshot_export"
    exporter = await openPostgresSnapshot({ environment, signal: scope.signal })
    const { snapshot } = exporter
    const query = (sql) => run("psql", psqlArguments(sql))
    phase = "source_inventory"
    const tables = parseRestoreTableList(
      await query(buildRestoreTableListSql(snapshot))
    )
    exporter.assertOpen()
    const invariants = parseRestoreInvariants(
      await query(buildRestoreInvariantsSql(tables, snapshot))
    )
    assert.deepEqual(
      invariants.tableRows.map(({ schema, table }) => ({ schema, table })),
      tables
    )
    assert.equal(Number(clientMajor[1]), invariants.serverMajor)
    exporter.assertOpen()
    phase = "dump"
    await run("pg_dump", [
      "--no-password",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--lock-wait-timeout=10000",
      `--snapshot=${snapshot}`,
      `--file=${archive}`,
    ])
    exporter.assertOpen()
    phase = "archive_verification"
    await run("pg_restore", ["--format=custom", "--list", archive])
    const archiveStats = await stat(archive)
    assert.ok(archiveStats.isFile() && archiveStats.size > 0)
    const sha256 = await hashFileSha256(archive, { signal: scope.signal })
    const manifest = parseBackupManifest({
      bytes: archiveStats.size,
      createdAt: new Date().toISOString(),
      format: "postgres-custom",
      pgDumpVersion: version,
      schemaVersion: 1,
      sha256,
      sourceFingerprint: connection.fingerprint,
    })
    const receipt = parseRestoreReceipt({
      schemaVersion: 1,
      archiveSha256: sha256,
      sourceFingerprint: connection.fingerprint,
      invariants,
    })
    phase = "snapshot_release"
    exporter.assertOpen()
    await exporter.close()
    exporter = undefined
    phase = "publish"
    scope.signal.throwIfAborted()
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      signal: scope.signal,
    })
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      signal: scope.signal,
    })
    await chmod(archive, 0o600)
    const suffix = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${randomUUID()}`
    const publishedDirectory = join(output, `postgres-snapshot-${suffix}`)
    await publishSnapshotDirectory({
      pendingDirectory,
      publishedDirectory,
      signal: scope.signal,
      outputDirectory,
      onRenamed: (path) => {
        pendingDirectory = path
      },
    })
    const evidence = {
      archivePath: join(publishedDirectory, "database.dump"),
      bytes: archiveStats.size,
      manifestPath: join(publishedDirectory, "database.manifest.json"),
      receiptPath: join(publishedDirectory, "database.restore-receipt.json"),
      sha256,
      sourceMajor: invariants.serverMajor,
      status: "snapshot_bundle_verified",
      tableCount: invariants.counts.tables,
    }
    await outputDirectory.close()
    outputDirectory = undefined
    scope.signal.throwIfAborted()
    process.stdout.write(
      `${JSON.stringify({ ...evidence, durationMs: Date.now() - startedAt })}\n`
    )
    pendingDirectory = undefined
  } catch {
    process.stderr.write(
      `${JSON.stringify({ status: "failed", phase, durationMs: Date.now() - startedAt })}\n`
    )
    process.exitCode = 1
  } finally {
    if (exporter) await exporter.close()
    if (pendingDirectory) {
      try {
        await rm(pendingDirectory, { force: true, recursive: true })
      } catch {
        process.stderr.write(
          '{"status":"failed","phase":"temporary_cleanup"}\n'
        )
        process.exitCode = 1
      }
    }
    if (outputDirectory)
      try {
        await outputDirectory.close()
      } catch {
        process.stderr.write(
          '{"status":"failed","phase":"output_directory_cleanup"}\n'
        )
        process.exitCode = 1
      }
    scope?.close()
  }
}
await main()
