import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import {
  mediaBackupConfirmation,
  parseMinioClientVersion,
  parseMediaInventory,
  parseMediaVerificationLimits,
  validateMediaDirections,
  validateMediaEndpoint,
  validateMediaVerificationBudget,
  verifyMediaMirror,
} from "./lib/media-backup.mjs"
import { hashMcObject } from "./lib/media-object-checksum.mjs"

const createEndpointId = (endpoint) =>
  mediaBackupConfirmation(endpoint, "inventory")
if (
  process.argv
    .slice(2)
    .some((argument) => !["--", "--apply", "--help"].includes(argument))
) {
  throw new Error("Only --apply and --help media backup flags are supported.")
}
if (process.argv.includes("--help")) {
  process.stdout.write(`Usage: pnpm run data:media:backup -- [--apply | --help]

Default: dry-run only; no object writes or content downloads.
Required: MEDIA_BACKUP_SOURCE, MEDIA_BACKUP_TARGET (distinct mc alias/bucket paths),
          MEDIA_BACKUP_OUTPUT_DIR (absolute private evidence directory).
Apply also requires MEDIA_BACKUP_CONFIRM from the dry-run and
MEDIA_BACKUP_VERIFY_MAX_BYTES: reviewed planned bytes for both content reads.
Optional: MEDIA_BACKUP_VERIFY_MAX_OBJECTS (10000, maximum 100000),
          MEDIA_BACKUP_VERIFY_TIMEOUT_MS (600000, maximum 3600000).
Listing/mirror commands time out after 600000 ms. Verification downloads each
source and target object; GET/egress costs are additional to the mirror itself.
Metadata requests, retries and read-ahead are not included in that byte budget.
Only successful SHA-256 comparisons produce schema-version-2 verified evidence.
No deletions or rollback: failed verification may leave a partial mirror.
See docs/INFRASTRUCTURE_RECOVERY.md for quiescence and alias-scope requirements.
`)
  process.exit(0)
}

const source = validateMediaEndpoint(
  process.env.MEDIA_BACKUP_SOURCE,
  "MEDIA_BACKUP_SOURCE"
)
const target = validateMediaEndpoint(
  process.env.MEDIA_BACKUP_TARGET,
  "MEDIA_BACKUP_TARGET"
)
validateMediaDirections(source, target)
const outputDirectory = process.env.MEDIA_BACKUP_OUTPUT_DIR
assert.ok(outputDirectory, "MEDIA_BACKUP_OUTPUT_DIR is required.")
assert.equal(
  resolve(outputDirectory),
  outputDirectory,
  "Media backup output directory must be absolute."
)
await mkdir(outputDirectory, { mode: 0o700, recursive: true })
const outputMetadata = await lstat(outputDirectory)
assert.equal(
  outputMetadata.isSymbolicLink(),
  false,
  "Output directory is a symlink."
)
assert.equal(
  outputMetadata.isDirectory(),
  true,
  "Output path is not a directory."
)
assert.equal(
  outputMetadata.mode & 0o077,
  0,
  "Output directory must not grant group or world access."
)
assert.equal(
  await realpath(outputDirectory),
  outputDirectory,
  "Output directory must use its canonical path."
)

const runMc = (args) => {
  const result = spawnSync("mc", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000,
    killSignal: "SIGKILL",
  })
  if (result.error || result.signal !== null || result.status !== 0) {
    // Provider stderr can contain credential-bearing endpoints or object names.
    throw new Error("MinIO Client command failed or exceeded its deadline.")
  }
  return result.stdout
}
const inventory = (endpoint) =>
  parseMediaInventory(runMc(["ls", "--recursive", "--json", endpoint]))

const mcVersion = parseMinioClientVersion(runMc(["--version"]))
const sourceInventory = inventory(source)
assert.ok(
  Number.isSafeInteger(sourceInventory.bytes * 2),
  "Media verification read size is unsafe."
)
const confirmation = mediaBackupConfirmation(source, target)
const apply = process.argv.includes("--apply")
if (!apply) {
  runMc([
    "mirror",
    "--dry-run",
    "--overwrite",
    "--checksum",
    "SHA256",
    source,
    target,
  ])
  process.stdout.write(
    `${JSON.stringify({ bytes: sourceInventory.bytes, confirmation, mcVersion, objectCount: sourceInventory.objectCount, sourceInventorySha256: sourceInventory.sha256, verificationReadBytes: sourceInventory.bytes * 2, verificationReadRequests: sourceInventory.objectCount * 2, status: "dry_run" })}\n`
  )
  process.exit(0)
}
assert.equal(
  process.env.MEDIA_BACKUP_CONFIRM,
  confirmation,
  "MEDIA_BACKUP_CONFIRM must equal the dry-run confirmation."
)
// Review the additional two full object reads per source key before any write.
const verificationLimits = parseMediaVerificationLimits(process.env)
validateMediaVerificationBudget(sourceInventory, verificationLimits)

const startedAt = Date.now()
runMc(["mirror", "--overwrite", "--checksum", "SHA256", source, target])
const targetInventory = inventory(target)
const verificationStartedAt = Date.now()
const verificationController = new AbortController()
const cancelVerification = () => verificationController.abort()
process.once("SIGINT", cancelVerification)
process.once("SIGTERM", cancelVerification)
let mirrorEvidence
try {
  mirrorEvidence = await verifyMediaMirror(sourceInventory, targetInventory, {
    limits: verificationLimits,
    signal: verificationController.signal,
    hashObject: ({ side, ...options }) =>
      hashMcObject({
        ...options,
        endpoint: side === "source" ? source : target,
      }),
  })
} finally {
  process.removeListener("SIGINT", cancelVerification)
  process.removeListener("SIGTERM", cancelVerification)
}
const manifest = {
  bytes: sourceInventory.bytes,
  completedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  inventorySha256: sourceInventory.sha256,
  mcVersion,
  objectCount: sourceInventory.objectCount,
  preservedTargetObjects: mirrorEvidence.preservedTargetObjects,
  schemaVersion: 2,
  sourceId: createEndpointId(source),
  status: "verified",
  targetId: createEndpointId(target),
  targetInventorySha256: mirrorEvidence.targetInventorySha256,
  contentSha256: mirrorEvidence.contentSha256,
  verificationAlgorithm: mirrorEvidence.verificationAlgorithm,
  verificationDurationMs: Date.now() - verificationStartedAt,
  verificationReadBytes: mirrorEvidence.verificationReadBytes,
  verifiedObjects: mirrorEvidence.verifiedObjects,
}
const manifestPath = join(
  outputDirectory,
  `media-backup-${manifest.completedAt.replaceAll(/[:.]/gu, "-")}-${randomUUID()}.json`
)
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
})
process.stdout.write(`${JSON.stringify({ ...manifest, manifestPath })}\n`)
