import { createRequire } from "node:module"
import { setTimeout as pause } from "node:timers/promises"

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
const sha = /^[a-f0-9]{40}$/u
const require = createRequire(import.meta.url)
const ensure = (value) => {
  if (!value) throw new Error("migration_boundary_rejected")
}

export const migrationMode = (environment) => {
  const mode = environment.DATABASE_MIGRATION_MODE ?? "inline"
  ensure(["inline", "external"].includes(mode))
  return mode
}

export const migrationContext = (environment) => {
  const context = {
    project: environment.RAILWAY_PROJECT_ID,
    environment: environment.RAILWAY_ENVIRONMENT_ID,
    service: environment.DATABASE_MIGRATION_SERVICE_ID,
    revision: environment.RAILWAY_GIT_COMMIT_SHA,
  }
  ensure(
    uuid.test(context.project ?? "") &&
      uuid.test(context.environment ?? "") &&
      uuid.test(context.service ?? "") &&
      sha.test(context.revision ?? "")
  )
  return context
}

export const migrationClient = (connectionString) => {
  ensure(!Object.keys(process.env).some((name) => name.startsWith("PG")))
  const url = new URL(connectionString)
  ensure(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname === "postgres.railway.internal" &&
      ["", "5432"].includes(url.port) &&
      url.pathname === "/railway" &&
      url.username &&
      url.password &&
      !url.search &&
      !url.hash
  )
  const { Client } = require("pg")
  return new Client({
    connectionString,
    application_name: "remorseless-migration-boundary",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 15_000,
  })
}

export const RECEIPT_SCHEMA_SQL = `
create table if not exists public.remorseless_migration_receipt (
  project_id uuid not null,
  environment_id uuid not null,
  service_id uuid not null,
  deployment_id uuid not null,
  revision text not null check (revision ~ '^[a-f0-9]{40}$'),
  completed_at timestamptz not null default clock_timestamp(),
  primary key (project_id, environment_id)
);
revoke all on public.remorseless_migration_receipt from public, app_runtime;
grant select on public.remorseless_migration_receipt to app_runtime;
`

export const RECEIPT_AUTHORITY_SQL = `
select
  c.relkind = 'r' and not c.relrowsecurity and not c.relforcerowsecurity
    and pg_catalog.pg_get_userbyid(c.relowner) = 'app_owner'
    and not exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = c.oid and not t.tgisinternal
    ) as trusted,
  session_user = 'app_runtime' and current_user = 'app_runtime'
    and pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT')
    and not pg_catalog.has_table_privilege(current_user, c.oid,
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as reader
from pg_catalog.pg_class c
where c.oid = pg_catalog.to_regclass('public.remorseless_migration_receipt')
`

const receiptValues = (context) => [
  context.project,
  context.environment,
  context.service,
  context.revision,
]

export const waitForMigrationReceipt = async ({
  client,
  context,
  timeoutMs = 900_000,
  intervalMs = 2_000,
  now = Date.now,
  sleep = pause,
}) => {
  ensure(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 900_000
  )
  ensure(Number.isSafeInteger(intervalMs) && intervalMs > 0)
  const deadline = now() + timeoutMs
  try {
    await client.connect()
    while (now() < deadline) {
      const authority = await client.query(RECEIPT_AUTHORITY_SQL)
      ensure(authority.rows.length <= 1)
      if (authority.rows.length) {
        ensure(authority.rows[0].trusted && authority.rows[0].reader)
        const receipt = await client.query(
          `select deployment_id::text from public.remorseless_migration_receipt
           where project_id = $1 and environment_id = $2 and service_id = $3
             and revision = $4 and completed_at <= clock_timestamp()`,
          receiptValues(context)
        )
        ensure(receipt.rows.length <= 1)
        if (receipt.rows.length) {
          ensure(uuid.test(receipt.rows[0].deployment_id))
          return { revision: context.revision, migrationCompleted: true }
        }
      }
      await sleep(Math.min(intervalMs, Math.max(0, deadline - now())))
    }
    throw new Error("migration_receipt_timeout")
  } finally {
    await client.end()
  }
}

export const recordMigration = async ({
  client,
  context,
  deployment,
  migrate,
}) => {
  ensure(uuid.test(deployment ?? ""))
  const controller = new AbortController()
  const disconnected = () => controller.abort()
  client.on?.("error", disconnected)
  try {
    await client.connect()
    const authority = await client.query(
      "select session_user = 'app_migrator' and current_user = 'app_owner' as allowed"
    )
    ensure(authority.rows.length === 1 && authority.rows[0].allowed)
    const lock = await client.query(
      "select pg_try_advisory_lock(1835361377, 1919251315) as acquired"
    )
    ensure(lock.rows.length === 1 && lock.rows[0].acquired)
    // Create and narrow the receipt ACL atomically: default table grants give
    // runtime DML, which must never expose a writable release receipt.
    await client.query("begin")
    await client.query(RECEIPT_SCHEMA_SQL)
    const schema = await client.query(RECEIPT_AUTHORITY_SQL)
    ensure(schema.rows.length === 1 && schema.rows[0].trusted)
    await client.query(
      "delete from public.remorseless_migration_receipt where project_id = $1 and environment_id = $2",
      [context.project, context.environment]
    )
    await client.query("commit")
    await migrate({ signal: controller.signal })
    controller.signal.throwIfAborted()
    await client.query(
      `insert into public.remorseless_migration_receipt
       (project_id, environment_id, service_id, revision, deployment_id)
       values ($1, $2, $3, $4, $5)`,
      [...receiptValues(context), deployment]
    )
    return { revision: context.revision, migrationCompleted: true }
  } finally {
    // Disconnect releases the session lock even after a failed migration.
    await client.end()
  }
}
