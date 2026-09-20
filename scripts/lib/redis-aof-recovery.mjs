import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdtemp, open, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { runRecoveryCommand } from "./recovery-process.mjs"

export const REDIS_AOF_MANIFEST = "appendonly.aof.manifest"
export const REDIS_AOF_MAX_FILES = 32
export const REDIS_AOF_MAX_BYTES = 512 * 1024 * 1024
const MAX_MANIFEST_BYTES = 16 * 1024
const MAX_CHECKER_PATH_BYTES = 1024
const MAX_CHECKER_MANIFEST_PATH_BYTES = 240
const BUFFER_BYTES = 64 * 1024
const CHECKER_VERSION_PATTERN =
  /^redis-check-aof v=8\.10\.1 sha=[a-f0-9]{8}:[01] malloc=[a-z0-9.-]{1,40} bits=64 build=[a-f0-9]{16}$/u
const failure = () => new Error("Redis AOF verification unavailable.")

export const parseAofManifest = (source) => {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) === 0 ||
    Buffer.byteLength(source) > MAX_MANIFEST_BYTES ||
    !source.endsWith("\n") ||
    /\r|\0/u.test(source)
  )
    throw failure()

  const entries = []
  const names = new Set()
  let baseCount = 0
  let activeCount = 0
  let lastIncrement = 0
  let phase = 0
  for (const line of source.slice(0, -1).split("\n")) {
    if (line.startsWith("#") && line.length <= 1024) continue
    const match =
      /^file (appendonly\.aof\.([1-9]\d{0,9})\.(base\.(?:rdb|aof)|incr\.aof)) seq ([1-9]\d{0,9}) type ([bhi])(?: startoffset (0|[1-9]\d{0,15})(?: endoffset (0|[1-9]\d{0,15}))?)?$/u.exec(
        line
      )
    if (!match) throw failure()
    const [
      ,
      name,
      nameSequence,
      suffix,
      manifestSequence,
      type,
      startOffset,
      endOffset,
    ] = match
    if (nameSequence !== manifestSequence || names.has(name)) throw failure()
    const sequence = Number(nameSequence)
    const start = startOffset === undefined ? undefined : Number(startOffset)
    const end = endOffset === undefined ? undefined : Number(endOffset)
    if (
      !Number.isSafeInteger(sequence) ||
      (start !== undefined && !Number.isSafeInteger(start)) ||
      (end !== undefined && (!Number.isSafeInteger(end) || end < start))
    )
      throw failure()
    if (type === "b") {
      if (
        baseCount !== 0 ||
        entries.length !== 0 ||
        !suffix.startsWith("base.")
      )
        throw failure()
      baseCount += 1
      activeCount += 1
    } else if (type === "h") {
      if (phase > 1) throw failure()
      phase = 1
    } else {
      if (suffix !== "incr.aof" || sequence <= lastIncrement) throw failure()
      phase = 2
      lastIncrement = sequence
      activeCount += 1
    }
    names.add(name)
    entries.push({
      name,
      sequence,
      type,
      ...(start === undefined ? {} : { startOffset: start }),
      ...(end === undefined ? {} : { endOffset: end }),
    })
    if (entries.length > REDIS_AOF_MAX_FILES) throw failure()
  }
  if (activeCount === 0) throw failure()
  return entries
}

const safePrivateFile = async (path, expectedSize) => {
  const details = await lstat(path, { bigint: true })
  if (
    !details.isFile() ||
    details.isSymbolicLink() ||
    (details.mode & 0o077n) !== 0n ||
    details.nlink !== 1n ||
    (process.getuid && details.uid !== BigInt(process.getuid())) ||
    details.size < 0n ||
    details.size > BigInt(expectedSize)
  )
    throw failure()
  return details
}

const unchanged = (before, after) =>
  before.dev === after.dev &&
  before.ino === after.ino &&
  before.size === after.size &&
  before.mtimeNs === after.mtimeNs &&
  before.ctimeNs === after.ctimeNs

const readBounded = async (path, maxBytes, signal) => {
  const before = await safePrivateFile(path, maxBytes)
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !unchanged(before, opened)) throw failure()
    const buffer = Buffer.alloc(Number(opened.size) + 1)
    let offset = 0
    while (offset < buffer.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== Number(opened.size)) throw failure()
    const after = await handle.stat({ bigint: true })
    if (!unchanged(opened, after)) throw failure()
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

const hashBounded = async (path, maxBytes, signal) => {
  const before = await safePrivateFile(path, maxBytes)
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !unchanged(before, opened)) throw failure()
    const hash = createHash("sha256")
    const buffer = Buffer.alloc(BUFFER_BYTES)
    let bytes = 0
    while (true) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(buffer)
      if (bytesRead === 0) break
      bytes += bytesRead
      if (bytes > maxBytes || BigInt(bytes) > opened.size) throw failure()
      hash.update(buffer.subarray(0, bytesRead))
    }
    const after = await handle.stat({ bigint: true })
    if (BigInt(bytes) !== opened.size || !unchanged(opened, after))
      throw failure()
    return { bytes, sha256: hash.digest("hex") }
  } finally {
    await handle.close()
  }
}

const copyAndHash = async (source, destination, limit, signal) => {
  const before = await safePrivateFile(source, limit)
  const input = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  let output
  try {
    const opened = await input.stat({ bigint: true })
    if (!opened.isFile() || !unchanged(before, opened)) throw failure()
    output = await open(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    )
    const hash = createHash("sha256")
    const buffer = Buffer.alloc(BUFFER_BYTES)
    let bytes = 0
    while (true) {
      signal?.throwIfAborted()
      const { bytesRead } = await input.read(buffer)
      if (bytesRead === 0) break
      bytes += bytesRead
      if (bytes > limit || BigInt(bytes) > opened.size) throw failure()
      hash.update(buffer.subarray(0, bytesRead))
      let written = 0
      while (written < bytesRead) {
        signal?.throwIfAborted()
        const result = await output.write(buffer, written, bytesRead - written)
        if (result.bytesWritten <= 0) throw failure()
        written += result.bytesWritten
      }
    }
    if (BigInt(bytes) !== opened.size) throw failure()
    const after = await input.stat({ bigint: true })
    if (!unchanged(opened, after)) throw failure()
    return { bytes, sha256: hash.digest("hex") }
  } finally {
    await output?.close()
    await input.close()
  }
}

const assertPrivateDirectory = async (path) => {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    Buffer.byteLength(path) > 1024
  )
    throw failure()
  const details = await lstat(path, { bigint: true })
  if (
    !details.isDirectory() ||
    details.isSymbolicLink() ||
    (details.mode & 0o077n) !== 0n ||
    (process.getuid && details.uid !== BigInt(process.getuid())) ||
    (await realpath(path)) !== path
  )
    throw failure()
}

const hashChecker = async (path, signal) => {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    Buffer.byteLength(path) > MAX_CHECKER_PATH_BYTES
  )
    throw failure()
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const opened = await handle.stat({ bigint: true })
    const current = await lstat(path, { bigint: true })
    if (
      !opened.isFile() ||
      (opened.mode & 0o111n) === 0n ||
      opened.size <= 0n ||
      opened.size > 128n * 1024n * 1024n ||
      !unchanged(opened, current)
    )
      throw failure()
    const hash = createHash("sha256")
    const buffer = Buffer.alloc(BUFFER_BYTES)
    let bytes = 0
    while (true) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(buffer)
      if (bytesRead === 0) break
      bytes += bytesRead
      if (BigInt(bytes) > opened.size) throw failure()
      hash.update(buffer.subarray(0, bytesRead))
    }
    const after = await handle.stat({ bigint: true })
    if (BigInt(bytes) !== opened.size || !unchanged(opened, after))
      throw failure()
    return hash.digest("hex")
  } finally {
    await handle.close()
  }
}

export const verifyRedisAofArchive = async ({
  sourceDirectory,
  checker,
  checkerSha256,
  maxBytes = REDIS_AOF_MAX_BYTES,
  signal = AbortSignal.timeout(120_000),
  runCommand = runRecoveryCommand,
}) => {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 10 * 1024 ** 3
  )
    throw failure()
  if (!/^[a-f0-9]{64}$/u.test(checkerSha256 ?? "")) throw failure()
  await assertPrivateDirectory(sourceDirectory)
  if ((await hashChecker(checker, signal)) !== checkerSha256) throw failure()
  const manifestBuffer = await readBounded(
    join(sourceDirectory, REDIS_AOF_MANIFEST),
    MAX_MANIFEST_BYTES,
    signal
  )
  const manifest = new TextDecoder("utf-8", { fatal: true }).decode(
    manifestBuffer
  )
  const entries = parseAofManifest(manifest)
  const expectedNames = new Set([
    REDIS_AOF_MANIFEST,
    ...entries.map(({ name }) => name),
  ])
  const actualNames = await readdir(sourceDirectory)
  if (
    actualNames.length !== expectedNames.size ||
    actualNames.some((name) => !expectedNames.has(name))
  )
    throw failure()

  let snapshotDirectory
  try {
    snapshotDirectory = await mkdtemp(join(tmpdir(), "remorseless-redis-aof-"))
    if (
      Buffer.byteLength(join(snapshotDirectory, REDIS_AOF_MANIFEST)) >
      MAX_CHECKER_MANIFEST_PATH_BYTES
    )
      throw failure()
    const files = []
    let totalBytes = 0
    for (const name of expectedNames) {
      signal?.throwIfAborted()
      const result = await copyAndHash(
        join(sourceDirectory, name),
        join(snapshotDirectory, name),
        maxBytes - totalBytes,
        signal
      )
      totalBytes += result.bytes
      if (
        name === REDIS_AOF_MANIFEST &&
        result.sha256 !==
          createHash("sha256").update(manifestBuffer).digest("hex")
      )
        throw failure()
      if (
        entries.some((entry) => entry.name === name && entry.type === "b") &&
        result.bytes === 0
      )
        throw failure()
      files.push({ name, ...result })
    }
    const environment = { LANG: "C", PATH: process.env.PATH }
    const version = await runCommand(checker, ["--version"], {
      environment,
      signal,
      maxOutputBytes: 256,
    })
    if (!CHECKER_VERSION_PATTERN.test(version)) throw failure()
    const output = await runCommand(
      checker,
      [join(snapshotDirectory, REDIS_AOF_MANIFEST)],
      { environment, signal, maxOutputBytes: 64 * 1024 }
    )
    if (
      !output.startsWith("Start checking Multi Part AOF\n") ||
      !output.endsWith("All AOF files and manifest are valid") ||
      entries
        .filter(({ type }) => type !== "h")
        .some(({ name, type }) => {
          const file = files.find((item) => item.name === name)
          const expected = file?.bytes === 0 ? "is empty" : "is valid"
          return !output.includes(
            `${type === "b" ? "BASE" : "INCR"} AOF ${name} ${expected}`
          )
        }) ||
      /(?:Successfully truncated| is not valid)/u.test(output)
    )
      throw failure()
    for (const file of files) {
      const current = await hashBounded(
        join(snapshotDirectory, file.name),
        maxBytes,
        signal
      )
      if (current.bytes !== file.bytes || current.sha256 !== file.sha256)
        throw failure()
    }
    if ((await hashChecker(checker, signal)) !== checkerSha256) throw failure()
    const setSha256 = createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex")
    return {
      schemaVersion: 1,
      status: "verified",
      checkerVersion: version,
      checkerSha256,
      fileCount: files.length,
      activeFileCount: entries.filter(({ type }) => type !== "h").length,
      historyFileCount: entries.filter(({ type }) => type === "h").length,
      totalBytes,
      manifestSha256: files[0].sha256,
      setSha256,
      replayProven: false,
    }
  } catch {
    throw failure()
  } finally {
    if (snapshotDirectory)
      await rm(snapshotDirectory, { recursive: true, force: true })
  }
}
