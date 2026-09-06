import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { resolve, join } from "node:path"
import {
  createPostgresClientEnvironment,
  hashFileSha256,
  parseBackupManifest,
} from "./lib/postgres-logical-backup.mjs"
import {
  createRecoveryScope,
  parseRecoveryArguments,
  recoveryEnvironment,
  recoveryTimeoutMs,
  runRecoveryCommand,
} from "./lib/recovery-process.mjs"

const help = `Usage: postgres-logical-backup --output-dir <absolute-private-dir>
Creates a PostgreSQL custom archive and schema-version-one checksum manifest.
Requires DATABASE_BACKUP_URL; credentials and raw database errors are not logged.
DATABASE_RECOVERY_TIMEOUT_MS: overall deadline (default 30 minutes, maximum 4 hours).
SIGINT/SIGTERM cancel and reap the active client before temporary-file cleanup.
No restore or provider configuration is performed. Budget local disk space first.
Only trusted PostgreSQL client binaries should be present on PATH.
`

const main = async () => {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    process.stdout.write(help)
    return
  }
  let phase = "arguments"
  let scope
  let pendingDirectory
  let evidence
  const startedAt = Date.now()
  try {
    const args = parseRecoveryArguments(process.argv.slice(2), ["--output-dir"])
    const output = args["--output-dir"]
    assert.equal(resolve(output), output)
    scope = createRecoveryScope(
      recoveryTimeoutMs(process.env.DATABASE_RECOVERY_TIMEOUT_MS)
    )
    const connection = createPostgresClientEnvironment(
      process.env.DATABASE_BACKUP_URL ?? "",
      "DATABASE_BACKUP_URL"
    )
    const run = (command, values) =>
      runRecoveryCommand(command, values, {
        environment: recoveryEnvironment(connection),
        signal: scope.signal,
      })
    phase = "output_directory"
    await mkdir(output, { mode: 0o700, recursive: true })
    const metadata = await lstat(output)
    assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink())
    assert.equal(metadata.mode & 0o077, 0)
    assert.equal(await realpath(output), output)
    pendingDirectory = await mkdtemp(join(output, ".postgres-backup-"))
    const archive = join(pendingDirectory, "database.dump")
    const pendingManifest = join(pendingDirectory, "database.manifest.json")
    phase = "client_version"
    const version = await run("pg_dump", ["--version"])
    assert.ok(
      version.length <= 128 &&
        /^pg_dump \(PostgreSQL\) \d[^\r\n]*$/u.test(version)
    )
    phase = "dump"
    await run("pg_dump", [
      "--no-password",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--lock-wait-timeout=10000",
      `--file=${archive}`,
    ])
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
    phase = "publish"
    scope.signal.throwIfAborted()
    await writeFile(pendingManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      signal: scope.signal,
    })
    await chmod(archive, 0o600)
    const suffix = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${randomUUID()}`
    const archivePath = join(output, `postgres-${suffix}.dump`)
    const manifestPath = join(output, `postgres-${suffix}.manifest.json`)
    await rename(archive, archivePath)
    await rename(pendingManifest, manifestPath)
    evidence = {
      archivePath,
      bytes: archiveStats.size,
      manifestPath,
      sha256,
      status: "verified",
    }
  } catch {
    process.stderr.write(
      `${JSON.stringify({ status: "failed", phase, durationMs: Date.now() - startedAt })}\n`
    )
    process.exitCode = 1
  } finally {
    scope?.close()
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
  }
  if (evidence && !process.exitCode)
    process.stdout.write(
      `${JSON.stringify({ ...evidence, durationMs: Date.now() - startedAt })}\n`
    )
}
await main()
