import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import test from "node:test"
import { pruneRecoverySnapshots } from "./lib/recovery-retention.mjs"
import { auditRecoverySnapshots } from "./staging-recovery-audit.mjs"
import {
  openRecoveryObject,
  recoveryHash,
  restoreRecoverySnapshot,
  sealRecoveryObject,
  writeRecoverySnapshot,
} from "./lib/recovery-vault.mjs"

const fixture = async () => {
  const objects = new Map()
  const key = randomBytes(32)
  const removed = []
  const destination = {
    fingerprint: "b".repeat(64),
    async get(name) {
      assert.ok(objects.has(name))
      return objects.get(name)
    },
    async put(name, bytes) {
      assert.ok(!objects.has(name))
      objects.set(name, bytes)
    },
    async list() {
      return [...objects]
        .map(([key, value]) => ({
          key,
          bytes: value.length,
          etag: recoveryHash(value),
        }))
        .sort((a, b) => a.key.localeCompare(b.key))
    },
    async removeSnapshot(keys) {
      for (const name of keys) {
        removed.push(name)
        objects.delete(name)
      }
    },
  }
  const options = {
    destination,
    key,
    targetFingerprint: destination.fingerprint,
    sourceFingerprint: "a".repeat(64),
    sources: [
      {
        kind: "database",
        name: "database.dump",
        bytes: 3,
        read: async () => Buffer.from("abc"),
      },
    ],
    validateSource: async () => {},
  }
  const receipts = []
  for (const date of ["2026-06-01", "2026-07-01", "2026-08-01", "2026-10-01"])
    receipts.push(
      await writeRecoverySnapshot({
        ...options,
        now: () => new Date(`${date}T00:00:00.000Z`),
      })
    )
  return {
    objects,
    removed,
    receipts,
    options: {
      ...options,
      currentId: receipts.at(-1).id,
      now: new Date("2026-10-03T00:00:00.000Z"),
    },
  }
}

test("retention authenticates dates, keeps two complete sets and leaves orphan objects", async () => {
  const f = await fixture()
  f.objects.set("rr-recovery/v1/unknown/partial", Buffer.from("keep"))
  const report = await pruneRecoverySnapshots(f.options)
  assert.equal(report.removedSnapshots, 2)
  assert.equal(f.removed.length, 6)
  for (const receipt of f.receipts.slice(2))
    assert.ok(f.objects.has(receipt.receiptKey))
  assert.ok(f.objects.has("rr-recovery/v1/unknown/partial"))
})

test("receipt clock forgery, corruption, extra objects and missing current backup prevent all deletion", async () => {
  for (const kind of [
    "date",
    "manifest",
    "extra",
    "current",
    "future",
    "target",
    "cancel",
  ]) {
    const f = await fixture()
    const receipt = f.receipts[0]
    if (kind === "date") {
      const r = JSON.parse(f.objects.get(receipt.receiptKey))
      r.createdAt = "2000-01-01T00:00:00.000Z"
      f.objects.set(receipt.receiptKey, Buffer.from(JSON.stringify(r)))
    }
    if (kind === "manifest") f.objects.get(receipt.manifestKey)[40] ^= 1
    if (kind === "extra")
      f.objects.set(
        receipt.manifestKey.replace("manifest.bin", "other"),
        Buffer.from("keep")
      )
    if (kind === "current") f.options.currentId = "absent"
    if (kind === "future") f.options.now = new Date("2026-01-01T00:00:00.000Z")
    if (kind === "target") f.options.targetFingerprint = "c".repeat(64)
    if (kind === "cancel") f.options.signal = AbortSignal.abort()
    await assert.rejects(pruneRecoverySnapshots(f.options))
    assert.equal(f.removed.length, 0)
  }
})

test("legacy backups remain restorable and never expire using unauthenticated dates", async () => {
  const f = await fixture()
  const receipt = f.receipts[0]
  const r = JSON.parse(f.objects.get(receipt.receiptKey))
  const manifest = JSON.parse(
    openRecoveryObject(
      f.objects.get(r.manifestKey),
      f.options.key,
      r.manifestKey
    )
  )
  manifest.schemaVersion = 1
  delete manifest.createdAt
  const encrypted = sealRecoveryObject(
    Buffer.from(JSON.stringify(manifest)),
    f.options.key,
    r.manifestKey
  )
  f.objects.set(r.manifestKey, encrypted)
  Object.assign(r, {
    schemaVersion: 1,
    manifestSha256: recoveryHash(encrypted),
    manifestBytes: encrypted.length,
  })
  const bytes = Buffer.from(JSON.stringify(r))
  f.objects.set(receipt.receiptKey, bytes)
  assert.equal(
    (
      await restoreRecoverySnapshot({
        ...f.options,
        receiptKey: receipt.receiptKey,
        receiptSha256: recoveryHash(bytes),
        write: async () => {},
      })
    ).passed,
    true
  )
  const report = await pruneRecoverySnapshots(f.options)
  assert.equal(report.retainedLegacySnapshots, 1)
  assert.equal(report.removedSnapshots, 1)
  assert.ok(f.objects.has(receipt.receiptKey))
})

test("retention detects changes before deletion and fails on partial deletion", async () => {
  for (const kind of ["race", "partial", "failure"]) {
    const f = await fixture()
    if (kind === "race") {
      const list = f.options.destination.list
      let count = 0
      f.options.destination.list = async () => {
        if (++count === 2)
          f.objects.set(
            f.receipts[1].manifestKey.replace("manifest.bin", "unexpected"),
            Buffer.from("keep")
          )
        return list()
      }
    } else
      f.options.destination.removeSnapshot = async () => {
        if (kind === "failure") throw new Error("private failure")
      }
    await assert.rejects(pruneRecoverySnapshots(f.options))
    assert.equal(f.removed.length, 0)
  }
})

test("archive freshness authenticates complete inventory and rejects stale or future data", async () => {
  const f = await fixture()
  f.objects.clear()
  const receipt = await writeRecoverySnapshot({
    ...f.options,
    sources: ["database.dump", "manifest", "receipt", "scope", "image"].map(
      (name, i) => ({
        kind: i === 4 ? "media" : "database",
        name,
        bytes: 3,
        read: async () => Buffer.from("abc"),
      })
    ),
    now: () => f.options.now,
  })
  const opened = { store: f.options.destination, key: f.options.key }
  const now = f.options.now.getTime()
  assert.equal((await auditRecoverySnapshots(opened, now)).passed, true)
  assert.equal(
    (await auditRecoverySnapshots(opened, now + 27 * 3600_000)).passed,
    false
  )
  assert.equal(
    (await auditRecoverySnapshots(opened, now - 61_000)).passed,
    false
  )
  f.objects.delete(receipt.manifestKey.replace("manifest.bin", "objects/0.bin"))
  await assert.rejects(auditRecoverySnapshots(opened, now))
})
