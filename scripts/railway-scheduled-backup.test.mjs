import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { createPostgresClientEnvironment } from "./lib/postgres-logical-backup.mjs"
import {
  RECOVERY_SOURCE_SYSTEM_ID,
  RECOVERY_TARGET,
  validateScheduledSourceScope,
} from "./lib/recovery-policy.mjs"
import { recoveryHash } from "./lib/recovery-vault.mjs"
import { STAGING } from "./lib/staging-release.mjs"
import { verifySourceScope } from "./postgres-isolated-target.mjs"
import {
  runScheduledBackup,
  runScheduledSnapshot,
  readScheduledBackupFile,
  sourceIdentitySql,
  validateScheduledEnvironment,
  verifyScheduledDatabaseIdentity,
} from "./railway-scheduled-backup.mjs"

test("scheduled archive reads use a private pinned file descriptor and bounded size", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rr-backup-file-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "archive")
  await writeFile(path, "private-fixture", { mode: 0o600 })
  assert.equal(
    (await readScheduledBackupFile(path)).toString(),
    "private-fixture"
  )
  await assert.rejects(readScheduledBackupFile(path, AbortSignal.abort()))
  const alias = join(directory, "alias")
  await symlink(path, alias)
  await assert.rejects(readScheduledBackupFile(alias))
  await truncate(path, 128 * 1024 * 1024 + 1)
  await assert.rejects(readScheduledBackupFile(path))
  await truncate(path, 0)
  await assert.rejects(readScheduledBackupFile(path))
})

test("nested snapshot cancellation waits for graceful child cleanup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rr-snapshot-cancel-"))
  const controller = new AbortController()
  t.after(async () => {
    controller.abort()
    await rm(directory, { recursive: true, force: true })
  })
  const ready = join(directory, "ready")
  const cleaned = join(directory, "cleaned")
  const code = `const fs=require('node:fs');process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(process.argv[2],'cleaned');process.exit(0)},50));fs.writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000);`
  const completion = runScheduledSnapshot(
    process.execPath,
    ["-e", code, ready, cleaned],
    { environment: { PATH: process.env.PATH }, signal: controller.signal }
  ).then(
    () => ({ passed: true }),
    () => ({ passed: false })
  )
  for (let attempt = 0; ; attempt++) {
    try {
      await access(ready)
      break
    } catch {
      assert.ok(attempt < 200)
      await delay(10)
    }
  }
  controller.abort()
  assert.equal((await completion).passed, false)
  assert.equal(await readFile(cleaned, "utf8"), "cleaned")
})

const environment = {
  RAILWAY_PROJECT_ID: STAGING.projectId,
  RAILWAY_ENVIRONMENT_ID: STAGING.environmentId,
  RAILWAY_SERVICE_ID: RECOVERY_TARGET.serviceId,
  RAILWAY_DEPLOYMENT_ID: "11111111-1111-4111-8111-111111111111",
  RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
  DATABASE_BACKUP_URL:
    "postgresql://app_backup:private-canary@postgres.railway.internal:5432/railway",
  MEDIA_SOURCE_ENDPOINT: "http://bucket.railway.internal:9000",
  MEDIA_SOURCE_BUCKET: "medusa-media",
  BACKUP_S3_ENDPOINT: "https://archive.example",
  BACKUP_ENCRYPTION_KEY: "b".repeat(64),
  PATH: process.env.PATH,
  HOME: process.env.HOME,
}
const identity = {
  systemId: RECOVERY_SOURCE_SYSTEM_ID,
  database: "railway",
  username: "app_backup",
  major: 16,
  unsafe: false,
  connectionLimit: 3,
  memberships: [
    { name: "pg_read_all_data", admin: false, inherit: true, set: false },
  ],
}
const fixture = () => {
  const client = new EventEmitter()
  const queries = []
  const state = { closed: false, storesClosed: 0 }
  client.end = async () => {
    state.closed = true
    client.emit("end")
  }
  client.query = async (sql) => {
    queries.push(sql)
    return {
      rows: [
        sql === sourceIdentitySql
          ? { identity }
          : { acquired: true, released: true },
      ],
    }
  }
  const objects = new Map()
  const destination = {
    fingerprint:
      "dcd9d375e6bdcc6e039d2153baa37dd000a5c62d9ab5ce3bb1a008d77498b03d",
    async get(key) {
      assert.ok(objects.has(key))
      return objects.get(key)
    },
    async put(key, bytes) {
      objects.set(key, bytes)
    },
    async list() {
      return [...objects].map(([key, bytes]) => ({
        key,
        bytes: bytes.length,
        etag: recoveryHash(bytes),
      }))
    },
    close() {
      state.storesClosed++
    },
  }
  const source = {
    fingerprint: "c".repeat(64),
    async list() {
      return [{ key: "photo.webp", bytes: 3, etag: "one" }]
    },
    async get() {
      return Buffer.from("abc")
    },
    close() {
      state.storesClosed++
    },
  }
  const run = async (_command, args, options) => {
    assert.deepEqual(Object.keys(options.environment).sort(), [
      "DATABASE_BACKUP_URL",
      "DATABASE_RECOVERY_TIMEOUT_MS",
      "HOME",
      "PATH",
    ])
    state.directory = args.at(-1)
    const bundle = join(state.directory, "fixture")
    await mkdir(bundle, { mode: 0o700 })
    const body = Buffer.from("database")
    const fingerprint = createPostgresClientEnvironment(
      environment.DATABASE_BACKUP_URL,
      "DATABASE_BACKUP_URL"
    ).fingerprint
    const manifest = {
      schemaVersion: 1,
      bytes: body.length,
      createdAt: new Date().toISOString(),
      format: "postgres-custom",
      pgDumpVersion: "pg_dump (PostgreSQL) 16.15",
      sha256: recoveryHash(body),
      sourceFingerprint: fingerprint,
    }
    const receipt = {
      schemaVersion: 1,
      archiveSha256: manifest.sha256,
      sourceFingerprint: fingerprint,
      invariants: {
        serverMajor: 16,
        counts: {
          constraints: 1,
          indexes: 1,
          routines: 0,
          sequences: 0,
          tables: 1,
          views: 0,
        },
        tableRows: [{ schema: "public", table: "items", rows: 3 }],
      },
    }
    state.paths = {
      archivePath: join(bundle, "database.dump"),
      manifestPath: join(bundle, "database.manifest.json"),
      receiptPath: join(bundle, "database.restore-receipt.json"),
    }
    for (const [path, bytes] of [
      [state.paths.archivePath, body],
      [state.paths.manifestPath, JSON.stringify(manifest)],
      [state.paths.receiptPath, JSON.stringify(receipt)],
    ])
      await writeFile(path, bytes, { mode: 0o600 })
    return JSON.stringify({
      status: "snapshot_bundle_verified",
      sourceMajor: 16,
      ...state.paths,
    })
  }
  return {
    client,
    queries,
    state,
    source,
    destination,
    options: {
      connect: async () => client,
      run,
      store: (config) =>
        config.endpoint === environment.MEDIA_SOURCE_ENDPOINT
          ? source
          : destination,
    },
  }
}

test("scheduled backup rejects the wrong environment, role, endpoint and key before connecting", async () => {
  for (const name of [
    "RAILWAY_PROJECT_ID",
    "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_SERVICE_ID",
    "RAILWAY_DEPLOYMENT_ID",
    "RAILWAY_GIT_COMMIT_SHA",
    "DATABASE_BACKUP_URL",
    "MEDIA_SOURCE_ENDPOINT",
    "MEDIA_SOURCE_BUCKET",
    "BACKUP_ENCRYPTION_KEY",
  ])
    assert.throws(() =>
      validateScheduledEnvironment({ ...environment, [name]: "invalid" })
    )
  for (const [name, value] of [
    ["systemId", "1"],
    ["username", "postgres"],
    ["unsafe", true],
    ["connectionLimit", -1],
    ["memberships", []],
  ])
    assert.throws(() =>
      verifyScheduledDatabaseIdentity({ ...identity, [name]: value })
    )
})

test("job produces a restorable source receipt and releases migration lock before upload", async () => {
  const f = fixture()
  const create = f.options.store
  f.options.store = (config) => {
    assert.ok(f.queries.some((q) => q.includes("unlock_shared")))
    return create(config)
  }
  const get = f.source.get
  f.source.get = async (...args) => {
    const paths = {
      ...f.state.paths,
      sourceScopePath: join(
        f.state.directory,
        "fixture/source-scope.receipt.json"
      ),
    }
    const verified = await verifySourceScope(paths)
    assert.equal(verified.scope.producer.serviceId, RECOVERY_TARGET.serviceId)
    const scope = JSON.parse(await readFile(paths.sourceScopePath, "utf8"))
    for (const mutate of [
      (s) => {
        s.producer.serviceId = STAGING.projectId
      },
      (s) => {
        s.sourceSystemId = "1"
      },
      (s) => {
        s.source.volumeId = STAGING.projectId
      },
      (s) => {
        s.producer.revision = "bad"
      },
      (s) => {
        s.connectionTransport = "public"
      },
      (s) => {
        s.password = "private-canary"
      },
    ]) {
      const changed = structuredClone(scope)
      mutate(changed)
      assert.throws(() => validateScheduledSourceScope(changed))
    }
    return get(...args)
  }
  const report = await runScheduledBackup(environment, f.options)
  assert.equal(report.passed, true)
  assert.equal(report.schemaVersion, 2)
  assert.equal(report.objects, 5)
  assert.equal(report.retention.removedSnapshots, 0)
  assert.equal(f.state.closed, true)
  assert.equal(f.state.storesClosed, 2)
  await assert.rejects(access(f.state.directory))
  assert.ok(!JSON.stringify(report).includes("private-canary"))
})

test("locks, disconnects, cancellation, changed source and cleanup fail safely", async () => {
  for (const kind of [
    "identity",
    "lock",
    "migration",
    "snapshot",
    "disconnect",
    "cancel",
    "inventory",
    "cleanup",
    "destination",
    "upload",
  ]) {
    const f = fixture()
    const query = f.client.query
    f.client.query = async (sql) => {
      if (kind === "identity" && sql === sourceIdentitySql)
        return { rows: [{ identity: { ...identity, unsafe: true } }] }
      if (
        (kind === "lock" && sql.includes("1317")) ||
        (kind === "migration" && sql.includes("lock_shared"))
      )
        return { rows: [{ acquired: false }] }
      return query(sql)
    }
    const run = f.options.run
    f.options.run = async (...args) => {
      if (kind === "snapshot") throw new Error("private-canary")
      const result = await run(...args)
      if (kind === "disconnect")
        f.client.emit("error", new Error("private-canary"))
      return result
    }
    if (kind === "cancel") f.options.signal = AbortSignal.abort()
    if (kind === "cleanup")
      f.client.end = async () => {
        throw new Error("private-canary")
      }
    if (kind === "destination") f.destination.fingerprint = "d".repeat(64)
    if (kind === "upload")
      f.destination.put = async () => {
        throw new Error("private-canary")
      }
    if (kind === "inventory") {
      let calls = 0
      const list = f.source.list
      f.source.list = async () => (++calls === 1 ? list() : [])
    }
    const report = await runScheduledBackup(environment, f.options)
    assert.equal(report.passed, false, kind)
    assert.ok(!JSON.stringify(report).includes("private-canary"))
    if (f.state.directory) await assert.rejects(access(f.state.directory))
    if (kind !== "cleanup") assert.equal(f.state.closed, true)
  }
})
