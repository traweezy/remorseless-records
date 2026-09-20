import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

export const evidenceLimit = 32 * 1024 * 1024
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex")
export const evidenceDigest = (name, value) => ({
  file: name,
  bytes: Buffer.byteLength(value),
  sha256: sha256(value),
})
export const decodeEvidence = (source) => {
  assert.ok(
    Buffer.byteLength(source) > 0 && Buffer.byteLength(source) <= evidenceLimit
  )
  return JSON.parse(
    typeof source === "string"
      ? source
      : new TextDecoder("utf-8", { fatal: true }).decode(source)
  )
}
const sameIdentity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino
const unchangedFile = (before, after) => {
  for (const name of [
    "dev",
    "ino",
    "mode",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs",
  ])
    assert.equal(after[name], before[name])
}
const fileInfo = (info, limit, privateMode) => {
  assert.ok(
    info.isFile() &&
      info.nlink === 1n &&
      info.size > 0n &&
      info.size <= BigInt(limit)
  )
  if (privateMode) assert.equal(info.mode & 0o077n, 0n)
}

// Linux CI only. The open directory descriptor, rather than a checked path,
// anchors child IO even if another process replaces the named parent directory.
export const openEvidenceDirectory = async (directory, privateMode = false) => {
  assert.ok(isAbsolute(directory) && resolve(directory) === directory)
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  const anchor = `/proc/self/fd/${handle.fd}`
  const info = await handle.stat({ bigint: true })
  const check = async () => {
    assert.ok(info.isDirectory())
    const current = await handle.stat({ bigint: true })
    assert.ok(sameIdentity(info, current))
    if (privateMode) assert.equal(current.mode & 0o077n, 0n)
    assert.equal(await readlink(anchor), directory)
    assert.equal(await realpath(directory), directory)
    const named = await lstat(directory, { bigint: true })
    assert.ok(named.isDirectory() && sameIdentity(info, named))
  }
  try {
    await check()
  } catch (error) {
    await handle.close()
    throw error
  }
  return { handle, anchor, info, check }
}
export const checkedEvidenceDirectory = async (
  directory,
  privateMode = false
) => {
  const opened = await openEvidenceDirectory(directory, privateMode)
  try {
    return { dev: opened.info.dev, ino: opened.info.ino }
  } finally {
    await opened.handle.close()
  }
}
export const assertEvidenceFileAbsent = async (file) => {
  const parent = await openEvidenceDirectory(dirname(file), true)
  try {
    try {
      await lstat(join(parent.anchor, basename(file)))
      assert.fail("Failed runtime evidence session cannot be accepted.")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    await parent.check()
  } finally {
    await parent.handle.close()
  }
}
export const createEvidenceDirectory = async (directory) => {
  const parent = await openEvidenceDirectory(dirname(directory))
  try {
    await mkdir(join(parent.anchor, basename(directory)), { mode: 0o700 })
    await parent.check()
    return await checkedEvidenceDirectory(directory, true)
  } finally {
    await parent.handle.close()
  }
}

const withEvidenceFile = async (file, flags, privateMode, operation) => {
  assert.ok(isAbsolute(file) && resolve(file) === file)
  const parent = await openEvidenceDirectory(dirname(file), privateMode)
  let handle
  try {
    const anchored = join(parent.anchor, basename(file))
    handle = await open(anchored, flags | constants.O_NOFOLLOW, 0o600)
    const before = await handle.stat({ bigint: true })
    await parent.check()
    const result = await operation(handle, before)
    const after = await handle.stat({ bigint: true })
    const named = await lstat(anchored, { bigint: true })
    assert.ok(
      named.isFile() && sameIdentity(after, named) && named.nlink === 1n
    )
    await parent.check()
    return result
  } finally {
    await handle?.close()
    await parent.handle.close()
  }
}
export const readEvidenceFile = (
  file,
  limit = evidenceLimit,
  { privateMode = true } = {}
) =>
  withEvidenceFile(
    file,
    constants.O_RDONLY,
    privateMode,
    async (handle, before) => {
      fileInfo(before, limit, privateMode)
      const chunks = []
      let bytes = 0
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        bytes += chunk.length
        assert.ok(bytes <= limit)
        chunks.push(chunk)
      }
      const result = Buffer.concat(chunks)
      unchangedFile(before, await handle.stat({ bigint: true }))
      assert.equal(BigInt(result.length), before.size)
      return result
    }
  )
export const writeEvidenceFile = async (directory, name, source) => {
  assert.match(name, /^[a-z][a-z0-9.-]*\.json$/u)
  assert.ok(
    Buffer.byteLength(source) > 0 && Buffer.byteLength(source) <= evidenceLimit
  )
  return withEvidenceFile(
    join(directory, name),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    true,
    async (handle) => {
      await handle.writeFile(source)
      await handle.sync()
      const written = await handle.stat({ bigint: true })
      fileInfo(written, evidenceLimit, true)
      assert.equal(written.size, BigInt(Buffer.byteLength(source)))
      return evidenceDigest(name, source)
    }
  )
}
// Stream the DB: retaining a second gigabyte-sized buffer would exhaust CI RAM.
export const hashEvidenceFile = (file, limit, { privateMode = true } = {}) =>
  withEvidenceFile(
    file,
    constants.O_RDONLY,
    privateMode,
    async (handle, before) => {
      fileInfo(before, limit, privateMode)
      const hash = createHash("sha256")
      let bytes = 0
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        bytes += chunk.length
        assert.ok(bytes <= limit)
        hash.update(chunk)
      }
      unchangedFile(before, await handle.stat({ bigint: true }))
      assert.equal(BigInt(bytes), before.size)
      return { bytes, sha256: hash.digest("hex") }
    }
  )
export const freezeEvidenceFile = (file, limit) =>
  withEvidenceFile(file, constants.O_RDONLY, true, async (handle, before) => {
    fileInfo(before, limit, false)
    await handle.chmod(0o400)
  })
export const setEvidenceDirectoryMode = async (directory, mode) => {
  const opened = await openEvidenceDirectory(directory)
  try {
    await opened.handle.chmod(mode)
    await opened.check()
  } finally {
    await opened.handle.close()
  }
}

// Quarantine our cache before deletion, and preserve any unexpected replacement.
// Never recursively remove the original, mutable pathname after checking it.
export const cleanupEvidenceCache = async (directory, identity) => {
  const parent = await openEvidenceDirectory(dirname(directory))
  let quarantine
  try {
    const source = join(parent.anchor, basename(directory))
    const current = await lstat(source, { bigint: true })
    assert.ok(
      current.isDirectory() && sameIdentity(current, identity),
      "Runtime cache replaced; preserved for inspection."
    )
    quarantine = await mkdtemp(join(parent.anchor, ".rr-runtime-cleanup-"))
    const destination = join(quarantine, "cache")
    await rename(source, destination)
    const moved = await lstat(destination, { bigint: true })
    assert.ok(
      moved.isDirectory() && sameIdentity(moved, identity),
      "Runtime cache quarantine differs; preserved for inspection."
    )
    const canonical = join(dirname(directory), basename(quarantine), "cache")
    try {
      await setEvidenceDirectoryMode(join(canonical, "db"), 0o700)
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    await parent.check()
    await rm(destination, { recursive: true })
    await rmdir(quarantine)
  } finally {
    await parent.handle.close()
  }
}

export const resolveRuntimeScanner = async (searchPath) => {
  for (const directory of searchPath.split(":")) {
    if (!isAbsolute(directory)) continue
    try {
      const file = await realpath(join(directory, "trivy"))
      const info = await lstat(file)
      assert.ok(info.isFile() && (info.mode & 0o111) !== 0)
      return {
        path: file,
        ...(await hashEvidenceFile(file, 512 * 1024 * 1024, {
          privateMode: false,
        })),
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
  throw new Error("Reviewed Trivy executable unavailable.")
}

// Preserve stdout bytes exactly. Wait for close on cancellation before cleanup.
export const runRuntimeEvidenceCommand = (
  command,
  args,
  { environment, signal, maxOutputBytes = evidenceLimit }
) =>
  new Promise((resolveResult, reject) => {
    if (signal.aborted) {
      reject(new Error("Runtime evidence cancelled."))
      return
    }
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
      signal,
      killSignal: "SIGKILL",
    })
    const chunks = []
    let bytes = 0
    let failed = false
    child.on("error", () => {
      failed = true
    })
    child.stdout.on("error", () => {
      failed = true
      child.kill("SIGKILL")
    })
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length
      if (bytes > maxOutputBytes) {
        failed = true
        child.kill("SIGKILL")
      } else if (!failed) chunks.push(chunk)
    })
    child.once("close", (code, terminationSignal) => {
      if (failed || signal.aborted || code !== 0 || terminationSignal)
        reject(
          new Error("Runtime evidence command failed or exceeded its limits.")
        )
      else resolveResult(Buffer.concat(chunks))
    })
  })
