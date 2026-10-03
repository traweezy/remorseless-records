import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { open, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import { openPrivateOutputDirectory } from "./lib/postgres-snapshot.mjs"
import { main as isolatedTarget } from "./postgres-isolated-target.mjs"

const help = `Usage: postgres-timed-recovery --apply --base-dir <private-dir>
  --source-scope <path> --archive <path> --manifest <path> --receipt <path>
  --output-dir <private-dir> [--max-duration-ms <1000..3600000>]
Creates, restores, verifies and removes an owned network-isolated PostgreSQL 16
target. Uses the existing source/empty-target/checksum guards. Measures logical
database recovery only; does not prove PITR, off-site recovery or provider/worker
acceptance. Successful evidence is published only after owned-target cleanup.
`
const paths = [
  "--base-dir",
  "--source-scope",
  "--archive",
  "--manifest",
  "--receipt",
  "--output-dir",
]
export const parseTimedRecoveryArguments = (input) => {
  const args = normalizeScriptArguments(input)
  if (args.length === 1 && args[0] === "--help") return { help }
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    assert.ok([...paths, "--apply", "--max-duration-ms"].includes(key))
    assert.ok(!Object.hasOwn(options, key))
    options[key] = key === "--apply" ? true : args[++index]
    if (key !== "--apply") assert.equal(typeof options[key], "string")
  }
  assert.equal(options["--apply"], true)
  for (const key of paths) {
    assert.equal(typeof options[key], "string")
    assert.equal(resolve(options[key]), options[key])
  }
  const budget = options["--max-duration-ms"] ?? "3600000"
  assert.match(budget, /^[1-9]\d*$/u)
  options.maximumDurationMs = Number(budget)
  assert.ok(Number.isSafeInteger(options.maximumDurationMs))
  assert.ok(
    options.maximumDurationMs >= 1000 && options.maximumDurationMs <= 3_600_000
  )
  return options
}

export const runTimedRecovery = async (
  options,
  { run = isolatedTarget, signal, clock = () => performance.now() } = {}
) => {
  const startedAt = new Date().toISOString()
  const started = clock()
  let phase = "create"
  let target
  let report
  let failure
  const phases = {}
  const deadline = AbortSignal.timeout(options.maximumDurationMs)
  const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  const step = async (name, args) => {
    phase = name
    boundedSignal.throwIfAborted()
    const from = clock()
    const result = await run(args, { signal: boundedSignal })
    // Retain ownership before observing cancellation after creation.
    if (name === "create") target = result
    boundedSignal.throwIfAborted()
    phases[name] = Math.ceil(clock() - from)
    return result
  }
  try {
    target = await step("create", [
      "create",
      ...paths
        .filter((key) => key !== "--output-dir")
        .flatMap((key) => [key, options[key]]),
    ])
    assert.equal(target.status, "isolated_target_ready")
    assert.notEqual(target.sourceSystemId, target.targetSystemId)
    const preflight = await step("preflight", [
      "preflight",
      "--target-dir",
      target.targetDir,
    ])
    assert.equal(preflight.status, "isolated_preflight_verified")
    const restored = await step("restore", [
      "apply",
      "--target-dir",
      target.targetDir,
      "--confirm",
      preflight.confirmation,
    ])
    assert.equal(restored.status, "isolated_restore_verified")
    assert.equal(restored.sourceChecksum, preflight.sourceChecksum)
    const verified = await step("verify", [
      "verify",
      "--target-dir",
      target.targetDir,
    ])
    assert.equal(verified.status, "isolated_restored_target_verified")
    assert.equal(verified.targetSystemId, target.targetSystemId)
    assert.equal(verified.imageId, target.imageId)
    const recoveryDurationMs = Math.ceil(clock() - started)
    assert.ok(recoveryDurationMs <= options.maximumDurationMs)
    report = {
      schemaVersion: 1,
      passed: true,
      recoveryScope: "isolated_logical_database",
      startedAt,
      verifiedAt: new Date().toISOString(),
      recoveryDurationMs,
      maximumDurationMs: options.maximumDurationMs,
      phases,
      imageId: target.imageId,
      sourceSystemId: target.sourceSystemId,
      targetSystemId: target.targetSystemId,
      archiveSha256: restored.sourceChecksum,
      targetTables: restored.targetTables,
      verifiedRows: restored.verifiedRows,
      pitrVerified: false,
      offsiteVerified: false,
      applicationAccepted: false,
    }
  } catch {
    failure = phase
  } finally {
    if (target?.targetDir) {
      const from = clock()
      try {
        // Cleanup has its own bounded command timeouts in the target runner;
        // an expired recovery deadline must not strand owned resources.
        const removed = await run(["cleanup", "--target-dir", target.targetDir])
        assert.equal(removed.status, "isolated_target_removed")
        phases.cleanup = Math.ceil(clock() - from)
      } catch {
        failure = "cleanup"
      }
    }
  }
  if (failure)
    return {
      passed: false,
      phase: failure,
      durationMs: Math.ceil(clock() - started),
    }
  boundedSignal.throwIfAborted()
  return {
    ...report,
    cleanupVerified: true,
    totalDurationMs: Math.ceil(clock() - started),
  }
}

export const main = async (args, dependencies = {}) => {
  const options = parseTimedRecoveryArguments(args)
  if (options.help) return options
  const output = await openPrivateOutputDirectory(options["--output-dir"])
  let filename
  let owned = false
  try {
    const report = await runTimedRecovery(options, dependencies)
    if (!report.passed) return report
    await output.assertStable()
    dependencies.signal?.throwIfAborted()
    filename = `postgres-timed-recovery-${randomUUID()}.json`
    const bytes = `${JSON.stringify(report, null, 2)}\n`
    const file = await open(join(output.descriptorPath, filename), "wx", 0o600)
    owned = true
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await output.sync()
    await output.assertStable()
    dependencies.signal?.throwIfAborted()
    return {
      ...report,
      receipt: join(options["--output-dir"], filename),
      receiptSha256: createHash("sha256").update(bytes).digest("hex"),
    }
  } catch {
    if (owned) await rm(join(output.descriptorPath, filename))
    throw new Error("Timed recovery evidence unavailable")
  } finally {
    await output.close()
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.on("SIGINT", abort)
  process.on("SIGTERM", abort)
  try {
    const result = await main(process.argv.slice(2), {
      signal: controller.signal,
    })
    console.log(result.help ?? JSON.stringify(result))
    if (!result.help && !result.passed) process.exitCode = 2
  } catch {
    console.error(JSON.stringify({ passed: false, phase: "timed_recovery" }))
    process.exitCode = 1
  } finally {
    process.off("SIGINT", abort)
    process.off("SIGTERM", abort)
  }
}
