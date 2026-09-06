import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"

import { isSafeMediaObjectKey, validateMediaEndpoint } from "./media-backup.mjs"

export const hashMediaStream = async (stream, { expectedBytes, signal }) => {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
    throw new Error("Media object size is invalid.")
  }
  const hash = createHash("sha256")
  let bytes = 0
  const sink = new Writable({
    write: (chunk, _encoding, done) => {
      bytes += chunk.length
      if (bytes > expectedBytes) {
        done(new Error("Media object exceeded its inventoried size."))
        return
      }
      hash.update(chunk)
      done()
    },
  })
  await pipeline(stream, sink, { signal })
  if (bytes !== expectedBytes) {
    throw new Error("Media object was shorter than its inventoried size.")
  }
  return { bytes, sha256: hash.digest("hex") }
}

export const hashMcObject = async (
  { endpoint, key, expectedBytes, signal },
  start = spawn
) => {
  validateMediaEndpoint(endpoint, "Media endpoint")
  if (!isSafeMediaObjectKey(key)) throw new Error("Media object key is unsafe.")
  if (signal.aborted)
    throw new Error("Media object verification was cancelled.")
  let child
  try {
    child = start("mc", ["cat", `${endpoint}/${key}`], {
      stdio: ["ignore", "pipe", "ignore"],
      signal,
      killSignal: "SIGKILL",
    })
  } catch {
    throw new Error("Media object reader could not start.")
  }
  let failed = false
  const completion = new Promise((resolve, reject) => {
    // Abort emits error before close. Wait for close so a failed verification
    // cannot finish while its credential-bearing child remains alive.
    child.once("error", () => {
      failed = true
    })
    child.once("close", (code) =>
      !failed && code === 0
        ? resolve()
        : reject(new Error("Media object reader exited unsuccessfully."))
    )
  })
  try {
    const [result] = await Promise.all([
      hashMediaStream(child.stdout, { expectedBytes, signal }),
      completion,
    ])
    return result
  } catch {
    // Never print provider stderr, object paths, credentials, or raw child errors.
    throw new Error("Media object content could not be verified.")
  } finally {
    child.stdout.destroy()
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL")
    await completion.catch(() => undefined)
  }
}
