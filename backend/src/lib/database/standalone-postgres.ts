const CONNECTION_TIMEOUT_MS = 10_000
const QUERY_TIMEOUT_MS = 30_000

type QueryResult<Row> = {
  rows: Row[]
}

export type PostgreSqlClient = {
  connect: () => Promise<void>
  end: () => Promise<void>
  query: <Row>(
    query: string,
    values?: unknown[]
  ) => Promise<QueryResult<Row>>
}

type PostgreSqlClientConstructor = new (config: {
  application_name: string
  connectionString: string
  connectionTimeoutMillis: number
  query_timeout: number
  statement_timeout: number
}) => PostgreSqlClient

type DynamicModule = {
  Client?: unknown
  default?: {
    Client?: unknown
  }
}

const resolveConnectionString = (): string => {
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw) {
    throw new Error("[database-cli] DATABASE_URL is required.")
  }

  const url = new URL(raw)
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("[database-cli] DATABASE_URL must use PostgreSQL.")
  }

  if (
    url.hostname.endsWith(".proxy.rlwy.net") &&
    !url.searchParams.has("sslmode")
  ) {
    url.searchParams.set("uselibpqcompat", "true")
    url.searchParams.set("sslmode", "require")
  }

  return url.toString()
}

const loadPostgreSqlClient = async (): Promise<PostgreSqlClientConstructor> => {
  const moduleName = "pg"
  const loaded = (await import(moduleName)) as DynamicModule
  const candidate = loaded.Client ?? loaded.default?.Client

  if (typeof candidate !== "function") {
    throw new Error("[database-cli] PostgreSQL client is unavailable.")
  }

  return candidate as PostgreSqlClientConstructor
}

export const createPostgreSqlClient = async (
  applicationName: string
): Promise<PostgreSqlClient> => {
  const Client = await loadPostgreSqlClient()
  return new Client({
    application_name: applicationName,
    connectionString: resolveConnectionString(),
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  })
}

export const rollbackQuietly = async (
  client: PostgreSqlClient
): Promise<void> => {
  try {
    await client.query("rollback")
  } catch {
    // The original connection/query error is more useful than rollback failure.
  }
}
