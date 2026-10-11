import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { performance } from "node:perf_hooks"
import { setTimeout as pause } from "node:timers/promises"

const processIdentity = async (pid) => {
  assert.ok(Number.isSafeInteger(pid) && pid > 0)
  try {
    const text = await readFile(`/proc/${pid}/stat`, "utf8")
    const fields = text.slice(text.lastIndexOf(")") + 2).split(" ")
    assert.match(fields[19], /^\d+$/u)
    const parentPid = Number(fields[1])
    assert.ok(Number.isSafeInteger(parentPid) && parentPid >= 0)
    return Object.freeze({ pid, parentPid, startTicks: fields[19] })
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(error.code)) return null
    throw error
  }
}

// Track only the returned owned ChildProcess and descendants observed under
// that identity. Never send a signal or infer ownership from a process name.
export const trackNativeNewsBrowserProcess = async (child) => {
  assert.ok(child && Number.isSafeInteger(child.pid) && child.pid > 0)
  const observed = new Map()
  let close = null
  let childError = false
  const closed = new Promise((done) => {
    child.once("error", () => {
      childError = true
    })
    child.once("close", (code, signal) => {
      close = Object.freeze({ code, signal })
      done(close)
    })
  })
  const root = await processIdentity(child.pid)
  assert.ok(root, "Returned owned browser process must be alive")
  observed.set(root.pid, root)

  const capture = async () => {
    const currentRoot = await processIdentity(root.pid)
    assert.deepEqual(
      currentRoot,
      root,
      "Owned browser process identity changed before closure"
    )
    const candidates = new Map()
    for (const entry of await readdir("/proc")) {
      if (!/^\d+$/u.test(entry)) continue
      const identity = await processIdentity(Number(entry))
      if (identity) candidates.set(identity.pid, identity)
    }
    assert.deepEqual(
      candidates.get(root.pid),
      root,
      "Owned browser identity changed during inventory"
    )
    const current = new Set([root.pid])
    for (let added = true; added; ) {
      added = false
      for (const identity of candidates.values()) {
        if (current.has(identity.pid) || !current.has(identity.parentPid))
          continue
        current.add(identity.pid)
        added = true
      }
    }
    assert.deepEqual(
      await processIdentity(root.pid),
      root,
      "Owned browser identity changed before inventory was retained"
    )
    for (const pid of current) {
      const identity = candidates.get(pid)
      const prior = observed.get(pid)
      if (prior)
        assert.equal(
          prior.startTicks,
          identity.startTicks,
          "An observed browser descendant PID was reused"
        )
    }
    assert.ok(
      new Set([...observed.keys(), ...current]).size <= 256,
      "Owned browser process inventory exceeded its bound"
    )
    for (const pid of current) observed.set(pid, candidates.get(pid))
    return [...observed.values()].sort((a, b) => a.pid - b.pid)
  }
  const snapshot = () => ({
    root,
    observedProcesses: [...observed.values()].sort((a, b) => a.pid - b.pid),
    close,
    childError,
    limitation:
      "Only the returned browser PID and descendants observed while it was alive are tracked; short-lived unobserved descendants are not inferred.",
  })
  const verifyNaturalClosure = async (timeoutMs = 10_000) => {
    assert.ok(
      Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10_000
    )
    const deadline = performance.now() + timeoutMs
    let timer
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Owned browser close was not observed")),
            timeoutMs
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    assert.equal(childError, false, "Owned browser ChildProcess emitted error")
    assert.deepEqual(close, { code: 0, signal: null })
    // The root's ChildProcess close event can precede an observed renderer's
    // natural removal. Join that removal within the same total deadline;
    // every original PID/start-tick pair must still be absent, without signals.
    for (;;) {
      const processes = []
      for (const identity of observed.values()) {
        const current = await processIdentity(identity.pid)
        const originalAbsent =
          current === null || current.startTicks !== identity.startTicks
        processes.push({ ...identity, originalAbsent })
      }
      if (processes.every((identity) => identity.originalAbsent)) {
        assert.ok(
          performance.now() <= deadline,
          "Owned browser removal exceeded its deadline"
        )
        return { ...snapshot(), naturalClose: true, processes }
      }
      const remainingMs = deadline - performance.now()
      assert.ok(
        remainingMs > 0,
        "An observed original browser process remains after close"
      )
      await pause(Math.min(25, remainingMs))
    }
  }
  return { capture, snapshot, verifyNaturalClosure }
}
