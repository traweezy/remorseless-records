import { createHash } from "node:crypto"

const endpointPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u
const checksumReleaseFloor = 20241002

export const parseMinioClientVersion = (value) => {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > 4 * 1024
  ) {
    throw new Error("MinIO Client version output is invalid.")
  }
  const match = value.match(
    /\bRELEASE\.(\d{4})-(\d{2})-(\d{2})T\d{2}-\d{2}-\d{2}Z\b/u,
  )
  const release = match
    ? Number.parseInt(`${match[1]}${match[2]}${match[3]}`, 10)
    : Number.NaN
  if (!match || !Number.isSafeInteger(release) || release < checksumReleaseFloor) {
    throw new Error(
      "MinIO Client must support the SHA-256 mirror checksum boundary.",
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
    endpoint.includes("//") ||
    endpoint.includes("://")
  ) {
    throw new Error(`${label} must be a bounded mc alias/bucket path.`)
  }
  return endpoint.replace(/\/+$/u, "")
}

export const mediaBackupConfirmation = (source, target) =>
  createHash("sha256").update(`${source}\0${target}`).digest("hex")

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
        value.key.length > 2_048 ||
        !Number.isSafeInteger(value.size) ||
        value.size < 0
      ) {
        throw new Error("Media inventory contained an invalid object record.")
      }
      return { key: value.key, size: value.size }
    })
    .sort((left, right) => left.key.localeCompare(right.key))

  const keys = new Set(entries.map(({ key }) => key))
  if (keys.size !== entries.length) {
    throw new Error("Media inventory contained duplicate object keys.")
  }
  const bytes = entries.reduce((total, entry) => total + entry.size, 0)
  if (!Number.isSafeInteger(bytes)) {
    throw new Error("Media inventory byte total is unsafe.")
  }
  const sha256 = createHash("sha256")
    .update(entries.map(({ key, size }) => `${key}\0${size}`).join("\n"))
    .digest("hex")
  return { bytes, entries, objectCount: entries.length, sha256 }
}

export const verifyMediaMirror = (source, target) => {
  const targetEntries = new Map(
    target.entries.map(({ key, size }) => [key, size]),
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
