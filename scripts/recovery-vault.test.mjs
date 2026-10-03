import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { Readable } from "node:stream"
import test from "node:test"
import {
  createRecoveryStore,
  readBoundedObject,
  storageFingerprint,
} from "./lib/recovery-s3.mjs"
import {
  openRecoveryObject,
  parseRecoveryKey,
  recoveryHash,
  restoreRecoverySnapshot,
  sealRecoveryObject,
  writeRecoverySnapshot,
} from "./lib/recovery-vault.mjs"

const key = randomBytes(32)
const fixture = () => {
  const objects = new Map()
  const bodies = [Buffer.from("private database"), Buffer.from("private media")]
  return {
    objects,
    options: {
      key,
      sourceFingerprint: "a".repeat(64),
      targetFingerprint: "b".repeat(64),
      sources: bodies.map((body, index) => ({
        kind: index ? "media" : "database",
        name: index ? "image/photo.webp" : "database.dump",
        bytes: body.length,
        read: async () => body,
      })),
      destination: {
        async put(name, value) {
          assert.ok(!objects.has(name))
          objects.set(name, value)
        },
        async get(name) {
          assert.ok(objects.has(name))
          return objects.get(name)
        },
      },
      validateSource: async () => {},
    },
  }
}
const restore = (f, receipt, write = async () => {}) =>
  restoreRecoverySnapshot({
    ...f.options,
    receiptKey: receipt.receiptKey,
    receiptSha256: receipt.receiptSha256,
    write,
  })

test("AES-GCM binds content to the key, object location, nonce and authentication tag", () => {
  const body = Buffer.from("private-canary")
  const encrypted = sealRecoveryObject(body, key, "one")
  assert.notDeepEqual(encrypted, sealRecoveryObject(body, key, "one"))
  assert.ok(!encrypted.includes(body))
  assert.deepEqual(openRecoveryObject(encrypted, key, "one"), body)
  assert.deepEqual(parseRecoveryKey(key.toString("hex")), key)
  assert.throws(() => parseRecoveryKey("private-canary"))
  assert.throws(() => openRecoveryObject(encrypted, randomBytes(32), "one"))
  assert.throws(() => openRecoveryObject(encrypted, key, "two"))
  for (const index of [0, 8, 20, 36]) {
    const copy = Buffer.from(encrypted)
    copy[index] ^= 1
    assert.throws(() => openRecoveryObject(copy, key, "one"))
  }
  assert.throws(() => openRecoveryObject(encrypted.subarray(0, 20), key, "one"))
})

test("every retained object is read back before publication and restores from a bound receipt", async () => {
  const f = fixture()
  const receipt = await writeRecoverySnapshot(f.options)
  assert.equal(receipt.objects, 2)
  assert.equal(receipt.databaseObjects, 1)
  assert.equal(receipt.mediaObjects, 1)
  assert.equal(f.objects.size, 4)
  assert.equal(receipt.offsiteVerified, false)
  const restored = []
  const report = await restore(f, receipt, async (entry, body) =>
    restored.push({ ...entry, text: body.toString() })
  )
  assert.equal(report.passed, true)
  assert.equal(restored[0].text, "private database")
  assert.equal(restored[1].name, "image/photo.webp")
  assert.equal(restored[1].sha256, recoveryHash(Buffer.from("private media")))
  assert.equal(report.versionHistoryVerified, false)
  assert.equal(report.offsiteVerified, false)
  assert.ok(
    [...f.objects.values()].every(
      (b) => !b.includes(Buffer.from("private database"))
    )
  )
})

test("changed source, corrupt storage, failed writes and cancellation withhold a complete receipt", async () => {
  for (const kind of ["read", "write", "validate", "cancel", "size"]) {
    const f = fixture()
    if (kind === "read")
      f.options.destination.get = async () => Buffer.from("corrupt")
    if (kind === "write")
      f.options.destination.put = async () => {
        throw new Error("private-canary")
      }
    if (kind === "validate")
      f.options.validateSource = async () => {
        throw new Error("changed")
      }
    if (kind === "cancel") f.options.signal = AbortSignal.abort()
    if (kind === "size") f.options.sources[0].bytes++
    await assert.rejects(writeRecoverySnapshot(f.options))
    assert.ok(
      ![...f.objects.keys()].some((name) => name.endsWith("receipt.json"))
    )
  }
})

test("wrong receipt, destination, manifest or encrypted object cannot restore", async () => {
  for (const kind of [
    "receipt",
    "destination",
    "manifest",
    "object",
    "key",
    "cancel",
  ]) {
    const f = fixture()
    const receipt = await writeRecoverySnapshot(f.options)
    if (kind === "receipt") receipt.receiptSha256 = "c".repeat(64)
    if (kind === "destination") f.options.targetFingerprint = "c".repeat(64)
    if (kind === "manifest")
      f.objects.set(receipt.manifestKey, Buffer.from("bad"))
    if (kind === "object") f.objects.get([...f.objects.keys()][0])[40] ^= 1
    if (kind === "key") f.options.key = randomBytes(32)
    if (kind === "cancel") f.options.signal = AbortSignal.abort()
    const writes = []
    await assert.rejects(
      restore(f, receipt, async (entry) => writes.push(entry))
    )
    // An independent valid object may finish in parallel. Corrupt plaintext
    // must never reach the target, and the overall drill must still fail.
    if (kind === "object")
      assert.ok(writes.every((entry) => entry.kind === "media"))
    else assert.equal(writes.length, 0)
  }
})

test("invalid inventory is rejected before uploads", async () => {
  for (const mutate of [
    (o) => {
      o.sources = []
    },
    (o) => {
      o.sources.push(o.sources[0])
    },
    (o) => {
      o.sources[0].kind = "other"
    },
    (o) => {
      o.sources[0].name = "\u0000private"
    },
    (o) => {
      o.sources[0].bytes = -1
    },
    (o) => {
      o.sources[0].bytes = 128 * 1024 * 1024 + 1
    },
    (o) => {
      o.targetFingerprint = o.sourceFingerprint
    },
  ]) {
    const f = fixture()
    mutate(f.options)
    await assert.rejects(writeRecoverySnapshot(f.options))
    assert.equal(f.objects.size, 0)
  }
})

test("S3 adapter has bounded bodies, inventory, credentials and conditional writes", async () => {
  const config = {
    endpoint: "https://storage.example",
    region: "auto",
    bucket: "private-bucket",
    accessKeyId: "private",
    secretAccessKey: "private",
  }
  const calls = []
  let closed = false
  const client = {
    async send(command) {
      calls.push(command.input)
      if (command.constructor.name === "PutObjectCommand") return {}
      if (command.constructor.name === "GetObjectCommand")
        return { ContentLength: 3, Body: Readable.from([Buffer.from("abc")]) }
      if (command.input.ContinuationToken)
        return {
          Contents: [{ Key: "a", Size: 3, ETag: "one" }],
          IsTruncated: false,
        }
      return {
        Contents: [{ Key: "b", Size: 1, ETag: "two" }],
        IsTruncated: true,
        NextContinuationToken: "page-2",
      }
    },
    destroy() {
      closed = true
    },
  }
  const store = createRecoveryStore(config, client)
  assert.equal(store.fingerprint, storageFingerprint(config))
  assert.deepEqual(
    (await store.list()).map((o) => o.key),
    ["a", "b"]
  )
  assert.equal((await store.get("key", 3)).toString(), "abc")
  await store.put("key", Buffer.from("abc"))
  assert.equal(calls.at(-1).IfNoneMatch, "*")
  await assert.rejects(store.get("key", 2))
  store.close()
  assert.equal(closed, true)
  assert.throws(() =>
    storageFingerprint({ ...config, endpoint: "http://public.example" })
  )
  assert.throws(() =>
    storageFingerprint({
      ...config,
      endpoint: "https://user:secret@storage.example",
    })
  )
  assert.doesNotThrow(() =>
    storageFingerprint({
      ...config,
      endpoint: "http://bucket.railway.internal:9000",
    })
  )
})

test("S3 pagination loops, duplicate keys, malformed or oversized objects fail closed", async () => {
  for (const response of [
    { IsTruncated: true, NextContinuationToken: "repeat" },
    { IsTruncated: undefined },
    { IsTruncated: false, Contents: [{ Key: "a", Size: -1, ETag: "a" }] },
    {
      IsTruncated: false,
      Contents: [
        { Key: "a", Size: 1, ETag: "a" },
        { Key: "a", Size: 1, ETag: "a" },
      ],
    },
  ]) {
    const store = createRecoveryStore(
      { endpoint: "https://example.com", bucket: "valid-bucket" },
      { send: async () => response, destroy() {} }
    )
    await assert.rejects(store.list())
  }
  const body = Readable.from([Buffer.alloc(4)])
  await assert.rejects(readBoundedObject(body, 3))
  assert.equal(body.destroyed, true)
  await assert.rejects(
    readBoundedObject(Readable.from([Buffer.from("a")]), 3, AbortSignal.abort())
  )
})

test("archive deletion is limited to one owned snapshot and verifies every service result", async () => {
  const prefix = "rr-recovery/v1/11111111-1111-4111-8111-111111111111/"
  const calls = []
  const store = createRecoveryStore(
    { endpoint: "https://example.com", bucket: "archive" },
    {
      async send(command) {
        calls.push(command.input)
        return { Deleted: command.input.Delete.Objects }
      },
      destroy() {},
    }
  )
  const keys = Array.from(
    { length: 1001 },
    (_, i) => `${prefix}objects/${i}.bin`
  )
  await store.removeSnapshot(keys)
  assert.equal(calls.length, 2)
  for (const invalid of [
    [],
    ["source/image.webp"],
    [keys[0], keys[0]],
    [keys[0], `${prefix}other`],
    [keys[0], keys[0].replace("11111111-", "22222222-")],
  ])
    await assert.rejects(store.removeSnapshot(invalid))
  const failed = createRecoveryStore(
    { endpoint: "https://example.com", bucket: "archive" },
    {
      async send() {
        return { Errors: [{ Code: "AccessDenied" }] }
      },
      destroy() {},
    }
  )
  await assert.rejects(failed.removeSnapshot([keys[0]]))
  await assert.rejects(store.removeSnapshot(keys, AbortSignal.abort()))
})
