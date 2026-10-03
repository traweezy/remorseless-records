import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createHash } from "node:crypto"
import {
  main,
  parseTimedRecoveryArguments,
  runTimedRecovery,
} from "./postgres-timed-recovery.mjs"

const args = (directory = "/private/evidence") => [
  "--apply",
  "--base-dir",
  directory,
  "--source-scope",
  "/private/source.json",
  "--archive",
  "/private/source.dump",
  "--manifest",
  "/private/manifest.json",
  "--receipt",
  "/private/receipt.json",
  "--output-dir",
  directory,
]
const fixture = (fail) => {
  const calls = []
  const run = async (input, dependencies) => {
    const phase = input[0]
    calls.push({ phase, dependencies, input })
    if (phase === fail) throw new Error("private-canary")
    return {
      create: {
        status: "isolated_target_ready",
        targetDir: "/owned/target",
        sourceSystemId: "7527124368992473123",
        targetSystemId: "7692437023377469454",
        imageId: `sha256:${"a".repeat(64)}`,
      },
      preflight: {
        status: "isolated_preflight_verified",
        confirmation: "b".repeat(64),
        sourceChecksum: "c".repeat(64),
      },
      apply: {
        status: "isolated_restore_verified",
        sourceChecksum: "c".repeat(64),
        targetTables: 172,
        verifiedRows: 1000,
      },
      verify: {
        status: "isolated_restored_target_verified",
        targetSystemId: "7692437023377469454",
        imageId: `sha256:${"a".repeat(64)}`,
      },
      cleanup: { status: "isolated_target_removed" },
    }[phase]
  }
  let tick = 0
  return { calls, run, clock: () => tick++ * 10 }
}

test("timed drill preserves source, preflight and identity boundaries and cleans its target", async () => {
  const f = fixture()
  const report = await runTimedRecovery(parseTimedRecoveryArguments(args()), f)
  assert.equal(report.passed, true)
  assert.deepEqual(
    f.calls.map((c) => c.phase),
    ["create", "preflight", "apply", "verify", "cleanup"]
  )
  assert.equal(f.calls[2].input.at(-1), "b".repeat(64))
  assert.equal(report.targetTables, 172)
  assert.equal(report.archiveSha256, "c".repeat(64))
  assert.ok(report.recoveryDurationMs > 0)
  assert.ok(report.totalDurationMs > report.recoveryDurationMs)
  assert.equal(report.cleanupVerified, true)
  assert.equal(report.pitrVerified, false)
  assert.equal(report.offsiteVerified, false)
  assert.equal(report.applicationAccepted, false)
  assert.ok(f.calls[0].dependencies.signal)
  assert.equal(f.calls.at(-1).dependencies, undefined)
})

test("every failed phase withholds acceptance and only cleans a returned owned target", async () => {
  for (const phase of ["create", "preflight", "apply", "verify", "cleanup"]) {
    const f = fixture(phase)
    const report = await runTimedRecovery(
      parseTimedRecoveryArguments(args()),
      f
    )
    assert.equal(report.passed, false)
    assert.equal(report.phase, phase === "apply" ? "restore" : phase)
    assert.equal(
      f.calls.some((c) => c.phase === "cleanup"),
      phase !== "create"
    )
    assert.ok(!JSON.stringify(report).includes("private-canary"))
  }
})

test("checksum and restored identity changes fail even when the client returns success", async () => {
  for (const [phase, key] of [
    ["create", "targetSystemId"],
    ["apply", "sourceChecksum"],
    ["verify", "targetSystemId"],
    ["verify", "imageId"],
  ]) {
    const f = fixture()
    const original = f.run
    f.run = async (input, options) => {
      const result = await original(input, options)
      if (input[0] === phase)
        result[key] = phase === "create" ? result.sourceSystemId : "wrong"
      return result
    }
    assert.equal(
      (await runTimedRecovery(parseTimedRecoveryArguments(args()), f)).passed,
      false
    )
    assert.equal(f.calls.at(-1).phase, "cleanup")
  }
})

test("cancellation after creation still cleans up and never starts restore", async () => {
  const f = fixture()
  const original = f.run
  const controller = new AbortController()
  f.run = async (input, options) => {
    const result = await original(input, options)
    if (input[0] === "create") controller.abort()
    return result
  }
  const result = await runTimedRecovery(parseTimedRecoveryArguments(args()), {
    ...f,
    signal: controller.signal,
  })
  assert.equal(result.passed, false)
  assert.deepEqual(
    f.calls.map((c) => c.phase),
    ["create", "cleanup"]
  )
})

test("elapsed time exceeding the RTO cannot publish a passing drill", async () => {
  const f = fixture()
  let tick = 0
  f.clock = () => tick++ * 500
  const report = await runTimedRecovery(
    parseTimedRecoveryArguments([...args(), "--max-duration-ms", "1000"]),
    f
  )
  assert.equal(report.passed, false)
  assert.equal(f.calls.at(-1).phase, "cleanup")
})

test("only a fully verified and cleaned drill publishes a private checksummed receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-timed-"))
  try {
    const result = await main(args(directory), fixture())
    assert.equal(result.passed, true)
    const bytes = await readFile(result.receipt)
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      result.receiptSha256
    )
    assert.equal((await stat(result.receipt)).mode & 0o077, 0)
    assert.equal(JSON.parse(bytes).cleanupVerified, true)
    const before = await readdir(directory)
    assert.equal((await main(args(directory), fixture("apply"))).passed, false)
    assert.deepEqual(await readdir(directory), before)
    const controller = new AbortController()
    const f = fixture()
    const original = f.run
    f.run = async (input, options) => {
      const value = await original(input, options)
      if (input[0] === "cleanup") controller.abort()
      return value
    }
    await assert.rejects(
      main(args(directory), { ...f, signal: controller.signal })
    )
    assert.deepEqual(await readdir(directory), before)
  } finally {
    await rm(directory, { recursive: true })
  }
})

test("unsafe/missing arguments fail before resources or provider access", async () => {
  for (const input of [
    [],
    args().slice(1),
    [...args(), "--apply"],
    [...args(), "--unknown", "private-canary"],
    [...args(), "--max-duration-ms", "0"],
    [...args(), "--max-duration-ms", "3600001"],
    [...args(), "--max-duration-ms", "1e3"],
    args().map((v) => (v === "/private/source.dump" ? "relative" : v)),
    [...args(), "--max-duration-ms"],
  ]) {
    assert.throws(() => parseTimedRecoveryArguments(input))
  }
  assert.ok((await main(["--", "--help"])).help)
  const script = new URL("./postgres-timed-recovery.mjs", import.meta.url)
    .pathname
  assert.equal(spawnSync(process.execPath, [script, "--help"]).status, 0)
  const failed = spawnSync(process.execPath, [script, "private-canary"], {
    encoding: "utf8",
  })
  assert.equal(failed.status, 1)
  assert.equal(failed.stdout, "")
  assert.ok(!failed.stderr.includes("private-canary"))
})
