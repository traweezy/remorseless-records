import { createHash } from "node:crypto"

const endpointPattern =
  /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u
const checksumReleaseFloor = 20241002

export const parseMinioClientVersion = (value) => {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > 4 * 1024
  ) {
    throw new Error("MinIO Client version output is invalid.")
  }
  const match = value.match(
    /\bRELEASE\.(\d{4})-(\d{2})-(\d{2})T\d{2}-\d{2}-\d{2}Z\b/u
  )
  const release = match
    ? Number.parseInt(`${match[1]}${match[2]}${match[3]}`, 10)
    : Number.NaN
  if (
    !match ||
    !Number.isSafeInteger(release) ||
    release < checksumReleaseFloor
  ) {
    throw new Error(
      "MinIO Client must support the SHA-256 mirror checksum boundary."
    )
  }
  return match[0]
}

export const validateMediaEndpoint = (value, label) => {
  const endpoint = value?.trim()
  if (
    !endpoint ||
    endpoint.length > 512 ||
    !endpointPattern.test(endpoint) ||
    endpoint.includes("..") ||
    endpoint.split("/").includes(".") ||
    endpoint.includes("//") ||
    endpoint.includes("://")
  ) {
    throw new Error(`${label} must be a bounded mc alias/bucket path.`)
  }
  return endpoint.replace(/\/+$/u, "")
}

export const mediaBackupConfirmation = (source, target) =>
  createHash("sha256").update(`${source}\0${target}`).digest("hex")

export const validateMediaDirections = (source, target) => {
  if (
    source === target ||
    source.startsWith(`${target}/`) ||
    target.startsWith(`${source}/`)
  ) {
    throw new Error("Media source and target paths must not overlap.")
  }
}

export const parseMediaInventory = (jsonLines) => {
  if (Buffer.byteLength(jsonLines, "utf8") > 20 * 1024 * 1024) {
    throw new Error("Media inventory exceeded 20 MiB.")
  }
  const entries = jsonLines
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      let value
      try {
        value = JSON.parse(line)
      } catch {
        throw new Error("Media inventory contained invalid JSON.")
      }
      if (
        !value ||
        value.status !== "success" ||
        value.type !== "file" ||
        typeof value.key !== "string" ||
        !value.key ||
        !isSafeMediaObjectKey(value.key) ||
        !Number.isSafeInteger(value.size) ||
        value.size < 0
      ) {
        throw new Error("Media inventory contained an invalid object record.")
      }
      return { key: value.key, size: value.size }
    })
    .sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0
    )

  const keys = new Set(entries.map(({ key }) => key))
  if (keys.size !== entries.length) {
    throw new Error("Media inventory contained duplicate object keys.")
  }
  const bytes = entries.reduce((total, entry) => total + entry.size, 0)
  if (!Number.isSafeInteger(bytes)) {
    throw new Error("Media inventory byte total is unsafe.")
  }
  const sha256 = createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex")
  return { bytes, entries, objectCount: entries.length, sha256 }
}

export const verifyMediaInventory = (source, target) => {
  const targetEntries = new Map(
    target.entries.map(({ key, size }) => [key, size])
  )
  for (const { key, size } of source.entries) {
    if (targetEntries.get(key) !== size) {
      throw new Error("Media target is missing a current source object.")
    }
  }
  return {
    preservedTargetObjects: target.objectCount - source.objectCount,
    targetInventorySha256: target.sha256,
  }
}

// mc interprets paths, not opaque S3 keys. Fail before a key could escape its
// reviewed alias/bucket prefix or be interpreted as a URL/query/option.
export const isSafeMediaObjectKey = (key) =>
  typeof key === "string" &&
  key.length > 0 &&
  Buffer.byteLength(key, "utf8") <= 1_024 &&
  !/[\p{Cc}\\?#%]/u.test(key) &&
  !key.includes("://") &&
  key.split("/").every((part) => part && part !== "." && part !== "..")

const positiveInteger = (value, label, maximum) => {
  const parsed =
    typeof value === "string" && /^[1-9]\d*$/u.test(value)
      ? Number(value)
      : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${label} must be a bounded positive integer.`)
  }
  return parsed
}

export const parseMediaVerificationLimits = (environment) => ({
  // Both source and target downloads count, independently of mirror traffic.
  maxBytes: positiveInteger(
    environment.MEDIA_BACKUP_VERIFY_MAX_BYTES,
    "MEDIA_BACKUP_VERIFY_MAX_BYTES",
    Number.MAX_SAFE_INTEGER
  ),
  maxObjects: positiveInteger(
    environment.MEDIA_BACKUP_VERIFY_MAX_OBJECTS ?? "10000",
    "MEDIA_BACKUP_VERIFY_MAX_OBJECTS",
    100_000
  ),
  timeoutMs: positiveInteger(
    environment.MEDIA_BACKUP_VERIFY_TIMEOUT_MS ?? "600000",
    "MEDIA_BACKUP_VERIFY_TIMEOUT_MS",
    3_600_000
  ),
})

export const validateMediaVerificationBudget = (source, limits) => {
  const readBytes = source.bytes * 2
  if (
    !Number.isSafeInteger(readBytes) ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes < 1 ||
    !Number.isSafeInteger(limits.maxObjects) ||
    limits.maxObjects < 1 ||
    limits.maxObjects > 100_000 ||
    !Number.isSafeInteger(limits.timeoutMs) ||
    limits.timeoutMs < 1 ||
    limits.timeoutMs > 3_600_000 ||
    readBytes > limits.maxBytes ||
    source.objectCount > limits.maxObjects
  ) {
    throw new Error("Media verification exceeds its reviewed read budget.")
  }
  return { readBytes, readRequests: source.objectCount * 2 }
}

const readWithDeadline = async (read, signal) => {
  try {
    signal.throwIfAborted()
    // The injected reader must honor this signal and settle after cleanup.
    // Racing its promise would let the CLI exit before its child was reaped.
    const result = await read()
    signal.throwIfAborted()
    return result
  } catch {
    throw new Error(
      signal.aborted
        ? "Media content verification was cancelled or timed out."
        : "Media content verification read failed."
    )
  }
}

export const verifyMediaMirror = async (
  source,
  target,
  { hashObject, limits, signal }
) => {
  const inventoryEvidence = verifyMediaInventory(source, target)
  const budget = validateMediaVerificationBudget(source, limits)
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), limits.timeoutMs)
  const verificationSignal = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal
  const contentHash = createHash("sha256")
  try {
    if (verificationSignal.aborted) {
      throw new Error("Media content verification was cancelled or timed out.")
    }
    for (const { key, size } of source.entries) {
      const digests = []
      for (const side of ["source", "target"]) {
        const result = await readWithDeadline(
          () =>
            hashObject({
              side,
              key,
              expectedBytes: size,
              signal: verificationSignal,
            }),
          verificationSignal
        )
        if (
          result?.bytes !== size ||
          !/^[a-f0-9]{64}$/u.test(result?.sha256 ?? "")
        ) {
          throw new Error(
            "Media content verification returned invalid evidence."
          )
        }
        digests.push(result.sha256)
      }
      if (digests[0] !== digests[1]) {
        throw new Error("Media target content differs from its source.")
      }
      contentHash.update(`${JSON.stringify([key, size, digests[0]])}\n`)
    }
    return {
      ...inventoryEvidence,
      contentSha256: contentHash.digest("hex"),
      verificationAlgorithm: "SHA256",
      verifiedObjects: source.objectCount,
      verificationReadBytes: budget.readBytes,
    }
  } finally {
    clearTimeout(deadline)
    controller.abort()
  }
}
