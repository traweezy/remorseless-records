const trueValues = new Set(["1", "true"])
const falseValues = new Set(["", "0", "false"])
const databaseProtocols = new Set(["postgres:", "postgresql:"])
const allowedConnectionParameters = new Set([
  "application_name",
  "sslmode",
  "uselibpqcompat",
])

const parseRequiredSplit = (value) => {
  const normalized = (value ?? "").trim().toLowerCase()
  if (trueValues.has(normalized)) {
    return true
  }
  if (falseValues.has(normalized)) {
    return false
  }
  throw new Error("DATABASE_ROLE_SPLIT_REQUIRED must be true, false, 1, or 0.")
}

const parseDatabaseIdentity = (raw, label) => {
  try {
    const url = new URL(raw)
    if (
      !databaseProtocols.has(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length <= 1 ||
      /%(?:2f|5c)/iu.test(url.pathname) ||
      url.hash ||
      [...url.searchParams.keys()].some(
        (key) => !allowedConnectionParameters.has(key)
      )
    ) {
      throw new Error("invalid database identity")
    }

    return {
      database: decodeURI(url.pathname.slice(1)),
      host: url.hostname,
      port: url.port || "5432",
      user: decodeURIComponent(url.username),
    }
  } catch {
    throw new Error(
      `${label} must include a PostgreSQL host, database, username, and password without unsupported connection parameters when the role split is enforced.`
    )
  }
}

const buildDatabaseEnvironments = (environment) => {
  const runtimeUrl = environment.DATABASE_URL?.trim()
  const configuredMigrationUrl = environment.DATABASE_MIGRATION_URL?.trim()
  if (!runtimeUrl) {
    throw new Error("DATABASE_URL is required for release preparation.")
  }

  const splitRequired = parseRequiredSplit(
    environment.DATABASE_ROLE_SPLIT_REQUIRED
  )
  if (
    splitRequired &&
    (!configuredMigrationUrl || configuredMigrationUrl === runtimeUrl)
  ) {
    throw new Error(
      "A distinct DATABASE_MIGRATION_URL is required when the database role split is enforced."
    )
  }

  if (splitRequired) {
    const runtime = parseDatabaseIdentity(runtimeUrl, "DATABASE_URL")
    const migration = parseDatabaseIdentity(
      configuredMigrationUrl,
      "DATABASE_MIGRATION_URL"
    )
    if (runtime.user === migration.user) {
      throw new Error(
        "DATABASE_MIGRATION_URL must use a distinct PostgreSQL login when the role split is enforced."
      )
    }
    if (
      runtime.host !== migration.host ||
      runtime.port !== migration.port ||
      runtime.database !== migration.database
    ) {
      throw new Error(
        "DATABASE_MIGRATION_URL must target the same PostgreSQL endpoint and database as DATABASE_URL."
      )
    }
  }

  const migrationUrl = configuredMigrationUrl || runtimeUrl
  const runtimeEnvironment = { ...environment, DATABASE_URL: runtimeUrl }
  delete runtimeEnvironment.DATABASE_MIGRATION_URL
  const migrationEnvironment = {
    ...environment,
    DATABASE_URL: migrationUrl,
  }
  delete migrationEnvironment.DATABASE_MIGRATION_URL

  return { migrationEnvironment, runtimeEnvironment, splitRequired }
}

const candidateIndexPattern = /^products_build_[a-z0-9_-]+$/u

const buildCandidateIndex = ({ environment, now }) => {
  const configuredIndex = environment.MEILISEARCH_CANDIDATE_INDEX?.trim()
  const revision = (
    environment.RAILWAY_GIT_COMMIT_SHA ??
    environment.COMMIT_SHA ??
    environment.GITHUB_SHA ??
    "local"
  )
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "")
    .slice(0, 12)
  const timestamp = now.toISOString().toLowerCase().replace(/[-:.]/gu, "")
  const candidateIndex =
    configuredIndex ??
    `products_build_${timestamp}_${revision.length > 0 ? revision : "local"}`

  if (!candidateIndexPattern.test(candidateIndex)) {
    throw new Error(
      "MEILISEARCH_CANDIDATE_INDEX must match products_build_[a-z0-9_-]+."
    )
  }

  return candidateIndex
}

export const buildReleasePreparePlan = ({
  environment,
  nodePath,
  pnpmPath = "pnpm",
}) => {
  const { migrationEnvironment, runtimeEnvironment, splitRequired } =
    buildDatabaseEnvironments(environment)

  return [
    ...(splitRequired
      ? [
          {
            args: ["run", "database:role:audit"],
            command: pnpmPath,
            environment: {
              ...migrationEnvironment,
              DATABASE_ROLE_PROFILE: "migration",
            },
            label: "migration database role audit",
          },
          {
            args: ["run", "database:role:audit"],
            command: pnpmPath,
            environment: {
              ...runtimeEnvironment,
              DATABASE_ROLE_PROFILE: "runtime",
            },
            label: "runtime database role audit",
          },
        ]
      : []),
    {
      args: ["exec", "medusa", "db:migrate"],
      command: pnpmPath,
      environment: migrationEnvironment,
      label: "database migrations",
    },
    {
      args: ["exec", "medusa", "db:sync-links"],
      command: pnpmPath,
      environment: migrationEnvironment,
      label: "database link synchronization",
    },
    {
      args: [
        "./scripts/run-medusa.js",
        "./src/scripts/check-object-storage.ts",
      ],
      command: nodePath,
      environment: runtimeEnvironment,
      label: "object storage readiness",
    },
    {
      args: ["./scripts/run-search-prepare.js"],
      command: nodePath,
      environment: runtimeEnvironment,
      label: "search preparation",
    },
  ]
}

export const buildRuntimeReleasePreparePlan = ({
  environment,
  nodePath,
  now,
  serverRoot,
}) => {
  const { migrationEnvironment, runtimeEnvironment, splitRequired } =
    buildDatabaseEnvironments(environment)
  const cliPath = `${serverRoot}/node_modules/@medusajs/cli/cli.js`
  const auditPath = `${serverRoot}/src/cli/audit-database-role.js`
  const candidateIndex = buildCandidateIndex({ environment, now })

  return [
    ...(splitRequired
      ? [
          {
            args: [auditPath],
            command: nodePath,
            environment: {
              ...migrationEnvironment,
              DATABASE_ROLE_PROFILE: "migration",
            },
            label: "migration database role audit",
          },
          {
            args: [auditPath],
            command: nodePath,
            environment: {
              ...runtimeEnvironment,
              DATABASE_ROLE_PROFILE: "runtime",
            },
            label: "runtime database role audit",
          },
        ]
      : []),
    {
      args: [cliPath, "db:migrate"],
      command: nodePath,
      environment: migrationEnvironment,
      label: "database migrations",
    },
    {
      args: [cliPath, "db:sync-links"],
      command: nodePath,
      environment: migrationEnvironment,
      label: "database link synchronization",
    },
    {
      args: [cliPath, "exec", "./src/scripts/check-object-storage.js"],
      command: nodePath,
      environment: runtimeEnvironment,
      label: "object storage readiness",
    },
    {
      args: [cliPath, "exec", "./src/scripts/reindex-meilisearch.js"],
      command: nodePath,
      environment: {
        ...runtimeEnvironment,
        MEILISEARCH_CANDIDATE_INDEX: candidateIndex,
      },
      label: "search preparation",
    },
  ]
}
