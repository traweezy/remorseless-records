import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  createRecoveryScope,
  parseRecoveryArguments,
  recoveryEnvironment,
  recoveryTimeoutMs,
  runRecoveryCommand,
} from "./lib/recovery-process.mjs"

test("validates overall recovery deadlines without silently accepting partial numbers", () => {
  assert.equal(recoveryTimeoutMs(undefined), 1_800_000)
  assert.equal(recoveryTimeoutMs("100"), 100)
  assert.equal(recoveryTimeoutMs("14400000"), 14_400_000)
  for (const raw of [
    "",
    "0",
    "99",
    "14400001",
    "Infinity",
    "1e3",
    "100ms",
    " 100",
    "0100",
  ])
    assert.throws(() => recoveryTimeoutMs(raw))
})

test("argument parsing rejects unknown, duplicate, missing, and conflicting flags", () => {
  assert.deepEqual(
    parseRecoveryArguments(
      ["--archive", "/archive", "--apply"],
      ["--archive"],
      true
    ),
    { "--archive": "/archive", apply: true }
  )
  for (const args of [
    [],
    ["--archive"],
    ["--archive", "--apply"],
    ["--archive", "/a", "--archive", "/b"],
    ["--archive", "/a", "--aply"],
    ["--archive", "/a", "--apply", "--apply"],
  ])
    assert.throws(() => parseRecoveryArguments(args, ["--archive"], true))
  assert.throws(() => parseRecoveryArguments(["--apply"], [], false))
})

test("child environments contain only reviewed runtime and connection fields", () => {
  assert.deepEqual(
    recoveryEnvironment(
      { environment: { PGHOST: "localhost", PGPASSWORD: "fixture-password" } },
      {
        HOME: "/fixture",
        PATH: "/bin",
        LANG: "host-locale",
        PGHOST: "unexpected-host",
        PGOPTIONS: "unexpected-options",
        DATABASE_URL: "private-url",
        UNRELATED_SECRET: "private-secret",
      }
    ),
    {
      HOME: "/fixture",
      PATH: "/bin",
      LANG: "C",
      PGHOST: "localhost",
      PGPASSWORD: "fixture-password",
    }
  )
  assert.equal("HOME" in recoveryEnvironment({ environment: {} }, {}), false)
})

const invoke = (code, overrides = {}) =>
  runRecoveryCommand(process.execPath, ["-e", code], {
    environment: {},
    signal: AbortSignal.timeout(3000),
    ...overrides,
  })

test("bounded runner captures stdout and never forwards raw stderr", async () => {
  assert.equal(
    await invoke(
      'console.error("private-database-name"); console.log("accepted")'
    ),
    "accepted"
  )
  await assert.rejects(
    invoke('console.error("private-password"); process.exit(7)'),
    (error) => {
      assert.doesNotMatch(error.message, /private-password/u)
      return true
    }
  )
})

test("runner rejects missing executables, pre-abort, nonzero exits, and output overflow", async () => {
  await assert.rejects(
    runRecoveryCommand("/nonexistent/remorseless-recovery-executable", [], {
      environment: {},
      signal: AbortSignal.timeout(3000),
    })
  )
  await assert.rejects(
    invoke("process.exit(0)", { signal: AbortSignal.abort() })
  )
  await assert.rejects(
    invoke('process.stdout.write("x".repeat(10000))', { maxOutputBytes: 64 })
  )
})

test("deadline kills and reaps a client which ignores SIGTERM before returning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recovery-process-"))
  try {
    const path = join(directory, "pid")
    const scope = createRecoveryScope(500)
    try {
      await assert.rejects(
        invoke(
          `require('node:fs').writeFileSync(${JSON.stringify(path)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`,
          { signal: scope.signal }
        )
      )
      const pid = Number(await readFile(path, "utf8"))
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
    } finally {
      scope.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("scope restores signal listeners after successful completion", () => {
  const before = [
    process.listenerCount("SIGINT"),
    process.listenerCount("SIGTERM"),
  ]
  const scope = createRecoveryScope(3000)
  assert.equal(scope.signal.aborted, false)
  scope.close()
  assert.deepEqual(
    [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")],
    before
  )
})
