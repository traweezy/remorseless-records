import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { lstat, readFile, realpath, stat } from "node:fs/promises"
import { resolve } from "node:path"

import {
  createPostgresClientEnvironment,
  hashFileSha256,
  parseBackupManifest,
} from "./lib/postgres-logical-backup.mjs"

const readFlag = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const archivePath = readFlag("--archive")
const manifestPath = readFlag("--manifest")
assert.ok(
  archivePath && manifestPath,
  "Usage: postgres-restore-drill --archive <path> --manifest <path> [--apply]"
)
for (const path of [archivePath, manifestPath]) {
  assert.equal(resolve(path), path, "Restore inputs must use absolute paths.")
  const metadata = await lstat(path)
  assert.equal(metadata.isSymbolicLink(), false, "Restore input is a symlink.")
  assert.equal(metadata.isFile(), true, "Restore input is not a regular file.")
  assert.equal(await realpath(path), path, "Restore input must be canonical.")
}

const manifestStats = await stat(manifestPath)
assert.ok(
  manifestStats.size > 0 && manifestStats.size <= 64 * 1024,
  "Backup manifest must be between 1 byte and 64 KiB."
)

const manifest = parseBackupManifest(
  JSON.parse(await readFile(manifestPath, "utf8"))
)
const archiveStats = await stat(archivePath)
assert.equal(archiveStats.size, manifest.bytes, "Backup byte length changed.")
assert.equal(
  await hashFileSha256(archivePath),
  manifest.sha256,
  "Backup checksum verification failed."
)
const connection = createPostgresClientEnvironment(
  process.env.DATABASE_RESTORE_URL ?? "",
  "DATABASE_RESTORE_URL"
)
assert.notEqual(
  connection.fingerprint,
  manifest.sourceFingerprint,
  "Restore drills must target a different database service."
)

const commandEnvironment = {
  HOME: process.env.HOME,
  LANG: process.env.LANG ?? "C.UTF-8",
  PATH: process.env.PATH,
  ...connection.environment,
}
delete commandEnvironment.DATABASE_RESTORE_URL
const run = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: commandEnvironment,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  })
  if (result.error) {
    throw result.error
  }
  assert.equal(result.signal, null, `${command} terminated unexpectedly.`)
  assert.equal(result.status, 0, `${command} failed.`)
  return result.stdout.trim()
}

const applicationTableCount = () =>
  Number.parseInt(
    run("psql", [
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=1",
      "--tuples-only",
      "--no-align",
      "--command=select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema');",
    ]),
    10
  )
const beforeTables = applicationTableCount()
assert.equal(
  beforeTables,
  0,
  "Restore target is not an empty disposable database."
)

const apply = process.argv.includes("--apply")
if (!apply) {
  process.stdout.write(
    `${JSON.stringify({ confirmation: connection.fingerprint, sourceChecksum: manifest.sha256, status: "dry_run_verified", targetTables: beforeTables })}\n`
  )
  process.exit(0)
}
assert.equal(
  process.env.DATABASE_RESTORE_CONFIRM,
  connection.fingerprint,
  "DATABASE_RESTORE_CONFIRM must equal the dry-run target fingerprint."
)

const startedAt = Date.now()
run("pg_restore", [
  "--exit-on-error",
  "--single-transaction",
  "--no-owner",
  "--no-privileges",
  `--dbname=${connection.environment.PGDATABASE}`,
  archivePath,
])
const afterTables = applicationTableCount()
assert.ok(afterTables > 0, "Restore completed without application tables.")
process.stdout.write(
  `${JSON.stringify({ durationMs: Date.now() - startedAt, sourceChecksum: manifest.sha256, status: "restore_verified", targetTables: afterTables })}\n`
)
