import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import {
  mediaBackupConfirmation,
  parseMinioClientVersion,
  parseMediaInventory,
  validateMediaEndpoint,
  verifyMediaMirror,
} from "./lib/media-backup.mjs"

const source = validateMediaEndpoint(
  process.env.MEDIA_BACKUP_SOURCE,
  "MEDIA_BACKUP_SOURCE",
)
const target = validateMediaEndpoint(
  process.env.MEDIA_BACKUP_TARGET,
  "MEDIA_BACKUP_TARGET",
)
assert.notEqual(source, target, "Media backup source and target must differ.")
const outputDirectory = process.env.MEDIA_BACKUP_OUTPUT_DIR
assert.ok(outputDirectory, "MEDIA_BACKUP_OUTPUT_DIR is required.")
assert.equal(
  resolve(outputDirectory),
  outputDirectory,
  "Media backup output directory must be absolute.",
)
await mkdir(outputDirectory, { mode: 0o700, recursive: true })
const outputMetadata = await lstat(outputDirectory)
assert.equal(outputMetadata.isSymbolicLink(), false, "Output directory is a symlink.")
assert.equal(outputMetadata.isDirectory(), true, "Output path is not a directory.")
assert.equal(
  outputMetadata.mode & 0o077,
  0,
  "Output directory must not grant group or world access.",
)
assert.equal(
  await realpath(outputDirectory),
  outputDirectory,
  "Output directory must use its canonical path.",
)

const runMc = (args, stdio = ["ignore", "pipe", "inherit"]) => {
  const result = spawnSync("mc", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    stdio,
  })
  if (result.error) {
    throw result.error
  }
  assert.equal(result.signal, null, `mc ${args[0]} terminated unexpectedly.`)
  assert.equal(result.status, 0, `mc ${args[0]} failed.`)
  return result.stdout
}
const inventory = (endpoint) =>
  parseMediaInventory(runMc(["ls", "--recursive", "--json", endpoint]))

const mcVersion = parseMinioClientVersion(runMc(["--version"]))
const sourceInventory = inventory(source)
const confirmation = mediaBackupConfirmation(source, target)
const apply = process.argv.includes("--apply")
if (!apply) {
  runMc(
    ["mirror", "--dry-run", "--overwrite", "--checksum", "SHA256", source, target],
    "inherit",
  )
  process.stdout.write(
    `${JSON.stringify({ bytes: sourceInventory.bytes, confirmation, mcVersion, objectCount: sourceInventory.objectCount, sourceInventorySha256: sourceInventory.sha256, status: "dry_run" })}\n`,
  )
  process.exit(0)
}
assert.equal(
  process.env.MEDIA_BACKUP_CONFIRM,
  confirmation,
  "MEDIA_BACKUP_CONFIRM must equal the dry-run confirmation.",
)

const startedAt = Date.now()
runMc(
  ["mirror", "--overwrite", "--checksum", "SHA256", source, target],
  "inherit",
)
const targetInventory = inventory(target)
const mirrorEvidence = verifyMediaMirror(sourceInventory, targetInventory)
const manifest = {
  bytes: sourceInventory.bytes,
  completedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  inventorySha256: sourceInventory.sha256,
  mcVersion,
  objectCount: sourceInventory.objectCount,
  preservedTargetObjects: mirrorEvidence.preservedTargetObjects,
  schemaVersion: 1,
  sourceId: createEndpointId(source),
  status: "verified",
  targetId: createEndpointId(target),
  targetInventorySha256: mirrorEvidence.targetInventorySha256,
}
const manifestPath = join(
  outputDirectory,
  `media-backup-${manifest.completedAt.replaceAll(/[:.]/gu, "-")}-${randomUUID()}.json`,
)
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
})
process.stdout.write(`${JSON.stringify({ ...manifest, manifestPath })}\n`)

function createEndpointId(endpoint) {
  return mediaBackupConfirmation(endpoint, "inventory")
}
