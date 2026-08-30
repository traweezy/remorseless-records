import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

const encryptedSslModes = new Set(["require", "verify-ca", "verify-full"])

const decodeUrlComponent = (value, label) => {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`${label} contains invalid URL encoding.`)
  }
}

const isPrivateOrLoopback = (hostname) =>
  hostname.endsWith(".railway.internal") ||
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)

export const createPostgresClientEnvironment = (raw, label) => {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`)
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error(`${label} must use PostgreSQL.`)
  }
  if (url.hash) {
    throw new Error(`${label} must not include a URL fragment.`)
  }
  if (!url.hostname || !url.username || !url.password || url.pathname === "/") {
    throw new Error(
      `${label} must include a host, database, username, and password.`
    )
  }

  const hostname = url.hostname.toLowerCase()
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase()
  if (!isPrivateOrLoopback(hostname) && !encryptedSslModes.has(sslMode)) {
    throw new Error(`${label} must require TLS outside private networking.`)
  }

  const database = decodeUrlComponent(url.pathname.slice(1), label)
  const username = decodeUrlComponent(url.username, label)
  const password = decodeUrlComponent(url.password, label)
  if (
    Buffer.byteLength(database, "utf8") > 256 ||
    /[\u0000-\u001f\u007f=]/u.test(database) ||
    database.includes("/")
  ) {
    throw new Error(`${label} contains an unsafe database name.`)
  }
  const fingerprint = createHash("sha256")
    .update(`${hostname}:${url.port || "5432"}/${database}`)
    .digest("hex")

  return {
    environment: {
      PGAPPNAME: "remorseless-recovery",
      PGCONNECT_TIMEOUT: "10",
      PGDATABASE: database,
      PGHOST: hostname,
      PGPASSWORD: password,
      PGPORT: url.port || "5432",
      PGSSLMODE: sslMode ?? "prefer",
      PGUSER: username,
      ...(url.searchParams.get("sslrootcert")
        ? { PGSSLROOTCERT: url.searchParams.get("sslrootcert") }
        : {}),
    },
    fingerprint,
  }
}

export const hashFileSha256 = async (path) => {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}

export const parseBackupManifest = (value) => {
  const expectedKeys = [
    "bytes",
    "createdAt",
    "format",
    "pgDumpVersion",
    "schemaVersion",
    "sha256",
    "sourceFingerprint",
  ]
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== 1 ||
    value.format !== "postgres-custom" ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    typeof value.createdAt !== "string" ||
    value.createdAt.length !== 24 ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt ||
    typeof value.pgDumpVersion !== "string" ||
    value.pgDumpVersion.length > 128 ||
    !/^pg_dump \(PostgreSQL\) \d+/u.test(value.pgDumpVersion) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    typeof value.sourceFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sourceFingerprint) ||
    Object.keys(value).sort().join("\0") !== expectedKeys.sort().join("\0")
  ) {
    throw new Error("The PostgreSQL backup manifest is invalid.")
  }
  return value
}
