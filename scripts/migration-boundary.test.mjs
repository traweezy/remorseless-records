import assert from "node:assert/strict"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  migrationContext,
  migrationMode,
  recordMigration,
  waitForMigrationReceipt,
} from "../backend/scripts/migration-receipt.mjs"
import {
  migrationJobEnvironment,
  runMigrationJob,
} from "../backend/scripts/migration-job.mjs"

const environment = {
  RAILWAY_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
  RAILWAY_ENVIRONMENT_ID: "22222222-2222-4222-8222-222222222222",
  DATABASE_MIGRATION_SERVICE_ID: "33333333-3333-4333-8333-333333333333",
  RAILWAY_SERVICE_ID: "33333333-3333-4333-8333-333333333333",
  RAILWAY_DEPLOYMENT_ID: "44444444-4444-4444-8444-444444444444",
  RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
  DATABASE_URL:
    "postgresql://app_migrator:fixture@postgres.railway.internal:5432/railway",
}
const context = migrationContext(environment)

test("Medusa dotenv cannot enable integrations in a migration child", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rr-migration-env-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const keys = [
    "REDIS_URL",
    "RESEND_API_KEY",
    "STRIPE_API_KEY",
    "MEILISEARCH_HOST",
    "MINIO_ENDPOINT",
    "TAX_RATE_LOOKUP_API_KEY",
  ]
  await writeFile(
    join(directory, ".env"),
    keys.map((key) => `${key}=unexpected-provider`).join("\n")
  )
  const require = createRequire(
    new URL("../backend/package.json", import.meta.url)
  )
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `require(${JSON.stringify(require.resolve("@medusajs/utils"))}).loadEnv("development",${JSON.stringify(directory)});console.log(JSON.stringify(${JSON.stringify(keys)}.map(k=>process.env[k])))`,
    ],
    {
      encoding: "utf8",
      env: migrationJobEnvironment(environment),
      timeout: 10000,
    }
  )
  assert.equal(result.status, 0)
  assert.deepEqual(
    JSON.parse(result.stdout),
    keys.map(() => "")
  )
})
const fixture = ({
  reader = true,
  trusted = true,
  allowed = true,
  acquired = true,
  present = true,
} = {}) => {
  const events = []
  return {
    events,
    async connect() {
      events.push("connect")
    },
    async end() {
      events.push("end")
    },
    async query(sql, values) {
      events.push({ sql, values })
      if (sql.includes("as allowed")) return { rows: [{ allowed }] }
      if (sql.includes("as acquired")) return { rows: [{ acquired }] }
      if (sql.includes("as trusted")) return { rows: [{ trusted, reader }] }
      if (sql.includes("select deployment_id"))
        return {
          rows: present
            ? [{ deployment_id: environment.RAILWAY_DEPLOYMENT_ID }]
            : [],
        }
      return { rows: [] }
    },
  }
}

test("migration context rejects missing, malformed and abbreviated identities", () => {
  for (const key of [
    "RAILWAY_PROJECT_ID",
    "RAILWAY_ENVIRONMENT_ID",
    "DATABASE_MIGRATION_SERVICE_ID",
    "RAILWAY_GIT_COMMIT_SHA",
  ])
    for (const value of [undefined, "", "a".repeat(7), "../unexpected"])
      assert.throws(() => migrationContext({ ...environment, [key]: value }))
  assert.equal(migrationMode({}), "inline")
  assert.equal(
    migrationMode({ DATABASE_MIGRATION_MODE: "external" }),
    "external"
  )
  assert.throws(() => migrationMode({ DATABASE_MIGRATION_MODE: "externl" }))
})

test("only a trusted read-only exact-scope receipt releases runtime", async () => {
  const client = fixture()
  assert.deepEqual(await waitForMigrationReceipt({ client, context }), {
    revision: context.revision,
    migrationCompleted: true,
  })
  const query = client.events.find((event) =>
    event.sql?.includes("select deployment_id")
  )
  assert.deepEqual(query.values, [
    context.project,
    context.environment,
    context.service,
    context.revision,
  ])
  assert.equal(client.events.at(-1), "end")
  for (const override of [{ reader: false }, { trusted: false }]) {
    const rejected = fixture(override)
    await assert.rejects(
      waitForMigrationReceipt({ client: rejected, context }),
      /migration_boundary_rejected/u
    )
    assert.equal(
      rejected.events.some((event) =>
        event.sql?.includes("select deployment_id")
      ),
      false
    )
    assert.equal(rejected.events.at(-1), "end")
  }
})

test("missing or stale receipt times out and closes without any writes", async () => {
  for (const tableMissing of [false, true]) {
    const client = fixture({ present: false })
    const original = client.query.bind(client)
    client.query = async (sql, values) => {
      const result = await original(sql, values)
      return tableMissing && sql.includes("as trusted") ? { rows: [] } : result
    }
    let time = 0
    await assert.rejects(
      waitForMigrationReceipt({
        client,
        context,
        timeoutMs: 5,
        intervalMs: 2,
        now: () => time,
        sleep: async (ms) => {
          time += ms
        },
      }),
      /migration_receipt_timeout/u
    )
    assert.equal(time, 5)
    assert.equal(client.events.at(-1), "end")
    assert.ok(
      client.events
        .filter((event) => event.sql)
        .every((event) => event.sql.trim().startsWith("select"))
    )
  }
})

test("writer invalidates the old receipt before migration and records only success", async () => {
  for (const fail of [false, true]) {
    const client = fixture()
    const work = recordMigration({
      client,
      context,
      deployment: environment.RAILWAY_DEPLOYMENT_ID,
      migrate: async () => {
        assert.equal(client.events.at(-1).sql, "commit")
        client.events.push("migrate")
        if (fail) throw new Error("fixture migration failed")
      },
    })
    if (fail) await assert.rejects(work, /fixture migration failed/u)
    else await work
    const insert = client.events.find((event) =>
      event.sql?.startsWith("insert")
    )
    assert.equal(Boolean(insert), !fail)
    if (insert)
      assert.deepEqual(insert.values, [
        context.project,
        context.environment,
        context.service,
        context.revision,
        environment.RAILWAY_DEPLOYMENT_ID,
      ])
    assert.equal(client.events.at(-1), "end")
  }
})

test("wrong authority or a concurrent migration prevents all schema changes", async () => {
  for (const override of [{ allowed: false }, { acquired: false }]) {
    const client = fixture(override)
    await assert.rejects(
      recordMigration({
        client,
        context,
        deployment: environment.RAILWAY_DEPLOYMENT_ID,
        migrate: async () => assert.fail("must not migrate"),
      })
    )
    assert.equal(
      client.events.some((event) => event.sql === "begin"),
      false
    )
    assert.equal(client.events.at(-1), "end")
  }
})

test("losing the lock connection aborts the migration and cannot certify success", async () => {
  const client = fixture()
  let disconnected
  client.on = (name, listener) => {
    assert.equal(name, "error")
    disconnected = listener
  }
  await assert.rejects(
    recordMigration({
      client,
      context,
      deployment: environment.RAILWAY_DEPLOYMENT_ID,
      migrate: async ({ signal }) => {
        disconnected()
        assert.equal(signal.aborted, true)
      },
    }),
    { name: "AbortError" }
  )
  assert.equal(
    client.events.some((event) => event.sql?.startsWith("insert")),
    false
  )
  assert.equal(client.events.at(-1), "end")
})

test("migration children get the database credential and no application integrations", async () => {
  const input = {
    ...environment,
    RESEND_API_KEY: "provider-secret",
    REDIS_URL: "shared-redis",
    STRIPE_API_KEY: "provider-secret",
    NODE_OPTIONS: "--require untrusted",
  }
  const child = migrationJobEnvironment(input)
  for (const name of [
    "RESEND_API_KEY",
    "REDIS_URL",
    "STRIPE_API_KEY",
    "NODE_OPTIONS",
  ])
    assert.equal(child[name], name === "NODE_OPTIONS" ? undefined : "")
  assert.equal(child.NODE_ENV, "development")
  assert.notEqual(child.JWT_SECRET, migrationJobEnvironment(input).JWT_SECRET)
  const calls = []
  const client = fixture()
  await runMigrationJob({
    environment: input,
    clientFactory: () => client,
    run(_file, args, options) {
      calls.push(args)
      assert.equal(options.env.RESEND_API_KEY, "")
      assert.equal(options.env.REDIS_URL, "")
      assert.equal(options.env.DATABASE_URL, environment.DATABASE_URL)
      assert.equal(options.shell, false)
      return { status: 0 }
    },
  })
  assert.match(calls[0][0], /audit-database-role\.js$/u)
  assert.deepEqual(
    calls.slice(1).map((args) => args[1]),
    ["db:migrate", "db:sync-links"]
  )
})

test("job rejects wrong service, privileged overrides and failed role audit before DDL", async () => {
  for (const override of [
    { RAILWAY_SERVICE_ID: environment.RAILWAY_PROJECT_ID },
    {
      DATABASE_URL: environment.DATABASE_URL.replace(
        "app_migrator",
        "postgres"
      ),
    },
    { PGOPTIONS: "-crole=postgres" },
    { DATABASE_BACKUP_URL: "unexpected" },
    { DATABASE_SOURCE_IDENTITY_URL: "unexpected" },
  ])
    await assert.rejects(
      runMigrationJob({
        environment: { ...environment, ...override },
        run: () => assert.fail("must reject before commands"),
      })
    )
  await assert.rejects(
    runMigrationJob({
      environment,
      clientFactory: () => assert.fail("must not connect"),
      run: () => ({ status: 1 }),
    }),
    /migration_step_failed/u
  )
})
