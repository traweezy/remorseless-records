import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  openPostgresSnapshot,
  openPrivateOutputDirectory,
} from "./lib/postgres-snapshot.mjs"

test("private directory descriptor stays bound after pathname replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rr-snapshot-anchor-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const parent = join(root, "parent")
  const output = join(parent, "output")
  const moved = join(root, "moved")
  await mkdir(output, { recursive: true, mode: 0o700 })
  const anchor = await openPrivateOutputDirectory(output)
  try {
    await writeFile(join(anchor.descriptorPath, "pinned"), "original", {
      flag: "wx",
      mode: 0o600,
    })
    await rename(parent, moved)
    await mkdir(output, { recursive: true, mode: 0o700 })
    await writeFile(join(output, "pinned"), "replacement", {
      flag: "wx",
      mode: 0o600,
    })
    assert.equal(
      await readFile(join(anchor.descriptorPath, "pinned"), "utf8"),
      "original"
    )
    assert.equal(await readFile(join(output, "pinned"), "utf8"), "replacement")
    await assert.rejects(anchor.assertStable())
  } finally {
    await anchor.close()
  }
})

const exporterProcess = (closeMode) => {
  const child = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdout = new EventEmitter()
  const commands = []
  const signals = []
  child.stdin.write = (text) => {
    commands.push(text)
    queueMicrotask(() => child.stdout.emit("data", Buffer.from("00000003-1\n")))
  }
  child.stdin.end = (text) => {
    commands.push(text)
    if (closeMode === "throw") throw new Error("Private transport failure")
    if (closeMode !== "stall")
      queueMicrotask(() =>
        child.emit("close", closeMode === "success" ? 0 : 1, null)
      )
  }
  child.kill = (signal) => {
    signals.push(signal)
    queueMicrotask(() => child.emit("close", null, signal))
    return true
  }
  return {
    child,
    commands,
    signals,
    spawnProcess: () => child,
  }
}

test("normal snapshot close releases its transaction and awaits clean exit once", async () => {
  const process = exporterProcess("success")
  const exporter = await openPostgresSnapshot({
    environment: {},
    signal: new AbortController().signal,
    spawnProcess: process.spawnProcess,
  })
  exporter.assertOpen()
  const closing = exporter.close()
  assert.equal(exporter.close(), closing)
  assert.throws(() => exporter.assertOpen())
  await closing
  assert.equal(process.commands.length, 2)
  assert.match(process.commands[0], /REPEATABLE READ READ ONLY/u)
  assert.equal(process.commands[1], "ROLLBACK;\n\\q\n")
  assert.deepEqual(process.signals, [])
})

for (const mode of ["failure", "throw"]) {
  test(`snapshot ${mode} close rejects success only after owned child exit`, async () => {
    const process = exporterProcess(mode)
    const exporter = await openPostgresSnapshot({
      environment: {},
      signal: new AbortController().signal,
      spawnProcess: process.spawnProcess,
    })
    await assert.rejects(exporter.close(), /did not close cleanly/u)
    assert.deepEqual(process.signals, mode === "throw" ? ["SIGKILL"] : [])
    assert.throws(() => exporter.assertOpen())
  })
}

test("stalled snapshot close has a five-second owned-child backstop", {
  timeout: 10000,
}, async () => {
  const process = exporterProcess("stall")
  const exporter = await openPostgresSnapshot({
    environment: {},
    signal: new AbortController().signal,
    spawnProcess: process.spawnProcess,
  })
  const started = performance.now()
  await assert.rejects(exporter.close(), /did not close cleanly/u)
  assert.ok(performance.now() - started >= 4900)
  assert.deepEqual(process.signals, ["SIGKILL"])
  assert.throws(() => exporter.assertOpen())
})
