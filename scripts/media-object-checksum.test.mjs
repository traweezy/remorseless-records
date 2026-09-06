import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import test from "node:test"

import {
  parseMediaInventory,
  parseMediaVerificationLimits,
  validateMediaVerificationBudget,
  verifyMediaMirror,
} from "./lib/media-backup.mjs"
import { hashMcObject, hashMediaStream } from "./lib/media-object-checksum.mjs"

const inventory = (entries) =>
  parseMediaInventory(
    entries
      .map(([key, size]) =>
        JSON.stringify({ key, size, status: "success", type: "file" })
      )
      .join("\n")
  )
const source = inventory([["cover.webp", 4]])
const target = inventory([
  ["cover.webp", 4],
  ["retained.webp", 3],
])
const limits = { maxBytes: 8, maxObjects: 1, timeoutMs: 5_000 }
const digest = (value) => ({
  bytes: Buffer.byteLength(value),
  sha256: createHash("sha256").update(value).digest("hex"),
})

test("requires explicit total download budget and rejects unsafe limits", () => {
  assert.throws(() => parseMediaVerificationLimits({}), /MAX_BYTES/u)
  assert.deepEqual(
    parseMediaVerificationLimits({ MEDIA_BACKUP_VERIFY_MAX_BYTES: "8" }),
    {
      maxBytes: 8,
      maxObjects: 10000,
      timeoutMs: 600000,
    }
  )
  for (const value of [
    "0",
    "-1",
    "1e6",
    "1.5",
    " 8",
    "9007199254740992",
    "Infinity",
  ]) {
    assert.throws(() =>
      parseMediaVerificationLimits({ MEDIA_BACKUP_VERIFY_MAX_BYTES: value })
    )
  }
  assert.throws(() =>
    parseMediaVerificationLimits({
      MEDIA_BACKUP_VERIFY_MAX_BYTES: "8",
      MEDIA_BACKUP_VERIFY_TIMEOUT_MS: "3600001",
    })
  )
  assert.throws(() =>
    parseMediaVerificationLimits({
      MEDIA_BACKUP_VERIFY_MAX_BYTES: "8",
      MEDIA_BACKUP_VERIFY_MAX_OBJECTS: "100001",
    })
  )
  assert.deepEqual(validateMediaVerificationBudget(source, limits), {
    readBytes: 8,
    readRequests: 2,
  })
  for (const invalid of [
    { maxBytes: 7 },
    { maxObjects: 0 },
    { timeoutMs: 0 },
    { maxBytes: Number.NaN },
  ]) {
    assert.throws(() =>
      validateMediaVerificationBudget(source, { ...limits, ...invalid })
    )
  }
})

test("rejects path escapes and ambiguous keys before opening any object", () => {
  for (const key of [
    "../key",
    "/key",
    "a/./b",
    "a//b",
    "a\\b",
    "key?token=secret",
    "a#b",
    "a%2fb",
    "a\n4",
    "a\0b",
    "https://host/key",
    "é".repeat(513),
  ]) {
    assert.throws(() => inventory([[key, 4]]), /invalid object/u)
  }
  assert.equal(inventory([["folder/cover art-é.webp", 4]]).objectCount, 1)
})

test("hashes actual content while preserving target-only history", async () => {
  const calls = []
  const evidence = await verifyMediaMirror(source, target, {
    limits,
    hashObject: async (options) => {
      calls.push(options)
      return hashMediaStream(
        Readable.from([Buffer.from("go"), Buffer.from("od")]),
        options
      )
    },
  })
  assert.equal(evidence.preservedTargetObjects, 1)
  assert.equal(evidence.targetInventorySha256, target.sha256)
  assert.equal(evidence.verifiedObjects, 1)
  assert.equal(evidence.verificationReadBytes, 8)
  assert.equal(evidence.verificationAlgorithm, "SHA256")
  assert.match(evidence.contentSha256, /^[a-f0-9]{64}$/u)
  assert.deepEqual(
    calls.map(({ side, key, expectedBytes }) => ({ side, key, expectedBytes })),
    [
      { side: "source", key: "cover.webp", expectedBytes: 4 },
      { side: "target", key: "cover.webp", expectedBytes: 4 },
    ]
  )
  assert.equal(calls[0].signal.aborted, true)
})

test("rejects equal-sized corruption that the old inventory-only check accepted", async () => {
  await assert.rejects(
    verifyMediaMirror(source, target, {
      limits,
      hashObject: async ({ side }) =>
        digest(side === "source" ? "good" : "evil"),
    }),
    /content differs/u
  )
})

test("rejects missing targets and read budgets before making content reads", async () => {
  let reads = 0
  const hashObject = async () => {
    reads++
    return digest("good")
  }
  await assert.rejects(
    verifyMediaMirror(source, inventory([]), { limits, hashObject }),
    /missing/u
  )
  await assert.rejects(
    verifyMediaMirror(source, target, {
      limits: { ...limits, maxBytes: 7 },
      hashObject,
    }),
    /budget/u
  )
  assert.equal(reads, 0)
})

test("rejects malformed checksum evidence without leaking reader errors", async () => {
  for (const evidence of [
    null,
    {},
    { ...digest("good"), bytes: 3 },
    { bytes: 4, sha256: "not-a-checksum" },
  ]) {
    await assert.rejects(
      verifyMediaMirror(source, target, {
        limits,
        hashObject: async () => evidence,
      }),
      /invalid evidence/u
    )
  }
  await assert.rejects(
    verifyMediaMirror(source, target, {
      limits,
      hashObject: async () => {
        throw new Error("https://user:secret@provider/private-key")
      },
    }),
    { message: "Media content verification read failed." }
  )
})

test("bounds stalled readers and propagates cancellation", async () => {
  let activeSignal
  await assert.rejects(
    verifyMediaMirror(source, target, {
      limits: { ...limits, timeoutMs: 20 },
      hashObject: ({ signal, expectedBytes }) => {
        activeSignal = signal
        return hashMediaStream(new Readable({ read: () => {} }), {
          signal,
          expectedBytes,
        })
      },
    }),
    /cancelled or timed out/u
  )
  assert.equal(activeSignal.aborted, true)
  const controller = new AbortController()
  controller.abort(new Error("private cancellation details"))
  let reads = 0
  await assert.rejects(
    verifyMediaMirror(source, target, {
      limits,
      signal: controller.signal,
      hashObject: async () => {
        reads++
        return digest("good")
      },
    }),
    { message: "Media content verification was cancelled or timed out." }
  )
  assert.equal(reads, 0)
})

test("stream checksums are chunk-independent and reject both length mismatches", async () => {
  assert.deepEqual(
    await hashMediaStream(Readable.from([Buffer.from("good")]), {
      expectedBytes: 4,
    }),
    digest("good")
  )
  assert.deepEqual(
    await hashMediaStream(Readable.from([]), { expectedBytes: 0 }),
    digest("")
  )
  await assert.rejects(
    hashMediaStream(Readable.from([Buffer.from("short")]), {
      expectedBytes: 8,
    }),
    /shorter/u
  )
  const oversized = Readable.from([Buffer.from("oversized")])
  await assert.rejects(
    hashMediaStream(oversized, { expectedBytes: 4 }),
    /exceeded/u
  )
  assert.equal(oversized.destroyed, true)
  await assert.rejects(
    hashMediaStream(Readable.from([]), { expectedBytes: -1 }),
    /invalid/u
  )
})

const localReader =
  (code, observe = () => {}) =>
  (command, args, options) => {
    assert.equal(command, "mc")
    assert.deepEqual(args, ["cat", "source/catalog/cover.webp"])
    assert.deepEqual(options.stdio, ["ignore", "pipe", "ignore"])
    assert.equal(options.killSignal, "SIGKILL")
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", code],
      options
    )
    observe(child)
    return child
  }
const objectOptions = () => ({
  endpoint: "source/catalog",
  key: "cover.webp",
  expectedBytes: 4,
  signal: new AbortController().signal,
})

test("real process reader requires stdout completion and a successful exit", async () => {
  assert.deepEqual(
    await hashMcObject(
      objectOptions(),
      localReader('process.stdout.write("good")')
    ),
    digest("good")
  )
  await assert.rejects(
    hashMcObject(
      objectOptions(),
      localReader(
        'process.stdout.write("good"); process.stderr.write("secret provider URL"); process.exitCode=7'
      )
    ),
    { message: "Media object content could not be verified." }
  )
  await assert.rejects(
    hashMcObject(objectOptions(), () => {
      throw new Error("sensitive spawn details")
    }),
    { message: "Media object reader could not start." }
  )
  await assert.rejects(
    hashMcObject(objectOptions(), (_command, _args, options) =>
      spawn("/nonexistent/remorseless-test-mc", [], options)
    ),
    /could not be verified/u
  )
})

test("cancellation reaps a real stalled reader without leaking its abort reason", async () => {
  const controller = new AbortController()
  let child
  const pending = hashMcObject(
    { ...objectOptions(), signal: controller.signal },
    localReader("setInterval(() => {}, 1000)", (value) => {
      child = value
    })
  )
  controller.abort(new Error("private cancellation reason"))
  await assert.rejects(pending, {
    message: "Media object content could not be verified.",
  })
  assert.equal(child.signalCode, "SIGKILL")
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" })
})

test("mirror timeout waits for the owned object-reader process to close", async () => {
  let child
  await assert.rejects(
    verifyMediaMirror(source, target, {
      limits: { ...limits, timeoutMs: 100 },
      hashObject: (options) =>
        hashMcObject(
          { ...options, endpoint: "source/catalog" },
          localReader("setInterval(() => {}, 1000)", (value) => {
            child = value
          })
        ),
    }),
    /cancelled or timed out/u
  )
  assert.equal(child.signalCode, "SIGKILL")
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" })
})
