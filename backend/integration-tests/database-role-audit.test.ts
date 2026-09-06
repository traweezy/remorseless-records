import { inspectDatabaseRole } from "../src/lib/database/role-audit"
import {
  evaluateDatabaseRole,
  type DatabaseRoleProfile,
} from "../src/lib/database/role-policy"
import {
  createPostgreSqlClient,
  type PostgreSqlClient,
} from "../src/lib/database/standalone-postgres"

// These fixtures create transactional roles/grants only on the explicit local
// integration service. Refuse remote URLs and any ambient application password.
const fixtureUrl = new URL(process.env.DATABASE_URL ?? "postgresql://invalid")
if (
  process.env.INTEGRATION_TESTS_ENABLED !== "1" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(fixtureUrl.hostname) ||
  fixtureUrl.username !== "postgres" ||
  fixtureUrl.password !== "local_integration_only" ||
  fixtureUrl.pathname !== "/postgres"
) {
  throw new Error(
    "Role audit integration requires the disposable local PostgreSQL fixture."
  )
}

let client: PostgreSqlClient
let connected = false
let transactionStarted = false

const inspectFixture = async (profile: DatabaseRoleProfile = "runtime") => {
  await client.query("set session authorization rr_audit_subject")
  const facts = await inspectDatabaseRole(client, "local")
  return { facts, reasons: evaluateDatabaseRole(profile, facts) }
}

beforeAll(async () => {
  client = await createPostgreSqlClient("disposable-role-audit")
  await client.connect()
  connected = true
})

beforeEach(async () => {
  if (!connected)
    throw new Error("Disposable role-audit connection unavailable.")
  await client.query("begin")
  transactionStarted = true
  await client.query(`
    create role rr_audit_subject nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
    create role rr_audit_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
    create role rr_audit_bridge nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
    create schema rr_audit_fixture authorization rr_audit_owner;
    create table rr_audit_fixture.records (id integer, label text);
    create sequence rr_audit_fixture.record_ids;
    grant usage on schema rr_audit_fixture to rr_audit_subject;
  `)
})

afterEach(async () => {
  if (!transactionStarted) return
  try {
    await client.query("rollback")
  } finally {
    transactionStarted = false
    await client.query("reset session authorization")
  }
})

afterAll(async () => {
  await client?.end()
})

describe("real PostgreSQL role audit", () => {
  it("accepts a non-owning runtime with only application DML and sequence use", async () => {
    await client.query(`
      grant select, insert, update, delete on rr_audit_fixture.records to rr_audit_subject;
      grant usage on sequence rr_audit_fixture.record_ids to rr_audit_subject;
    `)
    const result = await inspectFixture()
    expect(result.reasons).toEqual([])
    expect(result.facts.backupWrite).toBe(true)
  })

  it("does not hide the login's authority behind an initially narrowed SET ROLE", async () => {
    await client.query("set role rr_audit_subject")
    const facts = await inspectDatabaseRole(client, "local")
    expect(facts.defaultAdministrator).toBe(true)
    expect(facts.superuser).toBe(true)
    expect(evaluateDatabaseRole("runtime", facts)).toContain("superuser")
  })

  it.each([
    [
      "grant create on database postgres to rr_audit_subject",
      "runtime_has_database_create",
    ],
    [
      "grant create on database postgres to public",
      "runtime_has_database_create",
    ],
    [
      "grant create on schema rr_audit_fixture to rr_audit_subject",
      "runtime_has_schema_create",
    ],
    [
      "grant create on schema rr_audit_fixture to public",
      "runtime_has_schema_create",
    ],
    [
      "alter table rr_audit_fixture.records owner to rr_audit_subject",
      "runtime_has_object_ownership",
    ],
    [
      "alter sequence rr_audit_fixture.record_ids owner to rr_audit_subject",
      "runtime_has_object_ownership",
    ],
    [
      "alter database postgres owner to rr_audit_subject",
      "runtime_has_object_ownership",
    ],
    [
      "create function rr_audit_fixture.answer() returns integer language sql as 'select 42'; alter function rr_audit_fixture.answer() owner to rr_audit_subject",
      "runtime_has_object_ownership",
    ],
    [
      "create type rr_audit_fixture.category as enum ('fixture'); alter type rr_audit_fixture.category owner to rr_audit_subject",
      "runtime_has_object_ownership",
    ],
  ])("rejects real authority: %s", async (setup, reason) => {
    await client.query(setup)
    expect((await inspectFixture()).reasons).toContain(reason)
  })

  it("detects ownership inherited without SET permission", async () => {
    await client.query(
      "grant rr_audit_owner to rr_audit_subject with inherit true, set false"
    )
    expect((await inspectFixture()).reasons).toEqual(
      expect.arrayContaining([
        "runtime_has_schema_create",
        "runtime_has_object_ownership",
      ])
    )
  })

  it("detects ownership reachable only after NOINHERIT SET ROLE", async () => {
    await client.query(
      "grant rr_audit_owner to rr_audit_subject with inherit false, set true"
    )
    expect((await inspectFixture()).reasons).toEqual(
      expect.arrayContaining([
        "runtime_has_schema_create",
        "runtime_has_object_ownership",
      ])
    )
  })

  it("does not confuse inert membership with inherited or SET authority", async () => {
    await client.query(
      "grant rr_audit_owner to rr_audit_subject with inherit false, set false"
    )
    expect((await inspectFixture()).reasons).toEqual([])
  })

  it.each(["runtime", "migration", "backup"] as const)(
    "rejects ADMIN OPTION on an otherwise inert membership for %s",
    async (profile) => {
      await client.query(
        "grant rr_audit_owner to rr_audit_subject with inherit false, set false, admin true"
      )
      if (profile === "backup") {
        await client.query(
          "grant pg_read_all_data to rr_audit_subject with inherit true"
        )
      }
      const result = await inspectFixture(profile)
      expect(result.facts.schemaCreate).toBe(false)
      expect(result.facts.ownsObjects).toBe(false)
      expect(result.reasons).toEqual(["membership_admin"])
    }
  )

  it("detects ADMIN OPTION reachable through SET ROLE", async () => {
    await client.query(`
      grant rr_audit_owner to rr_audit_bridge with inherit false, set false, admin true;
      grant rr_audit_bridge to rr_audit_subject with inherit false, set true;
    `)
    expect((await inspectFixture("migration")).reasons).toEqual([
      "membership_admin",
    ])
  })

  it("preserves legitimate migration ownership through NOINHERIT SET ROLE", async () => {
    await client.query(
      "grant rr_audit_owner to rr_audit_subject with inherit false, set true"
    )
    expect((await inspectFixture("migration")).reasons).toEqual([])
  })

  it("detects multi-hop SET privilege escalation with safe login attributes", async () => {
    await client.query(`
      alter role rr_audit_owner createdb;
      grant rr_audit_owner to rr_audit_bridge with inherit false, set true;
      grant rr_audit_bridge to rr_audit_subject with inherit false, set true;
    `)
    const result = await inspectFixture("migration")
    expect(result.facts.createDatabase).toBe(false)
    expect(result.reasons).toContain("reachable_privileged_role")
  })

  it("does not inherit cluster attributes across a SET FALSE edge", async () => {
    await client.query(`
      alter role rr_audit_bridge createdb;
      grant rr_audit_bridge to rr_audit_subject with inherit true, set false;
    `)
    expect((await inspectFixture()).reasons).toEqual([])
  })

  it("detects inherited privileges after a multi-hop SET transition", async () => {
    await client.query(`
      grant pg_execute_server_program to rr_audit_owner with inherit true, set false;
      grant rr_audit_owner to rr_audit_bridge with inherit true, set false;
      grant rr_audit_bridge to rr_audit_subject with inherit false, set true;
    `)
    expect((await inspectFixture("migration")).reasons).toContain(
      "privileged_membership"
    )
  })

  it("accepts a usable read-only backup identity", async () => {
    await client.query(
      "grant pg_read_all_data to rr_audit_subject with inherit true"
    )
    expect((await inspectFixture("backup")).reasons).toEqual([])
  })

  it("rejects a backup identity that cannot immediately inherit its read grant", async () => {
    await client.query(
      "grant pg_read_all_data to rr_audit_subject with inherit false, set true"
    )
    expect((await inspectFixture("backup")).reasons).toEqual([
      "backup_missing_effective_pg_read_all_data",
    ])
  })

  it.each([
    "grant update (label) on rr_audit_fixture.records to rr_audit_subject",
    "grant usage on sequence rr_audit_fixture.record_ids to rr_audit_subject",
    "grant insert on rr_audit_fixture.records to rr_audit_bridge; grant rr_audit_bridge to rr_audit_subject with inherit false, set true",
  ])("rejects backup write capability: %s", async (setup) => {
    await client.query(
      "grant pg_read_all_data to rr_audit_subject with inherit true"
    )
    await client.query(setup)
    expect((await inspectFixture("backup")).reasons).toContain(
      "backup_has_write_privileges"
    )
  })
})
