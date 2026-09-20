import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  mediaBackupConfirmation,
  parseMinioClientVersion,
  parseMediaInventory,
  validateMediaDirections,
  validateMediaEndpoint,
  verifyMediaMirror,
} from "./lib/media-backup.mjs"
import {
  createMediaBackupScope,
  runMediaBackupCommand,
} from "./lib/media-backup-command.mjs"
import { hashMcObject } from "./lib/media-object-checksum.mjs"
import {
  mediaRestoreConfirmation,
  parseMediaRestoreLimits,
  parseMediaRestoreTimeout,
  readPrivateMediaManifest,
  validateMediaRestoreSource,
} from "./lib/media-restore-drill.mjs"

const help = `Usage: pnpm run data:media:restore-drill -- --current-state-only [--apply]
       pnpm run data:media:restore-drill -- --help

Default: read-only preflight and mc mirror --dry-run. No object content reads.
--current-state-only explicitly acknowledges that object version history and
delete markers are not restored. This flag is required even for the dry-run.
Required: MEDIA_RESTORE_SOURCE, MEDIA_RESTORE_TARGET (distinct mc alias/bucket
paths), MEDIA_RESTORE_MANIFEST (private absolute schema-v3 backup manifest),
MEDIA_RESTORE_MANIFEST_SHA256 (independently recorded lowercase SHA-256),
MEDIA_RESTORE_OUTPUT_DIR (absolute private receipt directory).
Apply also requires MEDIA_RESTORE_CONFIRM from the dry-run,
MEDIA_RESTORE_MAX_TRANSFER_BYTES and MEDIA_RESTORE_VERIFY_MAX_BYTES.
Optional: MEDIA_RESTORE_VERIFY_MAX_OBJECTS (default 10000, maximum 100000),
MEDIA_RESTORE_TIMEOUT_MS (default 1800000, maximum 3600000).

Apply writes only to a pre-created, empty disposable target. It never deletes
objects, creates buckets, or changes the original off-site source. A partial
mirror on failure requires operator inspection. The source must match the
backup manifest's exact off-site inventory, with no preserved target-only
objects. Full restored content must match its recorded aggregate SHA-256.
Version history and delete markers are outside this current-state drill.
Credential-bearing mc output, keys and provider errors are never printed.
The reviewed transfer and two-download budgets exclude provider metadata,
retries and wire overhead; they are not hard billing ceilings.
`
const hashPattern = /^[a-f0-9]{64}$/u
const failure = () => new Error("Media restore drill unavailable.")

export const parseMediaRestoreArguments = (args, environment) => {
  const normalized = args[0] === "--" ? args.slice(1) : args
  if (normalized.length === 1 && normalized[0] === "--help")
    return { mode: "help" }
  if (
    !normalized.includes("--current-state-only") ||
    normalized.some(
      (argument) => !["--apply", "--current-state-only"].includes(argument)
    ) ||
    new Set(normalized).size !== normalized.length
  )
    throw failure()
  const source = validateMediaEndpoint(
    environment.MEDIA_RESTORE_SOURCE,
    "MEDIA_RESTORE_SOURCE"
  )
  const target = validateMediaEndpoint(
    environment.MEDIA_RESTORE_TARGET,
    "MEDIA_RESTORE_TARGET"
  )
  validateMediaDirections(source, target)
  const manifest = environment.MEDIA_RESTORE_MANIFEST
  const manifestSha256 = environment.MEDIA_RESTORE_MANIFEST_SHA256
  const outputDirectory = environment.MEDIA_RESTORE_OUTPUT_DIR
  if (
    !manifest ||
    !hashPattern.test(manifestSha256 ?? "") ||
    !outputDirectory ||
    resolve(outputDirectory) !== outputDirectory ||
    Buffer.byteLength(outputDirectory) > 1_024
  )
    throw failure()
  const apply = normalized.includes("--apply")
  const limits = apply ? parseMediaRestoreLimits(environment) : undefined
  const timeoutMs = parseMediaRestoreTimeout(environment)
  return {
    mode: apply ? "apply" : "dry_run",
    source,
    target,
    manifest,
    manifestSha256,
    outputDirectory,
    confirmation: environment.MEDIA_RESTORE_CONFIRM,
    limits,
    timeoutMs,
  }
}

const privateOutputDirectory = async (directory) => {
  await mkdir(directory, { mode: 0o700, recursive: true })
  const info = await lstat(directory)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    (info.mode & 0o077) !== 0 ||
    (await realpath(directory)) !== directory
  )
    throw failure()
}

export const runMediaRestoreDrill = async ({
  args = process.argv.slice(2),
  environment = process.env,
  runMc = runMediaBackupCommand,
  hashObject = hashMcObject,
  write = (line) => process.stdout.write(line),
  writeError = (line) => process.stderr.write(line),
  now = Date.now,
} = {}) => {
  let phase = "arguments"
  let scope
  let receiptPath
  let receiptOwned = false
  const startedAt = now()
  try {
    const options = parseMediaRestoreArguments(args, environment)
    if (options.mode === "help") {
      write(help)
      return 0
    }
    scope = createMediaBackupScope()
    const deadline = AbortSignal.timeout(options.timeoutMs)
    const signal = AbortSignal.any([scope.signal, deadline])
    const command = (arguments_) => runMc(arguments_, { environment, signal })
    const inventory = async (endpoint) =>
      parseMediaInventory(
        await command(["ls", "--recursive", "--json", endpoint])
      )

    phase = "manifest"
    const backup = await readPrivateMediaManifest(
      options.manifest,
      options.manifestSha256,
      signal
    )
    if (
      backup?.schemaVersion !== 3 ||
      backup.recoveryScope !== "current_state_only"
    )
      throw failure()
    phase = "output_directory"
    await privateOutputDirectory(options.outputDirectory)
    phase = "client_version"
    const mcVersion = parseMinioClientVersion(await command(["--version"]))
    phase = "source_inventory"
    const sourceInventory = await inventory(options.source)
    const expected = validateMediaRestoreSource(
      backup,
      options.source,
      sourceInventory
    )
    phase = "target_inventory"
    const targetBefore = await inventory(options.target)
    if (targetBefore.objectCount !== 0) throw failure()
    const confirmation = mediaRestoreConfirmation(
      options.source,
      options.target,
      options.manifestSha256
    )
    if (options.mode === "dry_run") {
      phase = "dry_run"
      await command([
        "mirror",
        "--dry-run",
        "--overwrite",
        "--checksum",
        "SHA256",
        options.source,
        options.target,
      ])
      signal.throwIfAborted()
      write(
        `${JSON.stringify({ status: "dry_run", recoveryScope: "current_state_only", manifestSha256: options.manifestSha256, sourceId: backup.targetId, confirmation, objectCount: expected.objectCount, transferBytes: expected.bytes, verificationReadBytes: expected.bytes * 2, verificationReadRequests: expected.objectCount * 2 })}\n`
      )
      return 0
    }
    if (
      options.confirmation !== confirmation ||
      expected.bytes > options.limits.transferBytes ||
      expected.bytes * 2 > options.limits.verificationBytes ||
      expected.objectCount > options.limits.maxObjects
    )
      throw failure()
    phase = "target_recheck"
    if ((await inventory(options.target)).objectCount !== 0) throw failure()
    phase = "mirror"
    await command([
      "mirror",
      "--overwrite",
      "--checksum",
      "SHA256",
      options.source,
      options.target,
    ])
    phase = "restored_inventory"
    const targetAfter = await inventory(options.target)
    if (
      targetAfter.objectCount !== expected.objectCount ||
      targetAfter.bytes !== expected.bytes ||
      targetAfter.sha256 !== sourceInventory.sha256
    )
      throw failure()
    phase = "content_verification"
    const verified = await verifyMediaMirror(sourceInventory, targetAfter, {
      limits: {
        maxBytes: options.limits.verificationBytes,
        maxObjects: options.limits.maxObjects,
        timeoutMs: options.limits.timeoutMs,
      },
      signal,
      hashObject: ({ side, ...value }) =>
        hashObject({
          ...value,
          endpoint: side === "source" ? options.source : options.target,
        }),
    })
    if (
      verified.contentSha256 !== expected.contentSha256 ||
      verified.verifiedObjects !== expected.objectCount ||
      verified.verificationReadBytes !== expected.bytes * 2
    )
      throw failure()
    const receipt = {
      schemaVersion: 2,
      status: "media_restore_verified",
      recoveryScope: "current_state_only",
      backupManifestSha256: options.manifestSha256,
      backupContentSha256: expected.contentSha256,
      sourceId: backup.targetId,
      targetId: mediaBackupConfirmation(options.target, "inventory"),
      mcVersion,
      objectCount: expected.objectCount,
      restoredBytes: expected.bytes,
      verificationReadBytes: verified.verificationReadBytes,
      contentSha256: verified.contentSha256,
      completedAt: new Date(now()).toISOString(),
      durationMs: now() - startedAt,
    }
    phase = "publish"
    signal.throwIfAborted()
    receiptPath = join(
      options.outputDirectory,
      `media-restore-${receipt.completedAt.replaceAll(/[:.]/gu, "-")}-${randomUUID()}.json`
    )
    const handle = await open(receiptPath, "wx", 0o600)
    receiptOwned = true
    try {
      signal.throwIfAborted()
      await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    signal.throwIfAborted()
    write(`${JSON.stringify({ ...receipt, receiptPath })}\n`)
    return 0
  } catch {
    if (receiptOwned) {
      try {
        await unlink(receiptPath)
      } catch {
        phase = "receipt_cleanup"
      }
    }
    writeError(
      `${JSON.stringify({ status: "failed", phase, durationMs: now() - startedAt })}\n`
    )
    return 1
  } finally {
    scope?.close()
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await runMediaRestoreDrill()
