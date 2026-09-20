import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  parseReplayArguments,
  runIsolatedRedisReplay,
  validateCaptureReceipt,
} from "./redis-aof-isolated-replay.mjs"
import {
  collectIsolatedRedisQueueAggregate,
  collectRedisQueueAggregate,
} from "./lib/redis-queue-aggregate.mjs"

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const manifest =
  "file appendonly.aof.1.base.rdb seq 1 type b\nfile appendonly.aof.1.incr.aof seq 1 type i\n"
const content = new Map([
  ["appendonly.aof.manifest", Buffer.from(manifest)],
  ["appendonly.aof.1.base.rdb", Buffer.from("synthetic-base")],
  ["appendonly.aof.1.incr.aof", Buffer.from("synthetic-incr")],
])
const source = {
  projectId: "11111111-1111-4111-8111-111111111111",
  environmentId: "22222222-2222-4222-8222-222222222222",
  serviceId: "33333333-3333-4333-8333-333333333333",
  deploymentId: "44444444-4444-4444-8444-444444444444",
  instanceId: "55555555-5555-4555-8555-555555555555",
  volumeId: "66666666-6666-4666-8666-666666666666",
  volumeInstanceId: "77777777-7777-4777-8777-777777777777",
  mountPath: "/bitnami",
}
const receipt = () => {
  const files = [...content].map(([name, bytes]) => ({
    name,
    bytes: bytes.length,
    sha256: hash(bytes),
  }))
  return {
    schemaVersion: 1,
    source,
    sourceFingerprint: "a".repeat(64),
    runIdSha256: "b".repeat(64),
    manifestSha256: hash(manifest),
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    rewriteRestored: true,
  }
}
const imageId = `sha256:${"c".repeat(64)}`
const argumentsFor = (archive, receiptPath, receiptSha256) => [
  "--archive-dir",
  archive,
  "--capture-receipt",
  receiptPath,
  "--receipt-sha256",
  receiptSha256,
  "--image-id",
  imageId,
]
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "redis-replay-fixture-"))
  const archive = join(root, "appendonlydir")
  await mkdir(archive, { mode: 0o700 })
  for (const [name, bytes] of content)
    await writeFile(join(archive, name), bytes, { mode: 0o600 })
  const receiptPath = join(root, "capture.receipt.json")
  const evidence = receipt()
  const receiptBytes = Buffer.from(`${JSON.stringify(evidence)}\n`)
  await writeFile(receiptPath, receiptBytes, { mode: 0o600 })
  return { root, archive, receiptPath, receiptBytes, evidence }
}

test("recovery aggregate reports only bounded queue, lock, and idempotency counts", async () => {
  const entries = new Map([
    ["RedisEventBusService:events-queue:wait", ["list", -1, 2]],
    ["bull:medusa-workflows-jobs:delayed", ["zset", -1, 3]],
    ["medusa_lock:private-owner", ["string", 5_000, 0]],
    ["dtrx:private-flow:private-transaction", ["string", -1, 0]],
    ["dtrx:private-flow:private-transaction:lock", ["string", 1_000, 0]],
    ["rr:cart:idempotency:v1:private-hash", ["string", 300_000, 0]],
    ["rr:cart:idempotency:v1:private-hash:lock", ["string", 15_000, 0]],
    ["unclassified:private-key", ["string", -1, 0]],
  ])
  const client = {
    scan: async () => ({ cursor: "0", keys: [...entries.keys()] }),
    type: async (key) => entries.get(key)[0],
    pTTL: async (key) => entries.get(key)[1],
    lLen: async (key) => entries.get(key)[2],
    zCard: async (key) => entries.get(key)[2],
  }
  const result = await collectRedisQueueAggregate({ client })
  assert.equal(result.scannedKeys, 8)
  assert.equal(result.queues.eventBus.states.wait, 2)
  assert.equal(result.queues.scheduledJobs.states.delayed, 3)
  assert.equal(result.categories.medusaLocks.ttl.under30Seconds, 1)
  assert.equal(result.categories.workflowCheckpoints.count, 1)
  assert.equal(result.categories.workflowCheckpointLocks.count, 1)
  assert.equal(result.categories.cartIdempotencyResults.count, 1)
  assert.equal(result.categories.cartIdempotencyLocks.count, 1)
  assert.equal(result.categories.other.count, 1)
  assert.doesNotMatch(JSON.stringify(result), /private/u)
})

test("recovery aggregate fails closed on scan, type, cap, and deadline violations", async () => {
  const client = {
    scan: async () => ({ cursor: "0", keys: [] }),
    type: async () => "string",
    pTTL: async () => -1,
  }
  for (const changed of [
    { ...client, scan: async () => ({ cursor: "invalid", keys: [] }) },
    { ...client, scan: async () => ({ cursor: "0", keys: ["a", "b"] }) },
    {
      ...client,
      scan: async () => ({
        cursor: "0",
        keys: ["RedisEventBusService:events-queue:wait"],
      }),
    },
    { ...client, scan: () => new Promise(() => undefined) },
  ]) {
    await assert.rejects(
      collectRedisQueueAggregate({
        client: changed,
        maxKeys: 1,
        timeoutMs: 20,
      }),
      { message: "Redis recovery aggregate unavailable." }
    )
  }
})

test("recovery aggregate refuses arbitrary and missing local sockets", async () => {
  for (const socketPath of [
    "/tmp/arbitrary/redis.sock",
    "/tmp/rr-redis-replay-missing/socket/redis.sock",
  ])
    await assert.rejects(collectIsolatedRedisQueueAggregate({ socketPath }), {
      message: "Redis recovery aggregate unavailable.",
    })
})

test("replay arguments require private absolute paths and pinned identities", () => {
  const args = argumentsFor(
    "/tmp/private/appendonlydir",
    "/tmp/private/capture.receipt.json",
    "d".repeat(64)
  )
  assert.deepEqual(
    parseReplayArguments(["--", ...args], {}),
    parseReplayArguments(args, {})
  )
  assert.equal(
    parseReplayArguments([...args, "--classify-failed-jobs"], {})
      .classifyFailedJobs,
    true
  )
  for (const changed of [
    args.slice(0, -2),
    [...args, "--image-id", imageId],
    argumentsFor("relative", args[3], args[5]),
    argumentsFor("/tmp/../private", args[3], args[5]),
    argumentsFor(args[1], "relative-receipt", args[5]),
    argumentsFor(args[1], args[3], "not-a-hash"),
    [...args.slice(0, -1), "redis:latest"],
    ["--classify-failed-jobs", ...args],
    [...args, "--classify-failed-jobs", "--classify-failed-jobs"],
  ])
    assert.throws(() => parseReplayArguments(changed, {}), {
      message: "Redis isolated replay unavailable.",
    })
  assert.equal(parseReplayArguments(["--help"], {}).mode, "help")
  assert.throws(
    () => parseReplayArguments(args, { REDIS_AOF_REPLAY_MAX_BYTES: "0" }),
    { message: "Redis isolated replay unavailable." }
  )
  assert.throws(
    () => parseReplayArguments(args, { REDIS_AOF_REPLAY_TIMEOUT_MS: "99" }),
    { message: "Redis isolated replay unavailable." }
  )
})

test("capture receipt binds exact manifest, file order, sizes, and rewrite restoration", () => {
  const valid = receipt()
  assert.deepEqual(
    validateCaptureReceipt(valid, Buffer.from(manifest), 1024),
    valid.files
  )
  for (const mutate of [
    (value) => {
      value.schemaVersion = 2
    },
    (value) => {
      value.rewriteRestored = false
    },
    (value) => {
      value.sourceFingerprint = "bad"
    },
    (value) => {
      value.runIdSha256 = "bad"
    },
    (value) => {
      value.source.instanceId = "changed"
    },
    (value) => {
      value.source.mountPath = "/different"
    },
    (value) => {
      value.manifestSha256 = "0".repeat(64)
    },
    (value) => {
      value.files[1].name = "../escape"
    },
    (value) => {
      value.files = []
    },
    (value) => {
      value.files[1].bytes += 1
    },
    (value) => {
      value.files[1].bytes = -1
    },
    (value) => {
      value.files[1].sha256 = "bad"
    },
    (value) => {
      value.totalBytes += 1
    },
    (value) => {
      value.files[0].sha256 = "0".repeat(64)
    },
  ]) {
    const changed = structuredClone(valid)
    mutate(changed)
    assert.throws(
      () => validateCaptureReceipt(changed, Buffer.from(manifest), 1024),
      { message: "Redis isolated replay unavailable." }
    )
  }
  assert.throws(() => validateCaptureReceipt(valid, Buffer.from(manifest), 1), {
    message: "Redis isolated replay unavailable.",
  })
})

test("tampered receipt and AOF fail before checker or target startup without raw output", async () => {
  const root = await mkdtemp(join(tmpdir(), "redis-replay-unit-"))
  const archive = join(root, "appendonlydir")
  await mkdir(archive, { mode: 0o700 })
  for (const [name, bytes] of content)
    await writeFile(join(archive, name), bytes, { mode: 0o600 })
  const receiptPath = join(root, "capture.receipt.json")
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt())}\n`)
  await writeFile(receiptPath, receiptBytes, { mode: 0o600 })
  const errors = []
  let dockerCalls = 0
  const runCommand = async (_command, args) => {
    dockerCalls += 1
    if (args.includes("context")) return '"unix:///var/run/docker.sock"'
    if (args.includes("image")) return `${imageId}|amd64|linux`
    if (args.includes("sha256sum"))
      return "c9ed119a46bfe87ace4048eb22479da7d3ca4857f0ea5b1d1729e212bc5aabca  /usr/local/bin/redis-check-aof"
    assert.fail(`unexpected Docker command: ${args[2]}`)
  }
  const options = {
    environment: { PATH: process.env.PATH, HOME: process.env.HOME },
    runCommand,
    verify: () => assert.fail("corrupt archive must not reach checker"),
    write: () => assert.fail("corrupt archive must not complete"),
    writeError: (line) => errors.push(line),
  }
  try {
    assert.equal(
      await runIsolatedRedisReplay({
        verifyDockerSocket: async () => undefined,
        ...options,
        args: argumentsFor(archive, receiptPath, "0".repeat(64)),
      }),
      1
    )
    assert.equal(dockerCalls, 0)
    assert.equal(JSON.parse(errors.at(-1)).phase, "receipt")
    await writeFile(join(archive, "appendonly.aof.1.incr.aof"), "corrupt", {
      mode: 0o600,
    })
    assert.equal(
      await runIsolatedRedisReplay({
        verifyDockerSocket: async () => undefined,
        ...options,
        args: argumentsFor(archive, receiptPath, hash(receiptBytes)),
      }),
      1
    )
    assert.equal(dockerCalls, 3)
    assert.equal(JSON.parse(errors.at(-1)).phase, "copy")
    assert.ok(
      errors.every((line) => !line.includes(root) && !line.includes("corrupt"))
    )
    assert.equal(
      (await readFile(receiptPath)).toString(),
      receiptBytes.toString()
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("unsafe source files and inventory never reach the checker", async () => {
  for (const variant of [
    "symlink",
    "hardlink",
    "public",
    "extra",
    "directory",
  ]) {
    const root = await mkdtemp(join(tmpdir(), "redis-replay-unsafe-"))
    const archive = join(root, "appendonlydir")
    await mkdir(archive, { mode: 0o700 })
    for (const [name, bytes] of content)
      await writeFile(join(archive, name), bytes, { mode: 0o600 })
    const receiptPath = join(root, "capture.receipt.json")
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt())}\n`)
    await writeFile(receiptPath, receiptBytes, { mode: 0o600 })
    const member = join(archive, "appendonly.aof.1.incr.aof")
    if (variant === "symlink") {
      await unlink(member)
      await symlink(join(archive, "appendonly.aof.1.base.rdb"), member)
    }
    if (variant === "hardlink") {
      await unlink(member)
      await link(join(archive, "appendonly.aof.1.base.rdb"), member)
    }
    if (variant === "public") await chmod(member, 0o644)
    if (variant === "extra")
      await writeFile(join(archive, "unexpected.aof"), "private", {
        mode: 0o600,
      })
    if (variant === "directory") await chmod(archive, 0o755)
    const errors = []
    let startup = false
    try {
      assert.equal(
        await runIsolatedRedisReplay({
          verifyDockerSocket: async () => undefined,
          args: argumentsFor(archive, receiptPath, hash(receiptBytes)),
          environment: { PATH: process.env.PATH, HOME: process.env.HOME },
          runCommand: async (_command, args) => {
            if (args.includes("context")) return '"unix:///var/run/docker.sock"'
            if (args.includes("image")) return `${imageId}|amd64|linux`
            if (args.includes("sha256sum"))
              return "c9ed119a46bfe87ace4048eb22479da7d3ca4857f0ea5b1d1729e212bc5aabca  /usr/local/bin/redis-check-aof"
            startup = true
            assert.fail("unsafe source reached Docker startup")
          },
          verify: () => assert.fail("unsafe source reached checker"),
          write: () => assert.fail("unsafe source completed"),
          writeError: (line) => errors.push(JSON.parse(line)),
        }),
        1
      )
      assert.equal(startup, false)
      assert.ok(["receipt", "copy"].includes(errors[0].phase))
      assert.equal(
        (await readFile(receiptPath)).toString(),
        receiptBytes.toString()
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test("failed target creation cleans only owned private copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "redis-replay-startup-"))
  const archive = join(root, "appendonlydir")
  await mkdir(archive, { mode: 0o700 })
  for (const [name, bytes] of content)
    await writeFile(join(archive, name), bytes, { mode: 0o600 })
  const receiptPath = join(root, "capture.receipt.json")
  const evidence = receipt()
  const receiptBytes = Buffer.from(`${JSON.stringify(evidence)}\n`)
  await writeFile(receiptPath, receiptBytes, { mode: 0o600 })
  const before = (await readdir("/tmp")).filter((name) =>
    name.startsWith("rr-redis-replay-")
  )
  const calls = []
  const errors = []
  try {
    assert.equal(
      await runIsolatedRedisReplay({
        verifyDockerSocket: async () => undefined,
        args: argumentsFor(archive, receiptPath, hash(receiptBytes)),
        environment: { PATH: process.env.PATH, HOME: process.env.HOME },
        runCommand: async (_command, args) => {
          calls.push(args)
          if (args.includes("context")) return '"unix:///var/run/docker.sock"'
          if (args.includes("image")) return `${imageId}|amd64|linux`
          if (args.includes("sha256sum"))
            return "c9ed119a46bfe87ace4048eb22479da7d3ca4857f0ea5b1d1729e212bc5aabca  /usr/local/bin/redis-check-aof"
          if (args.includes("--detach"))
            throw new Error("private target failure")
          if (args.includes("inspect")) throw new Error("no owned container")
          if (args.includes("ps")) return ""
          assert.fail("unexpected Docker command")
        },
        verify: async () => ({
          status: "verified",
          setSha256: hash(JSON.stringify(evidence.files)),
          manifestSha256: evidence.manifestSha256,
          totalBytes: evidence.totalBytes,
        }),
        write: () => assert.fail("failed target completed"),
        writeError: (line) => errors.push(JSON.parse(line)),
      }),
      1
    )
    assert.equal(errors[0].phase, "startup")
    assert.equal(
      calls.some((args) => args.includes("ps")),
      true
    )
    const after = (await readdir("/tmp")).filter((name) =>
      name.startsWith("rr-redis-replay-")
    )
    assert.deepEqual(after, before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("help and malformed receipt never contact Docker", async () => {
  const f = await fixture()
  const output = []
  const errors = []
  try {
    assert.equal(
      await runIsolatedRedisReplay({
        verifyDockerSocket: async () => undefined,
        args: ["--help"],
        runCommand: () => assert.fail("help contacted Docker"),
        write: (line) => output.push(line),
      }),
      0
    )
    assert.match(output[0], /worker-free Redis 8\.10\.1/u)
    await writeFile(f.receiptPath, "{private malformed receipt", {
      mode: 0o600,
    })
    const bytes = await readFile(f.receiptPath)
    assert.equal(
      await runIsolatedRedisReplay({
        verifyDockerSocket: async () => undefined,
        args: argumentsFor(f.archive, f.receiptPath, hash(bytes)),
        runCommand: () => assert.fail("malformed receipt contacted Docker"),
        writeError: (line) => errors.push(JSON.parse(line)),
      }),
      1
    )
    assert.equal(errors[0].phase, "receipt")
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("remote Docker context, image identity and checker drift fail before copying", async () => {
  const f = await fixture()
  const cases = [
    {
      context: '"tcp://remote:2375"',
      image: `${imageId}|amd64|linux`,
      checker: "valid",
    },
    {
      context: '"unix:///tmp/remote-proxy.sock"',
      image: `${imageId}|amd64|linux`,
      checker: "valid",
    },
    {
      context: '"unix:///var/run/docker.sock"',
      image: `${imageId}|amd64|linux`,
      checker: "valid",
      socket: "missing",
    },
    {
      context: '"unix:///var/run/docker.sock"',
      image: `${imageId}|arm64|linux`,
      checker: "valid",
    },
    {
      context: '"unix:///var/run/docker.sock"',
      image: `${imageId}|amd64|linux`,
      checker: "changed",
    },
  ]
  try {
    for (const value of cases) {
      const errors = []
      let detached = false
      assert.equal(
        await runIsolatedRedisReplay({
          verifyDockerSocket: async () => {
            if (value.socket === "missing")
              throw new Error("Synthetic local socket is unavailable.")
          },
          args: argumentsFor(f.archive, f.receiptPath, hash(f.receiptBytes)),
          environment: { PATH: process.env.PATH, HOME: process.env.HOME },
          runCommand: async (_command, args) => {
            if (args.includes("context")) return value.context
            if (args.includes("image")) return value.image
            if (args.includes("sha256sum"))
              return value.checker === "valid"
                ? "c9ed119a46bfe87ace4048eb22479da7d3ca4857f0ea5b1d1729e212bc5aabca  /usr/local/bin/redis-check-aof"
                : "0".repeat(64)
            detached = true
            assert.fail("untrusted Docker source reached target startup")
          },
          writeError: (line) => errors.push(JSON.parse(line)),
        }),
        1
      )
      assert.equal(detached, false)
      assert.equal(errors[0].phase, "docker_preflight")
    }
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("cleanup refuses an unowned container label and reports an incident", async () => {
  const f = await fixture()
  const id = "f".repeat(64)
  const errors = []
  const calls = []
  const before = (await readdir("/tmp")).filter((name) =>
    name.startsWith("rr-redis-replay-")
  )
  try {
    assert.equal(
      await runIsolatedRedisReplay({
        verifyDockerSocket: async () => undefined,
        args: argumentsFor(f.archive, f.receiptPath, hash(f.receiptBytes)),
        environment: { PATH: process.env.PATH, HOME: process.env.HOME },
        runCommand: async (_command, args) => {
          calls.push(args)
          if (args.includes("context")) return '"unix:///var/run/docker.sock"'
          if (args.includes("image")) return `${imageId}|amd64|linux`
          if (args.includes("sha256sum"))
            return "c9ed119a46bfe87ace4048eb22479da7d3ca4857f0ea5b1d1729e212bc5aabca  /usr/local/bin/redis-check-aof"
          if (args.includes("--detach")) return id
          if (args.includes("inspect") && args.includes("--format"))
            return "different-owner"
          if (args.includes("inspect"))
            throw new Error("synthetic inspect failure")
          assert.fail("an unowned container must not be removed")
        },
        verify: async () => ({
          status: "verified",
          setSha256: hash(JSON.stringify(f.evidence.files)),
          manifestSha256: f.evidence.manifestSha256,
          totalBytes: f.evidence.totalBytes,
        }),
        write: () => assert.fail("unverified cleanup completed"),
        writeError: (line) => errors.push(JSON.parse(line)),
      }),
      1
    )
    assert.equal(
      errors[0].event,
      "redis.aof_isolated_replay.cleanup_unverified"
    )
    assert.equal(
      calls.some((args) => args.includes("--force")),
      false
    )
  } finally {
    const after = (await readdir("/tmp")).filter((name) =>
      name.startsWith("rr-redis-replay-")
    )
    for (const name of after.filter((entry) => !before.includes(entry)))
      await rm(join("/tmp", name), { recursive: true, force: true })
    await rm(f.root, { recursive: true, force: true })
  }
})
