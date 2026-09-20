import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"

import { mediaBackupConfirmation } from "./media-backup.mjs"

const sha256Pattern = /^[a-f0-9]{64}$/u
const maxManifestBytes = 64 * 1024
const failure = () => new Error("Media restore preflight unavailable.")

export const mediaRestoreConfirmation = (source, target, manifestSha256) =>
  createHash("sha256")
    .update(`${source}\0${target}\0${manifestSha256}`)
    .digest("hex")

const boundedPositiveInteger = (raw, fallback, maximum) => {
  if (raw === undefined) {
    if (fallback === undefined) throw failure()
    return fallback
  }
  if (!/^[1-9]\d*$/u.test(raw)) throw failure()
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > maximum) throw failure()
  return value
}

export const parseMediaRestoreTimeout = (environment) => {
  const timeoutMs = boundedPositiveInteger(
    environment.MEDIA_RESTORE_TIMEOUT_MS,
    1_800_000,
    3_600_000
  )
  if (timeoutMs < 1_000) throw failure()
  return timeoutMs
}

export const parseMediaRestoreLimits = (environment) => {
  return {
    transferBytes: boundedPositiveInteger(
      environment.MEDIA_RESTORE_MAX_TRANSFER_BYTES,
      undefined,
      Number.MAX_SAFE_INTEGER
    ),
    verificationBytes: boundedPositiveInteger(
      environment.MEDIA_RESTORE_VERIFY_MAX_BYTES,
      undefined,
      Number.MAX_SAFE_INTEGER
    ),
    maxObjects: boundedPositiveInteger(
      environment.MEDIA_RESTORE_VERIFY_MAX_OBJECTS,
      10_000,
      100_000
    ),
    timeoutMs: parseMediaRestoreTimeout(environment),
  }
}

const sameFile = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

export const readPrivateMediaManifest = async (
  path,
  expectedSha256,
  signal
) => {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    Buffer.byteLength(path) > 1_024 ||
    !sha256Pattern.test(expectedSha256)
  )
    throw failure()
  const parent = await lstat(dirname(path), { bigint: true })
  const before = await lstat(path, { bigint: true })
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (parent.mode & 0o077n) !== 0n ||
    (process.getuid && parent.uid !== BigInt(process.getuid())) ||
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    before.size < 1n ||
    before.size > BigInt(maxManifestBytes) ||
    (before.mode & 0o077n) !== 0n ||
    (process.getuid && before.uid !== BigInt(process.getuid())) ||
    (await realpath(path)) !== path
  )
    throw failure()
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const opened = await handle.stat({ bigint: true })
    if (!sameFile(before, opened)) throw failure()
    const bytes = Buffer.alloc(Number(opened.size) + 1)
    let position = 0
    while (position < bytes.length) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(
        bytes,
        position,
        bytes.length - position
      )
      if (bytesRead === 0) break
      position += bytesRead
    }
    if (position !== Number(opened.size)) throw failure()
    if (!sameFile(opened, await handle.stat({ bigint: true }))) throw failure()
    const actual = createHash("sha256")
      .update(bytes.subarray(0, position))
      .digest("hex")
    if (actual !== expectedSha256) throw failure()
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, position)
      )
    )
  } catch {
    throw failure()
  } finally {
    await handle.close()
  }
}

export const validateMediaRestoreSource = (
  manifest,
  source,
  sourceInventory
) => {
  const sha = (value) => sha256Pattern.test(value ?? "")
  if (
    manifest?.schemaVersion !== 3 ||
    manifest.status !== "verified" ||
    manifest.recoveryScope !== "current_state_only" ||
    manifest.verificationAlgorithm !== "SHA256" ||
    !sha(manifest.sourceId) ||
    !sha(manifest.targetId) ||
    manifest.sourceId === manifest.targetId ||
    manifest.targetId !== mediaBackupConfirmation(source, "inventory") ||
    manifest.preservedTargetObjects !== 0 ||
    manifest.inventorySha256 !== manifest.targetInventorySha256 ||
    !sha(manifest.inventorySha256) ||
    !sha(manifest.contentSha256) ||
    !Number.isSafeInteger(manifest.objectCount) ||
    manifest.objectCount < 1 ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes < 0 ||
    manifest.verifiedObjects !== manifest.objectCount ||
    manifest.verificationReadBytes !== manifest.bytes * 2 ||
    manifest.objectCount !== sourceInventory.objectCount ||
    manifest.bytes !== sourceInventory.bytes ||
    manifest.targetInventorySha256 !== sourceInventory.sha256
  )
    throw failure()
  assert.ok(Number.isSafeInteger(manifest.bytes * 2))
  return {
    objectCount: manifest.objectCount,
    bytes: manifest.bytes,
    contentSha256: manifest.contentSha256,
  }
}
