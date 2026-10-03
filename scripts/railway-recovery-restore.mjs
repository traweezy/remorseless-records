import assert from "node:assert/strict"
import { open, readFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import { openPrivateOutputDirectory } from "./lib/postgres-snapshot.mjs"
import { createRecoveryStore } from "./lib/recovery-s3.mjs"
import { recoveryHash, restoreRecoverySnapshot } from "./lib/recovery-vault.mjs"
import { STAGING } from "./lib/staging-release.mjs"
import { main as timedRecovery } from "./postgres-timed-recovery.mjs"
import {
  openRailwayRecoveryStore,
  RECOVERY_TARGET,
} from "./railway-recovery-backup.mjs"
import { verifiedStagingRailwayReader } from "./staging-release-readiness.mjs"

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
const help = `Usage: railway-recovery-restore --apply --receipt <local-backup-receipt>
  --receipt-sha256 <independently-recorded-remote-receipt-sha256>
  --target-bucket <owned-empty-RecoveryDrill-bucket-id>
  --output-dir <empty-private-dir> --base-dir <short-private-dir>
Downloads and decrypts the pinned Railway snapshot. Media is restored to an
empty, scoped Railway drill bucket and fully read back; the database bundle is
restored through the existing isolated PostgreSQL target guards and cleaned.
Only the owned database target is removed. The drill bucket remains for scoped
inspection and deletion. Failure never authorizes reuse of a partial target.
`
export const parseRestoreArguments = (input) => {
  const args = normalizeScriptArguments(input)
  if (args.length === 1 && args[0] === "--help") return { help }
  const options = {}
  const names = [
    "--apply",
    "--receipt",
    "--receipt-sha256",
    "--target-bucket",
    "--output-dir",
    "--base-dir",
  ]
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    assert.ok(names.includes(key) && !Object.hasOwn(options, key))
    options[key] = key === "--apply" ? true : args[++index]
    if (key !== "--apply") assert.equal(typeof options[key], "string")
  }
  assert.equal(options["--apply"], true)
  assert.match(options["--target-bucket"], uuid)
  assert.notEqual(options["--target-bucket"], RECOVERY_TARGET.bucketId)
  assert.match(options["--receipt-sha256"], /^[a-f0-9]{64}$/u)
  for (const key of ["--receipt", "--output-dir", "--base-dir"]) {
    assert.equal(typeof options[key], "string")
    assert.equal(resolve(options[key]), options[key])
  }
  return options
}

export const main = async (args, { signal, capture } = {}) => {
  const options = parseRestoreArguments(args)
  if (options.help) return options
  const start = performance.now()
  const startedAt = new Date().toISOString()
  const outputDir = options["--output-dir"]
  const output = await openPrivateOutputDirectory(outputDir)
  let source
  let target
  try {
    assert.deepEqual(await readdir(output.descriptorPath), [])
    const receiptBytes = await readFile(options["--receipt"])
    assert.ok(receiptBytes.length <= 8192)
    const receipt = JSON.parse(receiptBytes)
    assert.equal(receipt.receiptSha256, options["--receipt-sha256"])
    const railway = await verifiedStagingRailwayReader(capture)
    const vault = await openRailwayRecoveryStore(railway)
    source = vault.store
    const info = await railway([
      "bucket",
      "info",
      "--bucket",
      options["--target-bucket"],
      "--environment",
      STAGING.environmentId,
      "--json",
    ])
    assert.equal(info.id, options["--target-bucket"])
    assert.equal(info.environmentId, STAGING.environmentId)
    assert.match(info.name, /^RecoveryDrill-\d{8}(?:-[a-f0-9]{8})?$/u)
    const credentials = await railway([
      "bucket",
      "credentials",
      "--bucket",
      info.id,
      "--environment",
      STAGING.environmentId,
      "--json",
    ])
    assert.equal(
      new URL(credentials.endpoint).origin,
      "https://t3.storageapi.dev"
    )
    target = createRecoveryStore({
      ...credentials,
      bucket: credentials.bucketName,
      forcePathStyle: credentials.urlStyle === "path",
    })
    assert.notEqual(source.fingerprint, target.fingerprint)
    assert.deepEqual(await target.list(signal), [])
    const media = []
    const databaseFiles = new Set([
      "database.dump",
      "database.manifest.json",
      "database.restore-receipt.json",
      "source-scope.receipt.json",
    ])
    const pendingDatabaseFiles = new Set(databaseFiles)
    const restored = await restoreRecoverySnapshot({
      destination: source,
      key: vault.key,
      receiptKey: receipt.receiptKey,
      receiptSha256: options["--receipt-sha256"],
      targetFingerprint: source.fingerprint,
      signal,
      write: async (entry, bytes, abort) => {
        if (entry.kind === "database") {
          assert.ok(pendingDatabaseFiles.delete(entry.name))
          await output.assertStable()
          const file = await open(
            join(output.descriptorPath, entry.name),
            "wx",
            0o600
          )
          try {
            await file.writeFile(bytes)
            await file.sync()
          } finally {
            await file.close()
          }
          assert.equal(
            recoveryHash(
              await readFile(join(output.descriptorPath, entry.name))
            ),
            entry.sha256
          )
        } else {
          await target.put(entry.name, bytes, abort)
          const retained = await target.get(entry.name, bytes.length, abort)
          assert.equal(retained.length, bytes.length)
          assert.equal(recoveryHash(retained), entry.sha256)
          media.push({ key: entry.name, bytes: bytes.length })
        }
      },
    })
    assert.equal(pendingDatabaseFiles.size, 0)
    assert.equal(restored.id, receipt.id)
    assert.equal(restored.databaseObjects, databaseFiles.size)
    media.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    assert.deepEqual(
      (await target.list(signal)).map(({ key, bytes }) => ({ key, bytes })),
      media
    )
    const database = await timedRecovery(
      [
        "--apply",
        "--base-dir",
        options["--base-dir"],
        "--source-scope",
        join(outputDir, "source-scope.receipt.json"),
        "--archive",
        join(outputDir, "database.dump"),
        "--manifest",
        join(outputDir, "database.manifest.json"),
        "--receipt",
        join(outputDir, "database.restore-receipt.json"),
        "--output-dir",
        outputDir,
      ],
      { signal }
    )
    assert.equal(database.passed, true)
    await output.assertStable()
    signal?.throwIfAborted()
    const report = {
      passed: true,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Math.ceil(performance.now() - start),
      recoveryScope: "railway_encrypted_current_state",
      snapshotId: receipt.id,
      receiptSha256: options["--receipt-sha256"],
      targetBucketId: info.id,
      targetFingerprint: target.fingerprint,
      mediaObjects: media.length,
      mediaBytes: media.reduce((sum, item) => sum + item.bytes, 0),
      databaseTables: database.targetTables,
      databaseRecoveryDurationMs: database.recoveryDurationMs,
      databaseCleanupVerified: database.cleanupVerified,
      pitrVerified: false,
      offsiteVerified: false,
      versionHistoryVerified: false,
      applicationAccepted: false,
    }
    const file = await open(
      join(output.descriptorPath, "railway-restore-result.json"),
      "wx",
      0o600
    )
    try {
      await file.writeFile(`${JSON.stringify(report, null, 2)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    await output.sync()
    return report
  } finally {
    source?.close()
    target?.close()
    await output.close()
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timeout = setTimeout(abort, 60 * 60 * 1000)
  process.on("SIGINT", abort)
  process.on("SIGTERM", abort)
  try {
    const report = await main(process.argv.slice(2), {
      signal: controller.signal,
    })
    console.log(report.help ?? JSON.stringify(report))
  } catch {
    console.error(
      JSON.stringify({ passed: false, phase: "railway_recovery_restore" })
    )
    process.exitCode = 1
  } finally {
    clearTimeout(timeout)
    process.off("SIGINT", abort)
    process.off("SIGTERM", abort)
  }
}
