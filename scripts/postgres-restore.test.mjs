import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
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
