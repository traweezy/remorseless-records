import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { createPostgresClientEnvironment } from "./lib/postgres-logical-backup.mjs"
import {
  RESTORE_TARGET_INVENTORY_SQL,
  snapshotBackupArchive,
} from "./lib/postgres-restore.mjs"

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid")
const expectedVersion = process.env.POSTGRES_RECOVERY_TEST_VERSION ?? "18.6"
if (!["16.15", "18.6"].includes(expectedVersion))
  throw new Error("Unsupported disposable PostgreSQL recovery test version.")
if (
  process.env.INTEGRATION_TESTS_ENABLED !== "1" ||
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.username !== "postgres" ||
  url.password !== "local_integration_only" ||
  url.pathname !== "/postgres" ||
  url.search ||
  url.hash
)
  throw new Error(
    "Recovery roundtrip requires the disposable local PostgreSQL fixture."
  )

const require = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const { Client } = require("pg")
const scripts = dirname(fileURLToPath(import.meta.url))
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const connect = async (connectionString) => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  })
  await client.connect()
  return client
}
const inventory = async (client) =>
  (await client.query(RESTORE_TARGET_INVENTORY_SQL)).rows[0].json_build_object
const empty = async (client) =>
  assert.deepEqual(await inventory(client), { objects: 0, tables: 0 })

const start = (command, args, env) => {
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  let error
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000)
  child.on("error", (value) => {
    error = value
  })
  child.stdout.on("data", (chunk) => {
    stdout += chunk
    if (stdout.length > 65_536) child.kill("SIGKILL")
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
    if (stderr.length > 65_536) child.kill("SIGKILL")
  })
  const completed = new Promise((resolve, reject) =>
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      if (error || signal)
        reject(error ?? new Error(`Client terminated: ${signal}`))
      else resolve({ code, stdout, stderr })
    })
  )
  return { child, completed }
}

const waitUntil = async (predicate) => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(25)
  }
  assert.fail("Disposable recovery condition exceeded five seconds.")
}

test(`real PostgreSQL ${expectedVersion} backup, restore, rejection, rollback and cancellation`, {
  timeout: 90_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rr-postgres-roundtrip-"))
  const created = []
  const clients = []
  let administrator
  try {
    for (const tool of ["pg_dump", "pg_restore", "psql"]) {
      const result = await start(tool, ["--version"], {
        PATH: process.env.PATH,
        LANG: "C",
      }).completed
      assert.equal(result.code, 0)
      assert.match(
        result.stdout.trim(),
        new RegExp(
          `^${tool} \\(PostgreSQL\\) ${expectedVersion.replace(".", "\\.")}(?: \\(Ubuntu ${expectedVersion.replace(".", "\\.")}-1\\.pgdg24\\.04\\+2\\))?$`,
          "u"
        )
      )
    }
    administrator = await connect(url.toString())
    assert.equal(
      (await administrator.query("SHOW server_version_num")).rows[0]
        .server_version_num,
      `${Number(expectedVersion.split(".")[0]) * 10000 + Number(expectedVersion.split(".")[1])}`
    )
    const database = async () => {
      const name = `rr_roundtrip_${randomUUID().replaceAll("-", "")}`
      // Names are generated here, never accepted from external SQL input.
      assert.match(name, /^rr_roundtrip_[a-f0-9]{32}$/u)
      await administrator.query(`CREATE DATABASE ${name} TEMPLATE template0`)
      created.push(name)
      const connection = new URL(url)
      connection.pathname = `/${name}`
      const client = await connect(connection.toString())
      clients.push(client)
      return {
        name,
        url: connection.toString(),
        client,
        fingerprint: createPostgresClientEnvironment(
          connection.toString(),
          "fixture"
        ).fingerprint,
      }
    }
    const source = await database()
    const target = await database()
    const scratch = join(directory, "scratch")
    await mkdir(scratch, { mode: 0o700 })
    const environment = {
      PATH: process.env.PATH,
      LANG: "C",
      TMPDIR: scratch,
      DATABASE_RECOVERY_TIMEOUT_MS: "10000",
      DATABASE_BACKUP_URL: source.url,
      DATABASE_RESTORE_URL: target.url,
      DATABASE_RESTORE_CONFIRM: target.fingerprint,
    }
    const invoke = async (kind, args, overrides = {}, phase) => {
      const result = await start(
        process.execPath,
        [join(scripts, `postgres-${kind}.mjs`), ...args],
        { ...environment, ...overrides }
      ).completed
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /local_integration_only|postgresql:\/\//u
      )
      assert.deepEqual(
        await readdir(scratch),
        [],
        "Private archive snapshots must be removed before CLI completion"
      )
      if (phase) {
        assert.equal(result.code, 1, result.stdout)
        assert.equal(result.stdout, "")
        const error = JSON.parse(result.stderr)
        assert.deepEqual(Object.keys(error).sort(), [
          "durationMs",
          "phase",
          "status",
        ])
        assert.equal(error.status, "failed")
        assert.equal(error.phase, phase)
        return error
      }
      assert.equal(result.code, 0, result.stderr)
      assert.equal(result.stderr, "")
      return JSON.parse(result.stdout)
    }
    const backup = (output, overrides) =>
      invoke("logical-backup", ["--output-dir", output], overrides)
    const captureReceipt = async (archive, overrides = {}) => {
      const receiptPath = join(
        dirname(archive.manifestPath),
        "restore.receipt.json"
      )
      const evidence = await invoke(
        "restore-receipt",
        ["--manifest", archive.manifestPath, "--output", receiptPath],
        overrides
      )
      assert.equal(evidence.status, "receipt_captured")
      assert.equal((await stat(receiptPath)).mode & 0o777, 0o600)
      return { ...archive, receiptPath }
    }
    const restore = (archive, extra = [], overrides = {}, phase) =>
      invoke(
        "restore-drill",
        [
          "--archive",
          archive.archivePath,
          "--manifest",
          archive.manifestPath,
          ...(archive.receiptPath ? ["--receipt", archive.receiptPath] : []),
          ...extra,
        ],
        overrides,
        phase
      )
    await source.client.query(`
      CREATE SCHEMA app;
      CREATE TABLE app.artists (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL UNIQUE);
      CREATE TABLE app.releases (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        artist_id integer NOT NULL REFERENCES app.artists(id),
        sku text NOT NULL UNIQUE, amount numeric(12,2) NOT NULL CHECK (amount >= 0),
        metadata jsonb NOT NULL, released_at timestamptz NOT NULL, note text,
        audio bytea NOT NULL
      );
      CREATE VIEW app.release_totals AS SELECT artist_id, sum(amount) AS amount FROM app.releases GROUP BY artist_id;
      CREATE FUNCTION app.release_count() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM app.releases';
    `)
    await source.client.query("INSERT INTO app.artists(name) VALUES ($1)", [
      "Synthetic artist — 音楽",
    ])
    await source.client.query(
      "INSERT INTO app.releases(artist_id,sku,amount,metadata,released_at,note,audio) VALUES (1,$1,$2,$3,$4,$5,$6), (1,$7,$8,$9,$10,$11,$12)",
      [
        "fixture-a",
        "1234.56",
        { tags: ["synthetic", "é"], nested: { flag: true } },
        "2026-09-14T12:34:56.789Z",
        null,
        Buffer.from([0, 1, 255]),
        "fixture-b",
        "0.01",
        { text: 'quote" and newline\n' },
        "2026-01-01T00:00:00Z",
        "",
        Buffer.alloc(0),
      ]
    )
    const rows = (client) =>
      client
        .query(
          "SELECT r.*, a.name FROM app.releases r JOIN app.artists a ON a.id=r.artist_id ORDER BY r.id"
        )
        .then((result) => result.rows)
    const originalRows = await rows(source.client)
    let archive
    await t.test(
      "publishes a real custom archive with independent hash and private manifest",
      async () => {
        const output = join(directory, "backups")
        archive = await backup(output)
        assert.equal(archive.status, "verified")
        assert.equal((await stat(output)).mode & 0o777, 0o700)
        assert.equal((await readdir(output)).length, 2)
        for (const path of [archive.archivePath, archive.manifestPath])
          assert.equal((await stat(path)).mode & 0o777, 0o600)
        const bytes = await readFile(archive.archivePath)
        assert.equal(bytes.subarray(0, 5).toString(), "PGDMP")
        assert.equal(archive.bytes, bytes.length)
        assert.equal(archive.sha256, hash(bytes))
        const manifest = JSON.parse(
          await readFile(archive.manifestPath, "utf8")
        )
        assert.deepEqual(Object.keys(manifest).sort(), [
          "bytes",
          "createdAt",
          "format",
          "pgDumpVersion",
          "schemaVersion",
          "sha256",
          "sourceFingerprint",
        ])
        assert.equal(manifest.schemaVersion, 1)
        assert.equal(manifest.format, "postgres-custom")
        assert.equal(manifest.sha256, archive.sha256)
        assert.equal(manifest.bytes, archive.bytes)
        assert.equal(manifest.sourceFingerprint, source.fingerprint)
        assert.match(
          manifest.pgDumpVersion,
          new RegExp(
            `^pg_dump \\(PostgreSQL\\) ${expectedVersion.replace(".", "\\.")}`,
            "u"
          )
        )
      }
    )
    assert.ok(archive)
    archive = await captureReceipt(archive)
    const captured = JSON.parse(await readFile(archive.receiptPath, "utf8"))
    assert.equal(captured.archiveSha256, archive.sha256)
    assert.equal(
      captured.invariants.serverMajor,
      Number(expectedVersion.split(".")[0])
    )
    assert.deepEqual(captured.invariants.tableRows, [
      { schema: "app", table: "artists", rows: 1 },
      { schema: "app", table: "releases", rows: 2 },
    ])
    await t.test(
      "dry-run provides target confirmation and leaves every target object absent",
      async () => {
        const result = await restore(archive)
        assert.equal(result.status, "dry_run_verified")
        assert.equal(result.confirmation, target.fingerprint)
        assert.equal(result.sourceChecksum, archive.sha256)
        await empty(target.client)
      }
    )
    await t.test(
      "refuses wrong confirmation, source target, and archive snapshot byte budget",
      async () => {
        await restore(
          archive,
          ["--apply"],
          { DATABASE_RESTORE_CONFIRM: "wrong" },
          "arguments"
        )
        await restore(
          archive,
          [],
          { DATABASE_RESTORE_URL: source.url },
          "archive_verification"
        )
        await restore(
          archive,
          ["--apply"],
          { DATABASE_RESTORE_MAX_ARCHIVE_BYTES: String(archive.bytes - 1) },
          "archive_verification"
        )
        await empty(target.client)
        assert.deepEqual(await rows(source.client), originalRows)
      }
    )
    await t.test(
      "rejects altered and truncated archive bytes and invalid custom-format bytes",
      async () => {
        const original = await readFile(archive.archivePath)
        const changed = join(directory, "changed.dump")
        const changedManifest = join(directory, "changed.manifest.json")
        const pair = {
          archivePath: changed,
          manifestPath: archive.manifestPath,
          receiptPath: archive.receiptPath,
        }
        await writeFile(
          changed,
          Buffer.concat([
            original.subarray(0, -1),
            Buffer.from([original.at(-1) ^ 1]),
          ]),
          { mode: 0o600 }
        )
        await restore(pair, ["--apply"], {}, "archive_verification")
        await writeFile(changed, original.subarray(0, -1))
        await restore(pair, ["--apply"], {}, "archive_verification")
        const invalid = Buffer.from("synthetic invalid archive")
        await writeFile(changed, invalid)
        const manifest = JSON.parse(
          await readFile(archive.manifestPath, "utf8")
        )
        await writeFile(
          changedManifest,
          JSON.stringify({
            ...manifest,
            bytes: invalid.length,
            sha256: hash(invalid),
          }),
          { mode: 0o600 }
        )
        await restore(
          {
            archivePath: changed,
            manifestPath: changedManifest,
            receiptPath: archive.receiptPath,
          },
          ["--apply"],
          {},
          "archive_verification"
        )
        await empty(target.client)
      }
    )
    await t.test(
      "rejects a real restored row-count mismatch on an owned disposable target",
      async () => {
        const mismatchTarget = await database()
        const changedReceipt = join(directory, "mismatched.receipt.json")
        const receipt = JSON.parse(await readFile(archive.receiptPath, "utf8"))
        receipt.invariants.tableRows[1].rows += 1
        await writeFile(changedReceipt, JSON.stringify(receipt), {
          mode: 0o600,
        })
        await restore(
          { ...archive, receiptPath: changedReceipt },
          ["--apply"],
          {
            DATABASE_RESTORE_URL: mismatchTarget.url,
            DATABASE_RESTORE_CONFIRM: mismatchTarget.fingerprint,
          },
          "target_verification"
        )
        // A committed restore with failed acceptance stays isolated for inspection.
        assert.deepEqual(await rows(mismatchTarget.client), originalRows)
        assert.deepEqual(await rows(source.client), originalRows)
      }
    )
    await t.test(
      "a verified private snapshot remains restorable after the original archive changes",
      async () => {
        const input = join(directory, "mutable.dump")
        const snapshot = join(directory, "immutable.dump")
        await writeFile(input, await readFile(archive.archivePath), {
          mode: 0o600,
        })
        await snapshotBackupArchive(
          input,
          snapshot,
          JSON.parse(await readFile(archive.manifestPath, "utf8")),
          AbortSignal.timeout(5000)
        )
        await writeFile(input, "changed after snapshot verification")
        assert.equal((await stat(snapshot)).mode & 0o777, 0o600)
        const result = await restore(
          {
            archivePath: snapshot,
            manifestPath: archive.manifestPath,
            receiptPath: archive.receiptPath,
          },
          ["--apply"]
        )
        assert.equal(result.status, "restore_verified")
        assert.equal(result.targetTables, 2)
        assert.equal(result.sourceChecksum, archive.sha256)
        assert.deepEqual(await rows(target.client), originalRows)
        assert.equal(
          (await target.client.query("SELECT app.release_count() AS count"))
            .rows[0].count,
          "2"
        )
        assert.deepEqual(
          (await target.client.query("SELECT * FROM app.release_totals")).rows,
          [{ artist_id: 1, amount: "1234.57" }]
        )
      }
    )
    await t.test(
      "restored identity sequences and database constraints retain their behavior",
      async () => {
        for (const [sql, code] of [
          ["INSERT INTO app.artists(name) VALUES (NULL)", "23502"],
          [
            "INSERT INTO app.artists(name) SELECT name FROM app.artists LIMIT 1",
            "23505",
          ],
          ["UPDATE app.releases SET artist_id=999 WHERE id=1", "23503"],
          ["UPDATE app.releases SET amount=-1 WHERE id=1", "23514"],
        ]) {
          await target.client.query("BEGIN")
          try {
            await assert.rejects(target.client.query(sql), { code })
          } finally {
            await target.client.query("ROLLBACK")
          }
        }
        // Failed artist inserts advance that sequence; release sequence is untouched.
        await target.client.query("BEGIN")
        try {
          const result = await target.client.query(
            "INSERT INTO app.releases(artist_id,sku,amount,metadata,released_at,audio) VALUES (1,'fixture-c',1,'{}','2026-09-14','') RETURNING id"
          )
          assert.equal(result.rows[0].id, 3)
        } finally {
          await target.client.query("ROLLBACK")
        }
        assert.deepEqual(await rows(source.client), originalRows)
        assert.equal(
          (
            await source.client.query(
              "SELECT last_value FROM app.releases_id_seq"
            )
          ).rows[0].last_value,
          "2"
        )
      }
    )
    await t.test(
      "refuses a populated target without changing its contents",
      async () => {
        const before = await rows(target.client)
        await restore(archive, ["--apply"], {}, "target_preflight")
        assert.deepEqual(await rows(target.client), before)
      }
    )
    await t.test(
      "a real late COPY constraint error rolls the entire restore transaction back",
      async () => {
        const failing = await database()
        const rollbackTarget = await database()
        await failing.client.query(
          "CREATE TABLE public.a_first(id integer PRIMARY KEY); INSERT INTO public.a_first VALUES (42)"
        )
        // PostgreSQL quotes the sole synthetic identifier literal; no SQL input is interpolated.
        const literal = (
          await failing.client.query(
            "SELECT quote_literal(current_database()) AS value"
          )
        ).rows[0].value
        await failing.client.query(
          `CREATE TABLE public.z_reject(id integer CHECK (current_database() = ${literal})); INSERT INTO public.z_reject VALUES (1)`
        )
        const failureArchive = await backup(
          join(directory, "rollback-backup"),
          { DATABASE_BACKUP_URL: failing.url }
        )
        const failureReceipt = await captureReceipt(failureArchive, {
          DATABASE_BACKUP_URL: failing.url,
        })
        const failure = await restore(
          failureReceipt,
          ["--apply"],
          {
            DATABASE_RESTORE_URL: rollbackTarget.url,
            DATABASE_RESTORE_CONFIRM: rollbackTarget.fingerprint,
          },
          "restore"
        )
        assert.ok(
          failure.durationMs < 5000,
          "COPY constraint failure must return before the recovery deadline"
        )
        await empty(rollbackTarget.client)
        assert.equal(
          (await failing.client.query("SELECT count(*) FROM public.a_first"))
            .rows[0].count,
          "1"
        )
      }
    )
    for (const cancellation of ["signal", "deadline"])
      await t.test(
        `real lock-wait pg_dump ${cancellation} reaps the session and removes partial output`,
        async () => {
          const locker = await connect(source.url)
          let running
          const output = join(directory, `cancel-${cancellation}`)
          try {
            await locker.query(
              "BEGIN; LOCK TABLE app.releases IN ACCESS EXCLUSIVE MODE"
            )
            running = start(
              process.execPath,
              [
                join(scripts, "postgres-logical-backup.mjs"),
                "--output-dir",
                output,
              ],
              {
                ...environment,
                DATABASE_RECOVERY_TIMEOUT_MS:
                  cancellation === "deadline" ? "2000" : "10000",
              }
            )
            // Observe the actual blocked pg_dump connection before cancellation.
            await waitUntil(
              async () =>
                Number(
                  (
                    await administrator.query(
                      "SELECT count(*) FROM pg_stat_activity WHERE datname=$1 AND application_name='remorseless-recovery' AND wait_event_type='Lock'",
                      [source.name]
                    )
                  ).rows[0].count
                ) === 1
            )
            const children = (
              await readFile(
                `/proc/${running.child.pid}/task/${running.child.pid}/children`,
                "utf8"
              )
            )
              .trim()
              .split(/\s+/u)
            assert.equal(children.length, 1)
            assert.match(children[0], /^[1-9]\d*$/u)
            const clientPid = Number(children[0])
            assert.equal(
              basename(await readlink(`/proc/${clientPid}/exe`)),
              "pg_dump"
            )
            if (cancellation === "signal") running.child.kill("SIGTERM")
            const result = await running.completed
            assert.equal(result.code, 1)
            assert.equal(result.stdout, "")
            assert.equal(JSON.parse(result.stderr).phase, "dump")
            assert.throws(() => process.kill(clientPid, 0), { code: "ESRCH" })
            assert.deepEqual(await readdir(output), [])
            assert.deepEqual(await readdir(scratch), [])
            // Default PostgreSQL connection checks are disabled during a
            // running query. Release our lock so the server can notice EOF;
            // client reaping does not promise immediate server cancellation.
            await locker.query("ROLLBACK")
            await waitUntil(
              async () =>
                Number(
                  (
                    await administrator.query(
                      "SELECT count(*) FROM pg_stat_activity WHERE datname=$1 AND application_name='remorseless-recovery'",
                      [source.name]
                    )
                  ).rows[0].count
                ) === 0
            )
            assert.deepEqual(await readdir(output), [])
            assert.deepEqual(await readdir(scratch), [])
          } finally {
            if (running) {
              running.child.kill("SIGTERM")
              await running.completed.catch(() => {})
            }
            await locker.query("ROLLBACK")
            await locker.end()
          }
        }
      )
  } finally {
    const failures = []
    for (const client of clients)
      try {
        await client.end()
      } catch (error) {
        failures.push(error)
      }
    if (administrator) {
      for (const name of created.toReversed())
        try {
          await administrator.query(`DROP DATABASE ${name}`)
        } catch (error) {
          failures.push(error)
        }
      try {
        await administrator.end()
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await rm(directory, { recursive: true, force: true })
    } catch (error) {
      failures.push(error)
    }
    assert.equal(failures.length, 0, "Owned recovery fixture cleanup failed")
  }
})
