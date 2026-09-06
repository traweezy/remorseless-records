import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import test, { after, afterEach, before, beforeEach } from "node:test"
import {
  RESTORE_TARGET_INVENTORY_SQL,
  RESTORE_TARGET_PREFLIGHT_SQL,
  parseRestoreInventory,
} from "./lib/postgres-restore.mjs"

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid")
if (
  process.env.INTEGRATION_TESTS_ENABLED !== "1" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.username !== "postgres" ||
  url.password !== "local_integration_only" ||
  url.pathname !== "/postgres" ||
  url.search ||
  url.hash
) {
  throw new Error(
    "Recovery integration requires the disposable local PostgreSQL fixture."
  )
}
const require = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const { Client } = require("pg")
const database = `rr_recovery_${randomUUID().replaceAll("-", "")}`
const administrator = new Client({
  connectionString: url.toString(),
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
})
let client
let created = false
let connected = false
let transaction = false

before(async () => {
  await administrator.connect()
  connected = true
  await administrator.query(`CREATE DATABASE ${database} TEMPLATE template0`)
  created = true
  url.pathname = `/${database}`
  client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  })
  await client.connect()
})
beforeEach(async () => {
  await client.query("BEGIN")
  transaction = true
})
afterEach(async () => {
  if (transaction) {
    await client.query("ROLLBACK")
    transaction = false
  }
  await client.query("RESET SESSION AUTHORIZATION")
})
after(async () => {
  try {
    await client?.end()
  } finally {
    try {
      if (created) await administrator.query(`DROP DATABASE ${database}`)
    } finally {
      if (connected) await administrator.end()
    }
  }
})

const inspect = async () => {
  const result = await client.query(RESTORE_TARGET_INVENTORY_SQL)
  assert.equal(result.rows.length, 1)
  return parseRestoreInventory(JSON.stringify(result.rows[0].json_build_object))
}

test("accepts a newly created template-zero disposable database", async () => {
  assert.deepEqual(await inspect(), { tables: 0, objects: 0 })
})

for (const [name, sql] of [
  ["empty schema", "CREATE SCHEMA rr_fixture"],
  ["sequence", "CREATE SEQUENCE public.rr_fixture"],
  [
    "routine",
    "CREATE FUNCTION public.rr_fixture() RETURNS integer LANGUAGE sql AS 'SELECT 42'",
  ],
  ["enum", "CREATE TYPE public.rr_fixture AS ENUM ('fixture')"],
  ["domain", "CREATE DOMAIN public.rr_fixture AS integer CHECK (VALUE > 0)"],
  ["view", "CREATE VIEW public.rr_fixture AS SELECT 42 AS value"],
  [
    "operator",
    "CREATE OPERATOR public.=== (LEFTARG = integer, RIGHTARG = integer, FUNCTION = pg_catalog.int4eq)",
  ],
  ["collation", 'CREATE COLLATION public.rr_fixture FROM "C"'],
  ["large object", "SELECT pg_catalog.lo_create(0)"],
  ["foreign data wrapper", "CREATE FOREIGN DATA WRAPPER rr_fixture"],
  [
    "default privileges",
    "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC",
  ],
  ["extension", "CREATE EXTENSION pg_trgm"],
])
  test(`rejects a target containing only a ${name}`, async () => {
    await client.query(sql)
    assert.ok((await inspect()).objects > 0)
  })

test("reproduces old table-only false acceptance of sequences and routines", async () => {
  await client.query(
    "CREATE SEQUENCE public.rr_sequence; CREATE FUNCTION public.rr_function() RETURNS integer LANGUAGE sql AS 'SELECT 42'"
  )
  const old = await client.query(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"
  )
  assert.equal(Number(old.rows[0].count), 0)
  assert.ok((await inspect()).objects > 0)
})

test("does not hide inaccessible tables from a restricted restore role", async () => {
  await client.query(
    "CREATE ROLE rr_recovery_restricted NOLOGIN; CREATE TABLE public.rr_private(id integer); SET SESSION AUTHORIZATION rr_recovery_restricted"
  )
  const old = await client.query(
    "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"
  )
  assert.equal(Number(old.rows[0].count), 0)
  const inventory = await inspect()
  assert.equal(inventory.tables, 1)
  assert.ok(inventory.objects > 0)
})

test("counts restored application tables using catalogs", async () => {
  await client.query(
    "CREATE TABLE public.rr_fixture(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text)"
  )
  const inventory = await inspect()
  assert.equal(inventory.tables, 1)
  assert.ok(inventory.objects > 0)
})

test("preflight prevents schema shadowing and rejects writes in its transaction", async () => {
  await client.query("ROLLBACK")
  transaction = false
  await client.query(
    "CREATE FUNCTION public.current_database() RETURNS name LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture shadow called'; END $$; SET search_path = public, pg_catalog"
  )
  try {
    const result = await client.query(RESTORE_TARGET_PREFLIGHT_SQL)
    assert.ok(
      parseRestoreInventory(JSON.stringify(result[2].rows[0].json_build_object))
        .objects > 0
    )
    await assert.rejects(
      client.query(
        RESTORE_TARGET_PREFLIGHT_SQL.replace(
          "COMMIT;",
          "CREATE TABLE public.rr_must_not_exist(id integer); COMMIT;"
        )
      ),
      { code: "25006" }
    )
  } finally {
    await client.query(
      "ROLLBACK; SET search_path = pg_catalog; DROP FUNCTION public.current_database()"
    )
  }
})
