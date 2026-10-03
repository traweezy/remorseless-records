import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createPostgresClientEnvironment } from "./lib/postgres-logical-backup.mjs"
import {
  openRegularFile,
  readBackupManifest,
  readRestoreReceipt,
} from "./lib/postgres-restore.mjs"
import {
  RECOVERY_SOURCE_SYSTEM_ID,
  RECOVERY_TARGET,
  scheduledSourceIdentity,
  validateScheduledSourceScope,
} from "./lib/recovery-policy.mjs"
import { createRecoveryStore } from "./lib/recovery-s3.mjs"
import { pruneRecoverySnapshots } from "./lib/recovery-retention.mjs"
import {
  parseRecoveryKey,
  recoveryHash,
  writeRecoverySnapshot,
} from "./lib/recovery-vault.mjs"
import { STAGING } from "./lib/staging-release.mjs"
import { runPrivateCommand } from "./postgres-staging-snapshot.mjs"

const require = createRequire(
  new URL("../operations/package.json", import.meta.url)
)
const { Client } = require("pg")
const snapshotScript = fileURLToPath(
  new URL("./postgres-snapshot-backup.mjs", import.meta.url)
)
const destinationFingerprint =
  "dcd9d375e6bdcc6e039d2153baa37dd000a5c62d9ab5ce3bb1a008d77498b03d"

export const validateScheduledEnvironment = (environment) => {
  assert.equal(environment.RAILWAY_PROJECT_ID, STAGING.projectId)
  assert.equal(environment.RAILWAY_ENVIRONMENT_ID, STAGING.environmentId)
  assert.equal(environment.RAILWAY_SERVICE_ID, RECOVERY_TARGET.serviceId)
  assert.match(
    environment.RAILWAY_DEPLOYMENT_ID,
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
  )
  assert.match(environment.RAILWAY_GIT_COMMIT_SHA, /^[a-f0-9]{40}$/u)
  const connection = createPostgresClientEnvironment(
    environment.DATABASE_BACKUP_URL,
    "DATABASE_BACKUP_URL"
  )
  const url = new URL(environment.DATABASE_BACKUP_URL)
  assert.equal(url.hostname, "postgres.railway.internal")
  assert.equal(url.port, "5432")
  assert.equal(url.pathname, "/railway")
  assert.equal(decodeURIComponent(url.username), "app_backup")
  assert.equal(
    environment.MEDIA_SOURCE_ENDPOINT,
    "http://bucket.railway.internal:9000"
  )
  assert.equal(environment.MEDIA_SOURCE_BUCKET, "medusa-media")
  const key = parseRecoveryKey(environment.BACKUP_ENCRYPTION_KEY)
  return { connection, key }
}

export const sourceIdentitySql = `SELECT json_build_object(
  'systemId', (SELECT system_identifier::text FROM pg_control_system()),
  'database', current_database(), 'username', current_user,
  'major', current_setting('server_version_num')::integer / 10000,
  'unsafe', rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls,
  'connectionLimit', rolconnlimit,
  'memberships', (SELECT coalesce(json_agg(json_build_object('name', g.rolname,
    'admin', m.admin_option, 'inherit', m.inherit_option, 'set', m.set_option)
    ORDER BY g.rolname), '[]'::json) FROM pg_auth_members m
    JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid)
) AS identity FROM pg_roles r WHERE rolname=current_user`

export const verifyScheduledDatabaseIdentity = (value) => {
  assert.deepEqual(value, {
    systemId: RECOVERY_SOURCE_SYSTEM_ID,
    database: "railway",
    username: "app_backup",
    major: 16,
    unsafe: false,
    connectionLimit: 3,
    memberships: [
      { name: "pg_read_all_data", admin: false, inherit: true, set: false },
    ],
  })
}

// The nested snapshot process owns pg_dump, psql and the snapshot exporter.
// Let its signal handler reap those clients before removing the private bundle.
export const runScheduledSnapshot = (command, args, options) =>
  runPrivateCommand(command, args, {
    ...options,
    timeoutMs: 600_000,
    maxOutputBytes: 64 * 1024,
    graceful: true,
  })

export const readScheduledBackupFile = async (path, signal) => {
  const file = await openRegularFile(path)
  try {
    const before = await file.stat({ bigint: true })
    assert.ok(before.size > 0n && before.size <= 128n * 1024n * 1024n)
    const bytes = Buffer.alloc(Number(before.size) + 1)
    let offset = 0
    while (offset < bytes.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset
      )
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true })
    assert.equal(offset, Number(before.size))
    for (const name of ["dev", "ino", "size", "mtimeNs", "ctimeNs"])
      assert.equal(after[name], before[name])
    signal?.throwIfAborted()
    return bytes.subarray(0, offset)
  } finally {
    await file.close()
  }
}

export const runScheduledBackup = async (
  environment = process.env,
  {
    signal,
    connect,
    run = runScheduledSnapshot,
    store = createRecoveryStore,
  } = {}
) => {
  const { connection, key } = validateScheduledEnvironment(environment)
  const databaseFailure = new AbortController()
  signal = signal
    ? AbortSignal.any([signal, databaseFailure.signal])
    : databaseFailure.signal
  let closing = false
  let client
  let directory
  let source
  let destination
  let phase = "database_identity"
  let result
  try {
    client = connect
      ? await connect()
      : new Client({
          connectionString: environment.DATABASE_BACKUP_URL,
          connectionTimeoutMillis: 10_000,
          query_timeout: 10_000,
          statement_timeout: 10_000,
          options: "-c default_transaction_read_only=on",
        })
    if (!connect) await client.connect()
    client.on?.("error", () => databaseFailure.abort())
    client.on?.("end", () => {
      if (!closing) databaseFailure.abort()
    })
    const identity = async () => {
      signal?.throwIfAborted()
      const response = await client.query(sourceIdentitySql)
      assert.equal(response.rows.length, 1)
      verifyScheduledDatabaseIdentity(response.rows[0].identity)
    }
    await identity()
    phase = "backup_lock"
    // Separate lock serializes manual/cron runs. The shared migration lock
    // prevents the release job from changing schema during the exported snapshot.
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(1835361377,1919251317) AS acquired"
    )
    assert.equal(lock.rows[0].acquired, true)
    const migration = await client.query(
      "SELECT pg_try_advisory_lock_shared(1835361377,1919251315) AS acquired"
    )
    assert.equal(migration.rows[0].acquired, true)
    directory = await mkdtemp(join(tmpdir(), "rr-scheduled-backup-"))
    phase = "snapshot"
    const snapshot = JSON.parse(
      await run(process.execPath, [snapshotScript, "--output-dir", directory], {
        environment: {
          PATH: environment.PATH,
          HOME: environment.HOME,
          DATABASE_BACKUP_URL: environment.DATABASE_BACKUP_URL,
          DATABASE_RECOVERY_TIMEOUT_MS: "600000",
        },
        signal,
      })
    )
    signal?.throwIfAborted()
    assert.equal(snapshot.status, "snapshot_bundle_verified")
    assert.equal(snapshot.sourceMajor, 16)
    const bundle = dirname(snapshot.archivePath)
    assert.equal(dirname(bundle), directory)
    for (const path of [
      snapshot.archivePath,
      snapshot.manifestPath,
      snapshot.receiptPath,
    ])
      assert.equal(dirname(path), bundle)
    const manifest = await readBackupManifest(snapshot.manifestPath, signal)
    const receipt = await readRestoreReceipt(snapshot.receiptPath, signal)
    assert.equal(manifest.sourceFingerprint, connection.fingerprint)
    assert.equal(receipt.sourceFingerprint, connection.fingerprint)
    assert.equal(manifest.sha256, receipt.archiveSha256)
    await identity()
    const scope = {
      schemaVersion: 2,
      source: scheduledSourceIdentity,
      producer: {
        projectId: environment.RAILWAY_PROJECT_ID,
        environmentId: environment.RAILWAY_ENVIRONMENT_ID,
        serviceId: environment.RAILWAY_SERVICE_ID,
        deploymentId: environment.RAILWAY_DEPLOYMENT_ID,
        revision: environment.RAILWAY_GIT_COMMIT_SHA,
      },
      sourceSystemId: RECOVERY_SOURCE_SYSTEM_ID,
      sourceMajor: 16,
      capturedAt: new Date().toISOString(),
      originalEndpointFingerprint: connection.fingerprint,
      mappedEndpointFingerprint: connection.fingerprint,
      archiveSha256: manifest.sha256,
      manifestSha256: recoveryHash(
        await readScheduledBackupFile(snapshot.manifestPath, signal)
      ),
      restoreReceiptSha256: recoveryHash(
        await readScheduledBackupFile(snapshot.receiptPath, signal)
      ),
      connectionTransport: "railway_private",
    }
    validateScheduledSourceScope(scope)
    const scopePath = join(bundle, "source-scope.receipt.json")
    await writeFile(scopePath, JSON.stringify(scope), {
      mode: 0o600,
      flag: "wx",
    })
    assert.equal(
      (
        await client.query(
          "SELECT pg_advisory_unlock_shared(1835361377,1919251315) AS released"
        )
      ).rows[0].released,
      true
    )
    phase = "media_inventory"
    source = store({
      endpoint: environment.MEDIA_SOURCE_ENDPOINT,
      bucket: environment.MEDIA_SOURCE_BUCKET,
      region: "us-east-1",
      accessKeyId: environment.MEDIA_SOURCE_ACCESS_KEY,
      secretAccessKey: environment.MEDIA_SOURCE_SECRET_KEY,
    })
    destination = store({
      endpoint: environment.BACKUP_S3_ENDPOINT,
      bucket: environment.BACKUP_S3_BUCKET,
      region: "auto",
      accessKeyId: environment.BACKUP_S3_ACCESS_KEY,
      secretAccessKey: environment.BACKUP_S3_SECRET_KEY,
      forcePathStyle: false,
    })
    assert.equal(destination.fingerprint, destinationFingerprint)
    const inventory = await source.list(signal)
    assert.ok(inventory.length > 0)
    const sources = []
    for (const path of [
      snapshot.archivePath,
      snapshot.manifestPath,
      snapshot.receiptPath,
      scopePath,
    ]) {
      const bytes = await readScheduledBackupFile(path, signal)
      if (path === snapshot.archivePath)
        assert.equal(recoveryHash(bytes), manifest.sha256)
      sources.push({
        kind: "database",
        name: basename(path),
        bytes: bytes.length,
        read: async () => bytes,
      })
    }
    sources.push(
      ...inventory.map((item) => ({
        kind: "media",
        name: item.key,
        bytes: item.bytes,
        read: (abort) => source.get(item.key, item.bytes, abort),
      }))
    )
    phase = "encrypted_upload"
    const report = await writeRecoverySnapshot({
      sources,
      destination,
      key,
      sourceFingerprint: recoveryHash(
        Buffer.from(
          `${connection.fingerprint}:${manifest.sha256}:${source.fingerprint}`
        )
      ),
      targetFingerprint: destination.fingerprint,
      signal,
      validateSource: async (abort) => {
        assert.deepEqual(await source.list(abort), inventory)
        await identity()
      },
    })
    result = {
      event: "recovery.backup.completed",
      passed: true,
      revision: environment.RAILWAY_GIT_COMMIT_SHA,
      deploymentId: environment.RAILWAY_DEPLOYMENT_ID,
      ...report,
    }
    phase = "retention"
    result.retention = await pruneRecoverySnapshots({
      destination,
      key,
      targetFingerprint: destination.fingerprint,
      currentId: report.id,
      signal,
    })
  } catch {
    result = {
      ...result,
      event: "recovery.backup.failed",
      passed: false,
      phase,
    }
  } finally {
    source?.close()
    destination?.close()
    try {
      closing = true
      const cleanup = await Promise.allSettled([
        client?.end(),
        directory ? rm(directory, { recursive: true }) : undefined,
      ])
      assert.ok(cleanup.every((entry) => entry.status === "fulfilled"))
    } catch {
      result = {
        event: "recovery.backup.failed",
        passed: false,
        phase: "cleanup",
      }
    }
  }
  return result
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, 30 * 60 * 1000)
  process.on("SIGINT", abort)
  process.on("SIGTERM", abort)
  try {
    assert.equal(process.argv.length, 2)
    const result = await runScheduledBackup(process.env, {
      signal: controller.signal,
    })
    console.log(JSON.stringify(result))
    if (!result.passed) process.exitCode = 1
  } catch {
    console.error(
      JSON.stringify({
        event: "recovery.backup.failed",
        passed: false,
        phase: "runtime_scope",
      })
    )
    process.exitCode = 1
  } finally {
    clearTimeout(timer)
    process.off("SIGINT", abort)
    process.off("SIGTERM", abort)
  }
}
