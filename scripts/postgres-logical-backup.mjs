import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
} from "./lib/postgres-logical-backup.mjs"

const outputFlag = process.argv.indexOf("--output-dir")
const outputValue = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined
assert.ok(
  outputValue,
  "Usage: postgres-logical-backup --output-dir <absolute-dir>"
)
assert.equal(
  resolve(outputValue),
  outputValue,
  "The backup output directory must be absolute."
)
const connection = createPostgresClientEnvironment(
  process.env.DATABASE_BACKUP_URL ?? "",
  "DATABASE_BACKUP_URL"
)

await mkdir(outputValue, { mode: 0o700, recursive: true })
const outputMetadata = await lstat(outputValue)
assert.equal(
  outputMetadata.isSymbolicLink(),
  false,
  "Backup directory is a symlink."
)
assert.equal(
  outputMetadata.isDirectory(),
  true,
  "Backup path is not a directory."
)
assert.equal(
  outputMetadata.mode & 0o077,
  0,
  "Backup directory must not grant group or world access."
)
assert.equal(
  await realpath(outputValue),
  outputValue,
  "Backup directory must use its canonical path."
)

const pendingDirectory = await mkdtemp(join(outputValue, ".postgres-backup-"))
const pendingArchive = join(pendingDirectory, "database.dump")
const pendingManifest = join(pendingDirectory, "database.manifest.json")
const suffix = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${randomUUID()}`
const archivePath = join(outputValue, `postgres-${suffix}.dump`)
const manifestPath = join(outputValue, `postgres-${suffix}.manifest.json`)

const commandEnvironment = {
  HOME: process.env.HOME,
  LANG: process.env.LANG ?? "C.UTF-8",
  PATH: process.env.PATH,
  ...connection.environment,
}
delete commandEnvironment.DATABASE_BACKUP_URL

const run = (command, args, stdio = "inherit") => {
  const result = spawnSync(command, args, {
    env: commandEnvironment,
    maxBuffer: 20 * 1024 * 1024,
    stdio,
  })
  if (result.error) {
    throw result.error
  }
  assert.equal(result.signal, null, `${command} terminated unexpectedly.`)
  assert.equal(result.status, 0, `${command} failed.`)
  return result
}

try {
  const version = run("pg_dump", ["--version"], ["ignore", "pipe", "inherit"])
    .stdout.toString()
    .trim()
  run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    `--file=${pendingArchive}`,
  ])
  run("pg_restore", ["--list", pendingArchive], ["ignore", "pipe", "inherit"])

  const archiveStats = await stat(pendingArchive)
  assert.ok(archiveStats.isFile() && archiveStats.size > 0)
  const sha256 = await hashFileSha256(pendingArchive)
  const manifest = {
    bytes: archiveStats.size,
    createdAt: new Date().toISOString(),
    format: "postgres-custom",
    pgDumpVersion: version,
    schemaVersion: 1,
    sha256,
    sourceFingerprint: connection.fingerprint,
  }
  await writeFile(pendingManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
  JSON.parse(await readFile(pendingManifest, "utf8"))
  await chmod(pendingArchive, 0o600)
  await rename(pendingArchive, archivePath)
  await rename(pendingManifest, manifestPath)
  process.stdout.write(
    `${JSON.stringify({ archivePath, bytes: archiveStats.size, manifestPath, sha256, status: "verified" })}\n`
  )
} finally {
  await rm(pendingDirectory, { force: true, recursive: true })
}
