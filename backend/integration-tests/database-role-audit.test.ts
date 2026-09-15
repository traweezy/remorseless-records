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

  describe("large-object authority on PostgreSQL 16 and 18", () => {
    beforeEach(async () => {
      await client.query(`
        select pg_catalog.lo_create(99042001);
        grant pg_read_all_data to rr_audit_subject with inherit true;
      `)
    })

    it.each([
      {
        label: "no large-object grant",
        setup: "select 1",
        writable: false,
      },
      {
        label: "SELECT without UPDATE",
        setup: "grant select on large object 99042001 to rr_audit_subject",
        writable: false,
      },
      {
        label: "UPDATE without SELECT",
        setup: "grant update on large object 99042001 to rr_audit_subject",
        writable: true,
        writeAllowed: false,
      },
      {
        label: "direct SELECT and UPDATE",
        setup:
          "grant select, update on large object 99042001 to rr_audit_subject",
        writable: true,
      },
      {
        label: "PUBLIC UPDATE",
        setup: "grant select, update on large object 99042001 to public",
        writable: true,
      },
      {
        label: "inherited UPDATE without SET",
        setup: `
          grant select, update on large object 99042001 to rr_audit_bridge;
          grant rr_audit_bridge to rr_audit_subject with inherit true, set false;
        `,
        writable: true,
      },
      {
        label: "UPDATE reachable only through SET",
        setup: `
          grant select, update on large object 99042001 to rr_audit_bridge;
          grant rr_audit_bridge to rr_audit_subject with inherit false, set true;
        `,
        probeRole: "set role rr_audit_bridge",
        writable: true,
      },
      {
        label: "inert UPDATE membership",
        setup: `
          grant select, update on large object 99042001 to rr_audit_bridge;
          grant rr_audit_bridge to rr_audit_subject with inherit false, set false;
        `,
        writable: false,
      },
      {
        label: "owner's default ACL",
        setup: "alter large object 99042001 owner to rr_audit_subject",
        writable: true,
      },
      {
        label: "owner's revoked UPDATE",
        setup: `
          alter large object 99042001 owner to rr_audit_subject;
          revoke update on large object 99042001 from rr_audit_subject;
        `,
        writable: false,
      },
      {
        label: "large-object compatibility bypass",
        setup: "set local lo_compat_privileges = on",
        writable: true,
      },
    ])("detects $label without weakening backup policy", async (fixture) => {
      await client.query(fixture.setup)
      const result = await inspectFixture("backup")
      expect(result.facts.backupWrite).toBe(fixture.writable)
      expect(result.reasons.includes("backup_has_write_privileges")).toBe(
        fixture.writable
      )

      // PostgreSQL 18's built-in privilege function is an independent oracle;
      // PostgreSQL 16 still exercises every case through actual lo_put below.
      const version = await client.query<{ version: number }>(
        "select current_setting('server_version_num')::integer as version"
      )
      expect(version.rows).toHaveLength(1)
      const serverVersion = version.rows[0]?.version
      expect(Number.isInteger(serverVersion)).toBe(true)
      if (serverVersion !== undefined && serverVersion >= 180000) {
        const native = await client.query<{ writable: boolean }>(`
          select exists (
            select 1 from pg_catalog.pg_roles as principal
            where (principal.rolname in (session_user, current_user)
              or pg_catalog.pg_has_role(session_user, principal.oid, 'SET'))
              and pg_catalog.has_largeobject_privilege(principal.oid, 99042001, 'UPDATE')
          ) as writable
        `)
        expect(native.rows).toEqual([{ writable: fixture.writable }])
      }

      if ("probeRole" in fixture) await client.query(fixture.probeRole)
      await client.query("savepoint large_object_write_probe")
      let allowed = false
      try {
        await client.query("select pg_catalog.lo_put($1, 0, $2)", [
          99042001,
          Buffer.from("isolated role audit fixture"),
        ])
        allowed = true
      } catch (error) {
        expect(error).toMatchObject({ code: "42501" })
      } finally {
        await client.query("rollback to savepoint large_object_write_probe")
      }
      // lo_put opens a descriptor for both reading and writing. An UPDATE-only
      // grant still violates backup policy even when SELECT blocks this call.
      expect(allowed).toBe(
        "writeAllowed" in fixture ? fixture.writeAllowed : fixture.writable
      )
    })

    it("detects superuser writes even when the object ACL grants nothing", async () => {
      await client.query(`
        drop table rr_audit_fixture.records;
        drop sequence rr_audit_fixture.record_ids;
        revoke all on large object 99042001 from postgres;
      `)
      const facts = await inspectDatabaseRole(client, "local")
      expect(facts.superuser).toBe(true)
      expect(facts.backupWrite).toBe(true)
      expect(evaluateDatabaseRole("backup", facts)).toContain(
        "backup_has_write_privileges"
      )
      await client.query("select pg_catalog.lo_put($1, 0, $2)", [
        99042001,
        Buffer.from("isolated superuser fixture"),
      ])
    })
  })
})
