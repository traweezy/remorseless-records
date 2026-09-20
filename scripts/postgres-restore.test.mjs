import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import {
  buildRestoreInvariantsSql,
  buildRestoreTableListSql,
  parseRestoreInvariants,
  parseRestoreInventory,
  parseRestoreReceipt,
  parseRestoreTableList,
  readBackupManifest,
  readRestoreReceipt,
  restoreArchiveLimit,
  snapshotBackupArchive,
} from "./lib/postgres-restore.mjs"

const content = "trusted-fixture-archive"
const execFileAsync = promisify(execFile)
const pg16 = "/usr/lib/postgresql/16/bin"
const manifest = {
  bytes: Buffer.byteLength(content),
  createdAt: "2026-09-06T00:00:00.000Z",
  format: "postgres-custom",
  pgDumpVersion: "pg_dump (PostgreSQL) 18.6",
  schemaVersion: 1,
  sha256: createHash("sha256").update(content).digest("hex"),
  sourceFingerprint: "a".repeat(64),
}

const invariants = {
  serverMajor: 16,
  counts: {
    constraints: 2,
    indexes: 3,
    routines: 1,
    sequences: 1,
    tables: 2,
    views: 1,
  },
  tableRows: [
    { schema: "app", table: "artists", rows: 1 },
    { schema: "app", table: "releases", rows: 2 },
  ],
}

test("receipt requires exact archive binding and complete table counts", () => {
  const receipt = {
    archiveSha256: manifest.sha256,
    sourceFingerprint: manifest.sourceFingerprint,
    schemaVersion: 1,
    invariants,
  }
  assert.deepEqual(parseRestoreReceipt(receipt), receipt)
  for (const bad of [
    { ...receipt, archiveSha256: "wrong" },
    { ...receipt, schemaVersion: 2 },
    { ...receipt, unexpected: true },
    { ...receipt, invariants: { ...invariants, serverMajor: "16" } },
    {
      ...receipt,
      invariants: {
        ...invariants,
        counts: { ...invariants.counts, tables: 3 },
      },
    },
    {
      ...receipt,
      invariants: {
        ...invariants,
        tableRows: [...invariants.tableRows, invariants.tableRows[0]],
      },
    },
  ])
    assert.throws(() => parseRestoreReceipt(bad))
  assert.deepEqual(
    parseRestoreInvariants(JSON.stringify(invariants)),
    invariants
  )
})

test("table list and generated read-only SQL reject unsafe identifiers", () => {
  const tables = invariants.tableRows.map(({ schema, table }) => ({
    schema,
    table,
  }))
  assert.deepEqual(parseRestoreTableList(JSON.stringify(tables)), tables)
  const sql = buildRestoreInvariantsSql(tables)
  assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u)
  assert.match(sql, /SELECT count\(\*\) FROM "app"\."artists"/u)
  assert.match(sql, /json_agg\(row_data ORDER BY ordinal\)/u)
  assert.doesNotMatch(sql, /json_build_array/u)
  const snapshot = "00000003-0000001B-1"
  for (const statement of [
    buildRestoreTableListSql(snapshot),
    buildRestoreInvariantsSql(tables, snapshot),
  ]) {
    assert.match(
      statement,
      /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT '00000003-0000001B-1';/u
    )
    assert.doesNotMatch(statement, /\b(?:INSERT|UPDATE|DELETE)\b/u)
  }
  for (const badSnapshot of ["", "x'; DROP TABLE app.artists; --", "x\n"]) {
    assert.throws(() => buildRestoreTableListSql(badSnapshot))
    assert.throws(() => buildRestoreInvariantsSql(tables, badSnapshot))
  }
  for (const bad of [
    [{ schema: "app", table: "artists;drop" }],
    [tables[1], tables[0]],
    [tables[0], tables[0]],
    [{ schema: "public", table: "Capital" }],
  ])
    assert.throws(() => buildRestoreInvariantsSql(bad))
})

test("ordered invariant SQL handles 171 physical tables on PostgreSQL 16", {
  skip:
    process.getuid?.() === 0 ||
    !["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(pg16, name))),
  timeout: 60_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "restore-many-tables-test-"))
  const data = join(directory, "data")
  const localEnvironment = {
    HOME: directory,
    PATH: `${pg16}:/usr/bin:/bin`,
    LANG: "C",
  }
  const run = async (command, args, environment = localEnvironment) => {
    const { stdout } = await execFileAsync(join(pg16, command), args, {
      env: environment,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim()
  }
  let started = false
  try {
    await run("initdb", [
      "-D",
      data,
      "--auth-local=trust",
      "--auth-host=reject",
      "--locale=C",
      "--encoding=UTF8",
      "--no-instructions",
    ])
    await run("pg_ctl", [
      "-D",
      data,
      "-l",
      join(directory, "server.log"),
      "-o",
      `-k ${directory} -p 55439 -c listen_addresses=`,
      "-w",
      "start",
    ])
    started = true
    const environment = {
      ...localEnvironment,
      PGHOST: directory,
      PGPORT: "55439",
      PGUSER: userInfo().username,
      PGDATABASE: "postgres",
    }
    const query = (sql) =>
      run(
        "psql",
        [
          "--no-psqlrc",
          "--quiet",
          "--tuples-only",
          "--no-align",
          "--set=ON_ERROR_STOP=1",
          `--command=${sql}`,
        ],
        environment
      )
    const tableNames = Array.from(
      { length: 171 },
      (_, index) => `items_${String(index).padStart(3, "0")}`
    )
    await query(`CREATE SCHEMA app; ${tableNames
      .map((name) => `CREATE TABLE app.${name} (id integer PRIMARY KEY);`)
      .join(" ")}
      INSERT INTO app.items_000 VALUES (1);
      INSERT INTO app.items_085 VALUES (1), (2);
      INSERT INTO app.items_170 VALUES (1), (2), (3);`)
    const tables = parseRestoreTableList(
      await query(buildRestoreTableListSql())
    )
    assert.equal(tables.length, 171)
    assert.deepEqual(
      tables.map(({ table }) => table),
      tableNames
    )
    const sql = buildRestoreInvariantsSql(tables)
    assert.doesNotMatch(sql, /json_build_array/u)
    const actual = parseRestoreInvariants(await query(sql))
    assert.equal(actual.serverMajor, 16)
    assert.equal(actual.counts.tables, 171)
    assert.deepEqual(
      actual.tableRows.map(({ rows }) => rows),
      tableNames.map((_, index) =>
        index === 0 ? 1 : index === 85 ? 2 : index === 170 ? 3 : 0
      )
    )
  } finally {
    if (started) await run("pg_ctl", ["-D", data, "-m", "immediate", "stop"])
    await rm(directory, { force: true, recursive: true })
  }
})

test("reads bounded canonical restore receipts", () =>
  withDirectory(async (directory) => {
    const path = join(directory, "receipt.json")
    const receipt = {
      archiveSha256: manifest.sha256,
      sourceFingerprint: manifest.sourceFingerprint,
      schemaVersion: 1,
      invariants,
    }
    await writeFile(path, JSON.stringify(receipt), { mode: 0o600 })
    assert.deepEqual(
      await readRestoreReceipt(path, AbortSignal.timeout(1000)),
      receipt
    )
    const alias = join(directory, "receipt-alias")
    await symlink(path, alias)
    await assert.rejects(readRestoreReceipt(alias, AbortSignal.timeout(1000)))
    await writeFile(path, " ".repeat(256 * 1024 + 1))
    await assert.rejects(readRestoreReceipt(path, AbortSignal.timeout(1000)))
  }))
const withDirectory = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), "restore-snapshot-test-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

test("requires strict complete inventory counts, not partial parseInt acceptance", () => {
  assert.deepEqual(parseRestoreInventory('{"tables":0,"objects":0}'), {
    tables: 0,
    objects: 0,
  })
  for (const raw of [
    "0garbage",
    "null",
    "[]",
    '{"tables":0}',
    '{"tables":1,"objects":0}',
    '{"tables":0,"objects":-1}',
    '{"tables":"0","objects":0}',
    '{"tables":0,"objects":0,"extra":0}',
    '{"tables":0,"objects":1.5}',
  ])
    assert.throws(() => parseRestoreInventory(raw))
})

test("bounds restore disk-copy budgets", () => {
  assert.equal(restoreArchiveLimit(undefined), 10 * 1024 ** 3)
  assert.equal(restoreArchiveLimit("1"), 1)
  for (const raw of ["", "0", "1e3", "-1", "01", String(1024 ** 4 + 1)])
    assert.throws(() => restoreArchiveLimit(raw))
})

test("reads a bounded regular manifest and rejects oversized or symlink input", () =>
  withDirectory(async (directory) => {
    const path = join(directory, "manifest.json")
    await writeFile(path, JSON.stringify(manifest))
    assert.deepEqual(
      await readBackupManifest(path, AbortSignal.timeout(1000)),
      manifest
    )
    const alias = join(directory, "alias")
    await symlink(path, alias)
    await assert.rejects(readBackupManifest(alias, AbortSignal.timeout(1000)))
    await assert.rejects(
      readBackupManifest(directory, AbortSignal.timeout(1000))
    )
    await assert.rejects(
      readBackupManifest("relative.json", AbortSignal.timeout(1000))
    )
    await writeFile(path, " ".repeat(65537))
    await assert.rejects(readBackupManifest(path, AbortSignal.timeout(1000)))
  }))

test("snapshot remains private and unchanged when the source is replaced after verification", () =>
  withDirectory(async (directory) => {
    const source = join(directory, "archive.dump")
    const snapshot = join(directory, "snapshot.dump")
    await writeFile(source, content)
    await snapshotBackupArchive(
      source,
      snapshot,
      manifest,
      AbortSignal.timeout(1000)
    )
    await writeFile(source, "replaced")
    assert.equal(await readFile(snapshot, "utf8"), content)
    assert.equal((await stat(snapshot)).mode & 0o777, 0o600)
    await assert.rejects(
      snapshotBackupArchive(
        source,
        snapshot,
        manifest,
        AbortSignal.timeout(1000)
      )
    )
  }))

test("snapshot rejects corrupt, truncated, symlink, existing-target, and cancelled inputs", () =>
  withDirectory(async (directory) => {
    const source = join(directory, "archive.dump")
    await writeFile(source, "x".repeat(manifest.bytes))
    await assert.rejects(
      snapshotBackupArchive(
        source,
        join(directory, "corrupt"),
        manifest,
        AbortSignal.timeout(1000)
      )
    )
    await writeFile(source, content.slice(1))
    await assert.rejects(
      snapshotBackupArchive(
        source,
        join(directory, "truncated"),
        manifest,
        AbortSignal.timeout(1000)
      )
    )
    await writeFile(source, content)
    await assert.rejects(
      snapshotBackupArchive(source, source, manifest, AbortSignal.timeout(1000))
    )
    await assert.rejects(
      snapshotBackupArchive(
        source,
        join(directory, "cancelled"),
        manifest,
        AbortSignal.abort()
      )
    )
    const alias = join(directory, "alias")
    await symlink(source, alias)
    await assert.rejects(
      snapshotBackupArchive(
        alias,
        join(directory, "linked"),
        manifest,
        AbortSignal.timeout(1000)
      )
    )
  }))
