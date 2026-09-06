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
  parseRestoreInventory,
  readBackupManifest,
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
