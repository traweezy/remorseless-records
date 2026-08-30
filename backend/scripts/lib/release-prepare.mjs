const trueValues = new Set(["1", "true"])
const falseValues = new Set(["", "0", "false"])

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

export const buildReleasePreparePlan = ({
  environment,
  nodePath,
  pnpmPath = "pnpm",
}) => {
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
  const migrationUrl = configuredMigrationUrl || runtimeUrl
  const runtimeEnvironment = { ...environment, DATABASE_URL: runtimeUrl }
  delete runtimeEnvironment.DATABASE_MIGRATION_URL
  const migrationEnvironment = {
    ...environment,
    DATABASE_URL: migrationUrl,
  }
  delete migrationEnvironment.DATABASE_MIGRATION_URL

  return [
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
