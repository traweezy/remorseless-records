import assert from "node:assert/strict"
import { open, readFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import { RECOVERY_TARGET } from "./lib/recovery-policy.mjs"
import { openPrivateOutputDirectory } from "./lib/postgres-snapshot.mjs"
import { createRecoveryStore } from "./lib/recovery-s3.mjs"
import { BACKUP_TARGETS } from "./lib/staging-backups.mjs"
import {
  parseRecoveryKey,
  recoveryHash,
  writeRecoverySnapshot,
} from "./lib/recovery-vault.mjs"
import { STAGING } from "./lib/staging-release.mjs"
import { verifySourceScope } from "./postgres-isolated-target.mjs"
import { verifiedStagingRailwayReader } from "./staging-release-readiness.mjs"

export { RECOVERY_TARGET }
const help = `Usage: railway-recovery-backup --bundle <private-snapshot-dir>
  --output-dir <private-evidence-dir> [--apply --confirm <dry-run-hash>]
Defaults to a read-only inventory. Apply encrypts a verified PostgreSQL snapshot
and current media into a unique prefix in the pinned staging Railway bucket,
reads every ciphertext back and publishes a bound receipt. The key stays in
RecoveryBackups. This is same-provider current-state recovery, not object
version history or an independent-provider backup. No retained data is deleted.
`
export const parseBackupArguments = (input) => {
  const args = normalizeScriptArguments(input)
  if (args.length === 1 && args[0] === "--help") return { help }
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const name = args[index]
    assert.ok(
      ["--bundle", "--output-dir", "--apply", "--confirm"].includes(name)
    )
    assert.ok(!Object.hasOwn(options, name))
    options[name] = name === "--apply" ? true : args[++index]
    if (name !== "--apply") assert.equal(typeof options[name], "string")
  }
  for (const name of ["--bundle", "--output-dir"]) {
    assert.equal(typeof options[name], "string")
    assert.equal(resolve(options[name]), options[name])
  }
  if (options["--apply"]) assert.match(options["--confirm"], /^[a-f0-9]{64}$/u)
  else assert.ok(!Object.hasOwn(options, "--confirm"))
  return options
}

export const openRailwayRecoveryStore = async (railway) => {
  const services = await railway([
    "service",
    "list",
    "--project",
    STAGING.projectId,
    "--environment",
    STAGING.environmentId,
    "--json",
  ])
  assert.equal(
    services.filter(
      (s) =>
        s.id === RECOVERY_TARGET.serviceId &&
        s.name === RECOVERY_TARGET.serviceName
    ).length,
    1
  )
  const info = await railway([
    "bucket",
    "info",
    "--bucket",
    RECOVERY_TARGET.bucketId,
    "--environment",
    STAGING.environmentId,
    "--json",
  ])
  assert.equal(info.id, RECOVERY_TARGET.bucketId)
  assert.equal(info.name, RECOVERY_TARGET.bucketName)
  assert.equal(info.environmentId, STAGING.environmentId)
  assert.equal(info.region, "iad")
  const credentials = await railway([
    "bucket",
    "credentials",
    "--bucket",
    RECOVERY_TARGET.bucketId,
    "--environment",
    STAGING.environmentId,
    "--json",
  ])
  const endpoint = new URL(credentials.endpoint)
  assert.equal(endpoint.protocol, "https:")
  assert.equal(endpoint.hostname, "t3.storageapi.dev")
  const variables = await railway([
    "variable",
    "list",
    "--project",
    STAGING.projectId,
    "--environment",
    STAGING.environmentId,
    "--service",
    RECOVERY_TARGET.serviceId,
    "--json",
  ])
  const key = parseRecoveryKey(variables.BACKUP_ENCRYPTION_KEY)
  return {
    key,
    store: createRecoveryStore({
      ...credentials,
      bucket: credentials.bucketName,
      forcePathStyle: credentials.urlStyle === "path",
    }),
  }
}

const pathsFromBundle = (bundle) => ({
  archivePath: join(bundle, "database.dump"),
  manifestPath: join(bundle, "database.manifest.json"),
  receiptPath: join(bundle, "database.restore-receipt.json"),
  sourceScopePath: join(bundle, "source-scope.receipt.json"),
})

export const main = async (args, { signal, capture } = {}) => {
  const options = parseBackupArguments(args)
  if (options.help) return options
  const output = await openPrivateOutputDirectory(options["--output-dir"])
  let source
  let destination
  try {
    const paths = pathsFromBundle(options["--bundle"])
    const initial = await verifySourceScope(paths)
    assert.equal(initial.scope.source.projectId, STAGING.projectId)
    assert.equal(initial.scope.source.environmentId, STAGING.environmentId)
    assert.equal(initial.scope.source.serviceId, BACKUP_TARGETS[0].serviceId)
    assert.equal(initial.scope.source.volumeId, BACKUP_TARGETS[0].volumeId)
    assert.equal(initial.scope.sourceSystemId, "7527124368992473123")
    assert.ok(Date.now() - Date.parse(initial.scope.capturedAt) <= 86_400_000)
    assert.ok(Date.parse(initial.scope.capturedAt) <= Date.now() + 60_000)
    const railway = await verifiedStagingRailwayReader(capture)
    const backend = await railway([
      "variable",
      "list",
      "--project",
      STAGING.projectId,
      "--environment",
      STAGING.environmentId,
      "--service",
      STAGING.services.find((s) => s.alias === "backend").id,
      "--json",
    ])
    const bucket = await railway([
      "variable",
      "list",
      "--project",
      STAGING.projectId,
      "--environment",
      STAGING.environmentId,
      "--service",
      RECOVERY_TARGET.mediaServiceId,
      "--json",
    ])
    const raw = bucket.MINIO_PUBLIC_ENDPOINT
    const endpoint = new URL(raw.includes("://") ? raw : `https://${raw}`)
    assert.equal(endpoint.protocol, "https:")
    // Use the scoped Bucket's public transport with the existing application's
    // S3 identity; never accept an arbitrary command-line storage destination.
    source = createRecoveryStore({
      endpoint: endpoint.origin,
      bucket: backend.MINIO_BUCKET || "medusa-media",
      region: backend.MINIO_REGION || "us-east-1",
      accessKeyId: backend.MINIO_ACCESS_KEY,
      secretAccessKey: backend.MINIO_SECRET_KEY,
    })
    const vault = await openRailwayRecoveryStore(railway)
    destination = vault.store
    assert.notEqual(source.fingerprint, destination.fingerprint)
    const inventory = await source.list(signal)
    assert.ok(inventory.length > 0)
    const sources = []
    for (const path of Object.values(paths)) {
      const bytes = await readFile(path)
      assert.ok(bytes.length <= 128 * 1024 * 1024)
      sources.push({
        kind: "database",
        name: basename(path),
        bytes: bytes.length,
        read: async () => bytes,
      })
    }
    // Revalidate every source artifact after materializing the private files.
    assert.deepEqual(await verifySourceScope(paths), initial)
    sources.push(
      ...inventory.map((object) => ({
        kind: "media",
        name: object.key,
        bytes: object.bytes,
        read: (abort) => source.get(object.key, object.bytes, abort),
      }))
    )
    const sourceFingerprint = recoveryHash(
      Buffer.from(
        `${initial.scope.originalEndpointFingerprint}:${initial.scope.archiveSha256}:${source.fingerprint}`
      )
    )
    const confirmation = recoveryHash(
      Buffer.from(
        JSON.stringify({
          archive: initial.scope.archiveSha256,
          inventory,
          sourceFingerprint,
          destination: destination.fingerprint,
        })
      )
    )
    const totalBytes = sources.reduce((sum, item) => sum + item.bytes, 0)
    assert.ok(totalBytes <= 1024 * 1024 * 1024)
    if (!options["--apply"])
      return {
        readOnly: true,
        passed: true,
        confirmation,
        databaseObjects: 4,
        mediaObjects: inventory.length,
        plainBytes: totalBytes,
        maximumContentTransferBytes: totalBytes * 3 + sources.length * 72,
        encryption: "AES-256-GCM",
        recoveryScope: "railway_encrypted_current_state",
      }
    assert.equal(options["--confirm"], confirmation)
    const report = await writeRecoverySnapshot({
      sources,
      destination,
      key: vault.key,
      sourceFingerprint,
      targetFingerprint: destination.fingerprint,
      signal,
      validateSource: async (abort) => {
        assert.deepEqual(await source.list(abort), inventory)
        assert.deepEqual(await verifySourceScope(paths), initial)
      },
    })
    await output.assertStable()
    signal?.throwIfAborted()
    const name = `railway-recovery-${report.id}.json`
    const file = await open(join(output.descriptorPath, name), "wx", 0o600)
    try {
      await file.writeFile(`${JSON.stringify(report, null, 2)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    await output.sync()
    await output.assertStable()
    return {
      passed: true,
      ...report,
      localReceipt: join(options["--output-dir"], name),
    }
  } finally {
    source?.close()
    destination?.close()
    await output.close()
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timeout = setTimeout(abort, 30 * 60 * 1000)
  process.on("SIGINT", abort)
  process.on("SIGTERM", abort)
  try {
    const result = await main(process.argv.slice(2), {
      signal: controller.signal,
    })
    console.log(result.help ?? JSON.stringify(result))
  } catch {
    console.error(
      JSON.stringify({ passed: false, phase: "railway_recovery_backup" })
    )
    process.exitCode = 1
  } finally {
    clearTimeout(timeout)
    process.off("SIGINT", abort)
    process.off("SIGTERM", abort)
  }
}
