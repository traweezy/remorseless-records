import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises"
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
import {
  createMediaBackupScope,
  runMediaBackupCommand,
} from "./lib/media-backup-command.mjs"

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
SIGINT/SIGTERM cancel and reap the active mc child before the command exits.
Metadata requests, retries and read-ahead are not included in that byte budget.
Only successful SHA-256 comparisons produce schema-version-2 verified evidence.
No deletions or rollback: failed verification may leave a partial mirror.
See docs/INFRASTRUCTURE_RECOVERY.md for quiescence and alias-scope requirements.
`)
  process.exit(0)
}

const main = async () => {
  const scope = createMediaBackupScope()
  let phase = "arguments"
  let ownedManifestPath
  let evidence
  const workflowStartedAt = Date.now()
  try {
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
    phase = "output_directory"
    scope.signal.throwIfAborted()
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

    const runMc = (args) =>
      runMediaBackupCommand(args, {
        environment: process.env,
        signal: scope.signal,
      })
    const inventory = async (endpoint) =>
      parseMediaInventory(
        await runMc(["ls", "--recursive", "--json", endpoint])
      )

    phase = "client_version"
    const mcVersion = parseMinioClientVersion(await runMc(["--version"]))
    phase = "source_inventory"
    const sourceInventory = await inventory(source)
    assert.ok(
      Number.isSafeInteger(sourceInventory.bytes * 2),
      "Media verification read size is unsafe."
    )
    const confirmation = mediaBackupConfirmation(source, target)
    const apply = process.argv.includes("--apply")
    if (!apply) {
      phase = "dry_run"
      await runMc([
        "mirror",
        "--dry-run",
        "--overwrite",
        "--checksum",
        "SHA256",
        source,
        target,
      ])
      scope.signal.throwIfAborted()
      evidence = {
        bytes: sourceInventory.bytes,
        confirmation,
        mcVersion,
        objectCount: sourceInventory.objectCount,
        sourceInventorySha256: sourceInventory.sha256,
        verificationReadBytes: sourceInventory.bytes * 2,
        verificationReadRequests: sourceInventory.objectCount * 2,
        status: "dry_run",
      }
    } else {
      assert.equal(
        process.env.MEDIA_BACKUP_CONFIRM,
        confirmation,
        "MEDIA_BACKUP_CONFIRM must equal the dry-run confirmation."
      )
      // Review the additional two full object reads per source key before any write.
      const verificationLimits = parseMediaVerificationLimits(process.env)
      validateMediaVerificationBudget(sourceInventory, verificationLimits)

      const startedAt = Date.now()
      phase = "mirror"
      await runMc([
        "mirror",
        "--overwrite",
        "--checksum",
        "SHA256",
        source,
        target,
      ])
      phase = "target_inventory"
      const targetInventory = await inventory(target)
      const verificationStartedAt = Date.now()
      phase = "content_verification"
      const mirrorEvidence = await verifyMediaMirror(
        sourceInventory,
        targetInventory,
        {
          limits: verificationLimits,
          signal: scope.signal,
          hashObject: ({ side, ...options }) =>
            hashMcObject({
              ...options,
              endpoint: side === "source" ? source : target,
            }),
        }
      )
      scope.signal.throwIfAborted()
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
      phase = "publish"
      scope.signal.throwIfAborted()
      const manifestFile = await open(manifestPath, "wx", 0o600)
      ownedManifestPath = manifestPath
      try {
        scope.signal.throwIfAborted()
        await manifestFile.writeFile(
          `${JSON.stringify(manifest, null, 2)}\n`,
          "utf8"
        )
      } finally {
        await manifestFile.close()
      }
      scope.signal.throwIfAborted()
      evidence = { ...manifest, manifestPath }
    }
  } catch {
    if (ownedManifestPath) {
      try {
        await unlink(ownedManifestPath)
      } catch {
        phase = "manifest_cleanup"
      }
    }
    process.stderr.write(
      `${JSON.stringify({ status: "failed", phase, durationMs: Date.now() - workflowStartedAt })}\n`
    )
    process.exitCode = 1
  } finally {
    scope.close()
  }
  if (evidence && !process.exitCode)
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
}
await main()
