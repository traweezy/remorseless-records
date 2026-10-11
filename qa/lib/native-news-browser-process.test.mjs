import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { test } from "node:test"

import { trackNativeNewsBrowserProcess } from "./native-news-browser-process.mjs"

const owned = async (t, code = "process.stdin.resume()") => {
  const child = spawn(process.execPath, ["-e", code], {
    stdio: ["pipe", "pipe", "pipe"],
  })
  await once(child, "spawn")
  const close = once(child, "close")
  t.after(async () => {
    if (!child.stdin.destroyed) child.stdin.end()
    await close
  })
  return { child, close }
}

test("records actual owned PID/start ticks and observes natural reaping", async (t) => {
  const { child, close } = await owned(t)
  const tracker = await trackNativeNewsBrowserProcess(child)
  const before = await tracker.capture()
  assert.equal(before[0].pid, child.pid)
  assert.match(before[0].startTicks, /^\d+$/u)
  assert.equal(Object.isFrozen(before[0]), true)
  assert.throws(() => {
    before[0].startTicks = "changed"
  }, TypeError)
  const snapshot = tracker.snapshot()
  assert.equal(Object.isFrozen(snapshot.root), true)
  assert.throws(() => {
    snapshot.root.pid = 1
  }, TypeError)
  child.stdin.end()
  assert.deepEqual(await close, [0, null])
  assert.equal(Object.isFrozen(tracker.snapshot().close), true)
  assert.throws(() => {
    tracker.snapshot().close.signal = "SIGTERM"
  }, TypeError)
  const proof = await tracker.verifyNaturalClosure()
  assert.equal(proof.root.pid, child.pid)
  assert.equal(proof.naturalClose, true)
  assert.ok(proof.processes.every((process) => process.originalAbsent))
})

test("a still-live owned process fails the bounded close check", async (t) => {
  const { child, close } = await owned(t)
  const tracker = await trackNativeNewsBrowserProcess(child)
  await assert.rejects(
    tracker.verifyNaturalClosure(25),
    /Owned browser close was not observed/u
  )
  assert.equal(tracker.snapshot().close, null)
  assert.equal(child.exitCode, null)
  child.stdin.end()
  await close
  assert.equal((await tracker.verifyNaturalClosure()).naturalClose, true)
})

test("records an actual owned descendant and verifies its natural removal", async (t) => {
  const { child, close } = await owned(
    t,
    `
    const { spawn } = require("node:child_process")
    const nested = spawn(process.execPath, ["-e", "process.stdin.resume()"], {stdio:["pipe","ignore","ignore"]})
    nested.once("spawn", () => process.stdout.write(String(nested.pid) + "\\n"))
    process.stdin.resume()
    process.stdin.once("end", () => nested.stdin.end())
  `
  )
  const announced = new Promise((done) => {
    child.stdout.once("data", (bytes) => done(Number(bytes.toString().trim())))
  })
  const tracker = await trackNativeNewsBrowserProcess(child)
  const descendantPid = await announced
  const processes = await tracker.capture()
  const descendant = processes.find(
    (identity) => identity.pid === descendantPid
  )
  assert.ok(descendant)
  assert.equal(descendant.parentPid, child.pid)
  assert.equal(Object.isFrozen(descendant), true)
  assert.throws(() => {
    descendant.startTicks = "changed"
  }, TypeError)
  child.stdin.end()
  assert.deepEqual(await close, [0, null])
  const proof = await tracker.verifyNaturalClosure()
  assert.equal(proof.processes.length, 2)
  assert.ok(proof.processes.every((identity) => identity.originalAbsent))
})

test("a signaled exit is not reported as natural cleanup", async (t) => {
  const { child, close } = await owned(t)
  const tracker = await trackNativeNewsBrowserProcess(child)
  assert.equal(child.kill("SIGTERM"), true)
  await close
  await assert.rejects(tracker.verifyNaturalClosure(), /deep-equal/u)
  assert.equal(tracker.snapshot().close.signal, "SIGTERM")
})

const delayedOwnedDescendant = async (t) => {
  const { child, close } = await owned(
    t,
    `
    const { spawn } = require("node:child_process")
    const nested = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 600)"], {stdio:"ignore"})
    nested.once("spawn", () => process.stdout.write(String(nested.pid) + "\\n"))
    process.stdin.resume()
    process.stdin.once("end", () => process.exit(0))
  `
  )
  const announced = new Promise((done) => {
    child.stdout.once("data", (bytes) => done(Number(bytes.toString().trim())))
  })
  const tracker = await trackNativeNewsBrowserProcess(child)
  const descendantPid = await announced
  const identities = await tracker.capture()
  assert.ok(identities.some((identity) => identity.pid === descendantPid))
  // Both processes exit on their own. Retain a final join even when the
  // original verifier rejects before the descendant has finished.
  t.after(async () => {
    await new Promise((done) => setTimeout(done, 700))
  })
  child.stdin.end()
  assert.deepEqual(await close, [0, null])
  return tracker
}

test("joins observed descendants that exit naturally after the root closes", async (t) => {
  const tracker = await delayedOwnedDescendant(t)
  const proof = await tracker.verifyNaturalClosure(2_000)
  assert.equal(proof.naturalClose, true)
  assert.equal(proof.processes.length, 2)
  assert.ok(proof.processes.every((identity) => identity.originalAbsent))
})

test("a remaining descendant still fails the original bounded deadline", async (t) => {
  const tracker = await delayedOwnedDescendant(t)
  await assert.rejects(
    tracker.verifyNaturalClosure(25),
    /An observed original browser process remains after close/u
  )
  const proof = await tracker.verifyNaturalClosure(2_000)
  assert.ok(proof.processes.every((identity) => identity.originalAbsent))
})
