import assert from "node:assert/strict"
import test from "node:test"
import { buildPostgresRoleSplitPlan } from "./lib/postgres-role-split.mjs"
import {
  recordMigration,
  waitForMigrationReceipt,
} from "../backend/scripts/migration-receipt.mjs"

const input = {
  database: "railway",
  enumTypes: ["order_status_enum"],
  tables: [
    "product",
    "link_module_migrations",
    "mikro_orm_migrations",
    "script_migrations",
  ],
  sequences: ["product_id_seq", "script_migrations_id_seq"],
}

test("role plans reject unexpected identifiers and incomplete migration inventory", () => {
  for (const database of [
    "railway'; drop database railway;--",
    "",
    "a".repeat(64),
  ])
    assert.throws(() => buildPostgresRoleSplitPlan({ ...input, database }))
  assert.throws(() =>
    buildPostgresRoleSplitPlan({ ...input, tables: ["product"] })
  )
  assert.throws(() =>
    buildPostgresRoleSplitPlan({ ...input, sequences: ["x", "x"] })
  )
  assert.throws(() =>
    buildPostgresRoleSplitPlan({ ...input, sequences: ["x.y"] })
  )
})

test("reviewed plan identity is stable across catalog ordering", () => {
  const plan = buildPostgresRoleSplitPlan(input)
  const reordered = buildPostgresRoleSplitPlan({
    ...input,
    tables: [...input.tables].reverse(),
    sequences: [...input.sequences].reverse(),
  })
  assert.deepEqual(plan, reordered)
  assert.notEqual(
    plan.sha256,
    buildPostgresRoleSplitPlan({ ...input, tables: [...input.tables, "cart"] })
      .sha256
  )
})

test("role plan never grants runtime writes to an existing release receipt", () => {
  const plan = buildPostgresRoleSplitPlan({
    ...input,
    tables: [...input.tables, "remorseless_migration_receipt"],
  })
  assert.match(
    plan.sql,
    /grant select on table public\."remorseless_migration_receipt" to app_runtime/u
  )
  assert.doesNotMatch(
    plan.sql,
    /grant select, insert, update, delete on table public\."remorseless_migration_receipt"/u
  )
})

test("real PostgreSQL enforces split grants and migration ownership defaults", {
  skip: process.env.INTEGRATION_TESTS_ENABLED !== "1",
  timeout: 30_000,
}, async () => {
  const { createRequire } = await import("node:module")
  const { randomUUID } = await import("node:crypto")
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid")
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol))
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  assert.equal(url.username, "postgres")
  assert.equal(url.password, "local_integration_only")
  assert.equal(url.pathname, "/postgres")
  assert.equal(url.search, "")
  assert.equal(url.hash, "")
  const require = createRequire(
    new URL("../backend/package.json", import.meta.url)
  )
  const { Client } = require("pg")
  const database = `rr_roles_${randomUUID().replaceAll("-", "")}`
  const clients = []
  const connect = async (connectionString) => {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    })
    await client.connect()
    clients.push(client)
    return client
  }
  const administrator = await connect(url.toString())
  let createdDatabase = false
  let createdRoles = false
  try {
    assert.equal(
      (
        await administrator.query(
          "select count(*) from pg_roles where rolname in ('app_owner','app_runtime','app_migrator','app_backup')"
        )
      ).rows[0].count,
      "0"
    )
    await administrator.query(`create database ${database} template template0`)
    createdDatabase = true
    url.pathname = `/${database}`
    const owner = await connect(url.toString())
    await owner.query("begin")
    await owner.query(
      "create type public.order_status_enum as enum ('pending')"
    )
    for (const table of input.tables)
      await owner.query(
        `create table public.${table} (id serial primary key, value text)`
      )
    const sequences = input.tables.map((name) => `${name}_id_seq`)
    await owner.query(
      buildPostgresRoleSplitPlan({
        database,
        tables: input.tables,
        sequences,
        enumTypes: input.enumTypes,
      }).sql
    )
    for (const role of ["app_runtime", "app_migrator", "app_backup"])
      await owner.query(
        `alter role ${role} login password 'local_role_split_only'`
      )
    await owner.query("commit")
    createdRoles = true
    const login = async (role) => {
      const connection = new URL(url)
      connection.username = role
      connection.password = "local_role_split_only"
      return connect(connection.toString())
    }
    const runtime = await login("app_runtime")
    const migration = await login("app_migrator")
    const backup = await login("app_backup")
    const denied = async (client, sql) =>
      assert.rejects(client.query(sql), { code: "42501" })
    assert.equal(
      (await migration.query("select current_user")).rows[0].current_user,
      "app_owner"
    )
    await runtime.query("insert into product(value) values('fixture')")
    await runtime.query("update product set value='updated'")
    assert.equal(
      (await backup.query("select value from product")).rows[0].value,
      "updated"
    )
    await denied(runtime, "create table public.denied (id int)")
    await denied(runtime, "create temp table denied (id int)")
    await denied(runtime, "set role app_owner")
    await denied(runtime, "update script_migrations set value='denied'")
    await denied(runtime, "select nextval('script_migrations_id_seq')")
    await denied(runtime, "truncate product")
    await denied(backup, "delete from product")
    await denied(backup, "select nextval('product_id_seq')")
    await denied(backup, "set role app_owner")
    await denied(backup, "create table public.backup_denied (id int)")
    await migration.query(
      "alter type public.order_status_enum add value 'completed'"
    )
    await migration.query(
      "create table public.next_migration (id serial primary key, value text)"
    )
    await runtime.query(
      "insert into next_migration(value) values('default grant')"
    )
    assert.equal(
      (await backup.query("select count(*) from next_migration")).rows[0].count,
      "1"
    )
    assert.equal(
      (
        await owner.query(
          "select pg_get_userbyid(relowner) as owner from pg_class where oid='public.next_migration'::regclass"
        )
      ).rows[0].owner,
      "app_owner"
    )
    await migration.query(
      "create function public.role_fixture() returns integer language sql security definer as 'select 1'"
    )
    await denied(runtime, "select public.role_fixture()")
    await denied(backup, "select public.role_fixture()")
    const context = {
      project: randomUUID(),
      environment: randomUUID(),
      service: randomUUID(),
      revision: "a".repeat(40),
    }
    const receiptClient = (role) => {
      const connection = new URL(url)
      connection.username = role
      connection.password = "local_role_split_only"
      return new Client({
        connectionString: connection.toString(),
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
      })
    }
    const writeReceipt = (migrate = async () => {}) =>
      recordMigration({
        client: receiptClient("app_migrator"),
        context,
        deployment: randomUUID(),
        migrate,
      })
    const readReceipt = (override = {}, timeoutMs = 5000) =>
      waitForMigrationReceipt({
        client: receiptClient("app_runtime"),
        context: { ...context, ...override },
        timeoutMs,
        intervalMs: 10,
      })
    await writeReceipt()
    assert.equal((await readReceipt()).migrationCompleted, true)
    for (const query of [
      "update public.remorseless_migration_receipt set revision = repeat('b',40)",
      "delete from public.remorseless_migration_receipt",
      "truncate public.remorseless_migration_receipt",
      "alter table public.remorseless_migration_receipt add column forged text",
    ])
      await denied(runtime, query)
    await assert.rejects(
      readReceipt({ revision: "b".repeat(40) }, 750),
      /migration_receipt_timeout/u
    )
    await assert.rejects(
      readReceipt({ environment: randomUUID() }, 750),
      /migration_receipt_timeout/u
    )
    await migration.query(
      "grant update on public.remorseless_migration_receipt to app_runtime"
    )
    await assert.rejects(readReceipt(), /migration_boundary_rejected/u)
    await migration.query(
      "revoke update on public.remorseless_migration_receipt from app_runtime"
    )
    await migration.query("select pg_advisory_lock(1835361377, 1919251315)")
    await assert.rejects(writeReceipt(), /migration_boundary_rejected/u)
    await migration.query("select pg_advisory_unlock(1835361377, 1919251315)")
    await assert.rejects(
      writeReceipt(async () => {
        throw new Error("fixture migration failure")
      }),
      /fixture migration failure/u
    )
    await assert.rejects(readReceipt({}, 750), /migration_receipt_timeout/u)
    await writeReceipt()
    assert.equal((await readReceipt()).migrationCompleted, true)
    await runtime.query("delete from product")
  } finally {
    for (const client of clients.slice(1).reverse()) await client.end()
    try {
      if (createdDatabase)
        await administrator.query(`drop database ${database}`)
      if (createdRoles) {
        await administrator.query(
          "drop role app_runtime, app_migrator, app_backup, app_owner"
        )
      }
    } finally {
      await administrator.end()
    }
  }
})
