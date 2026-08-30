const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"])
const ENCRYPTED_SSL_MODES = new Set(["require", "verify-ca", "verify-full"])
const RAILWAY_PRIVATE_SUFFIX = ".railway.internal"
const RAILWAY_PUBLIC_PROXY_SUFFIX = ".proxy.rlwy.net"

export type DatabaseConnectionTransport = "local" | "railway_private" | "tls"

export type ResolvedDatabaseConnection = {
  connectionString: string
  transport: DatabaseConnectionTransport
}

type ResolveDatabaseConnectionOptions = {
  connectionString: string
  environment?: string | undefined
  label?: string
}

const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]" ||
  hostname === "::1"

const invalidDatabaseUrl = (label: string, detail: string): Error =>
  new Error(`${label} ${detail}`)

export const resolveDatabaseConnection = ({
  connectionString,
  environment,
  label = "DATABASE_URL",
}: ResolveDatabaseConnectionOptions): ResolvedDatabaseConnection => {
  const raw = connectionString.trim()
  if (!raw) {
    throw invalidDatabaseUrl(label, "is required.")
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw invalidDatabaseUrl(label, "must be a valid PostgreSQL URL.")
  }
  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    throw invalidDatabaseUrl(label, "must use PostgreSQL.")
  }
  if (url.hash) {
    throw invalidDatabaseUrl(label, "must not include a URL fragment.")
  }
  if (
    environment === "production" &&
    (!url.username || !url.password || url.pathname === "/")
  ) {
    throw invalidDatabaseUrl(
      label,
      "must include a database, username, and password in production."
    )
  }

  const hostname = url.hostname.toLowerCase()
  if (isLoopbackHost(hostname)) {
    return { connectionString: url.toString(), transport: "local" }
  }
  if (hostname.endsWith(RAILWAY_PRIVATE_SUFFIX)) {
    return {
      connectionString: url.toString(),
      transport: "railway_private",
    }
  }

  if (
    hostname.endsWith(RAILWAY_PUBLIC_PROXY_SUFFIX) &&
    !url.searchParams.has("sslmode")
  ) {
    url.searchParams.set("uselibpqcompat", "true")
    url.searchParams.set("sslmode", "require")
  }
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase()
  const legacySsl = url.searchParams.get("ssl")?.toLowerCase()
  if (
    !sslMode ||
    !ENCRYPTED_SSL_MODES.has(sslMode) ||
    ["0", "false", "no", "off"].includes(legacySsl ?? "")
  ) {
    throw invalidDatabaseUrl(
      label,
      "must require TLS for every non-private database connection."
    )
  }

  return { connectionString: url.toString(), transport: "tls" }
}
