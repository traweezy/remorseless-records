import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import {
  migrationClient,
  migrationContext,
  recordMigration,
} from "./migration-receipt.mjs"

const runCommand = async (file, args, options) => {
  try {
    await promisify(execFile)(file, args, options)
    return { status: 0 }
  } catch {
    throw new Error("migration_step_failed")
  }
}

export const migrationJobEnvironment = (environment) => ({
  PATH: environment.PATH,
  HOME: environment.HOME,
  LD_LIBRARY_PATH: environment.LD_LIBRARY_PATH,
  // This is the existing provider-free CLI configuration, never a server.
  // Only database migration/link-sync commands run, with no provider keys,
  // shared Redis, worker startup, HTTP listener or application credentials.
  NODE_ENV: "development",
  DATABASE_URL: environment.DATABASE_URL,
  MEDUSA_WORKER_MODE: "server",
  MEDUSA_DISABLE_ADMIN: "1",
  MEDUSA_FF_RBAC: "true",
  MEDUSA_FF_VIEW_CONFIGURATIONS: "true",
  MEDUSA_DISABLE_TELEMETRY: "true",
  // Empty values also prevent Medusa's dotenv loader from re-enabling local
  // provider credentials. Omission alone does not provide that guarantee.
  REDIS_URL: "",
  RESEND_API_KEY: "",
  RESEND_FROM: "",
  RESEND_FROM_EMAIL: "",
  STRIPE_API_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  STRIPE_LIFECYCLE_WEBHOOK_SECRET: "",
  STRIPE_PAYMENT_METHOD_CONFIGURATION: "",
  MEILISEARCH_HOST: "",
  MEILISEARCH_ADMIN_KEY: "",
  MEILISEARCH_CANDIDATE_INDEX: "",
  MINIO_ENDPOINT: "",
  MINIO_ACCESS_KEY: "",
  MINIO_SECRET_KEY: "",
  MINIO_FILE_URL: "",
  MINIO_BUCKET: "",
  MINIO_REGION: "",
  TAX_RATE_LOOKUP_API_KEY: "",
  TAX_RATE_LOOKUP_PROVIDER: "taxrate_io",
  TAX_RATE_LOOKUP_MODE: "zip",
  OTEL_SDK_DISABLED: "true",
  OTEL_TRACES_EXPORTER: "none",
  OTEL_METRICS_EXPORTER: "none",
  OTEL_LOGS_EXPORTER: "none",
  JWT_SECRET: randomBytes(48).toString("base64url"),
  COOKIE_SECRET: randomBytes(48).toString("base64url"),
})

export const runMigrationJob = async ({
  environment = process.env,
  root = join(
    dirname(dirname(fileURLToPath(import.meta.url))),
    ".medusa/server"
  ),
  run = runCommand,
  clientFactory = migrationClient,
} = {}) => {
  const context = migrationContext(environment)
  if (
    environment.RAILWAY_SERVICE_ID !== context.service ||
    new URL(environment.DATABASE_URL).username !== "app_migrator" ||
    environment.DATABASE_MIGRATION_URL ||
    environment.DATABASE_BACKUP_URL ||
    environment.DATABASE_SOURCE_IDENTITY_URL ||
    Object.keys(environment).some((name) => name.startsWith("PG"))
  )
    throw new Error("invalid_migration_job_identity")
  const require = createRequire(join(root, "package.json"))
  const cli = require.resolve("@medusajs/cli/cli.js")
  const clean = migrationJobEnvironment(environment)
  const execute = async (args, childEnvironment = clean, signal) => {
    const result = await run(process.execPath, args, {
      cwd: root,
      env: childEnvironment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
      timeout: 300_000,
      killSignal: "SIGKILL",
      signal,
    })
    if (result.error || result.signal || result.status !== 0)
      throw new Error("migration_step_failed")
  }
  await execute([join(root, "src/cli/audit-database-role.js")], {
    ...clean,
    DATABASE_ROLE_PROFILE: "migration",
  })
  return recordMigration({
    client: clientFactory(environment.DATABASE_URL),
    context,
    deployment: environment.RAILWAY_DEPLOYMENT_ID,
    migrate: async ({ signal }) => {
      await execute([cli, "db:migrate"], clean, signal)
      await execute([cli, "db:sync-links"], clean, signal)
    },
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("unexpected_arguments")
    const result = await runMigrationJob()
    process.stdout.write(
      `${JSON.stringify({ event: "migration.completed", ...result })}\n`
    )
  } catch {
    process.stderr.write("[migration-job] status=failed\n")
    process.exitCode = 1
  }
}
