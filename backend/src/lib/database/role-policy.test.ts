import {
  evaluateDatabaseRole,
  parseDatabaseRoleProfile,
  type DatabaseRoleFacts,
} from "./role-policy"

const safeFacts = (
  overrides: Partial<DatabaseRoleFacts> = {}
): DatabaseRoleFacts => ({
  backupWrite: false,
  bypassRls: false,
  createDatabase: false,
  createRole: false,
  defaultAdministrator: false,
  databaseCreate: false,
  effectiveReadAllData: false,
  membershipAdmin: false,
  ownsObjects: false,
  privilegedMembership: false,
  readAllData: false,
  replication: false,
  reachablePrivilegedRole: false,
  schemaCreate: false,
  superuser: false,
  tls: false,
  transport: "railway_private",
  writeAllData: false,
  ...overrides,
})

describe("database role policy", () => {
  it("accepts a narrow runtime role over Railway private networking", () => {
    expect(evaluateDatabaseRole("runtime", safeFacts())).toEqual([])
  })

  it("rejects every cluster-wide privilege for application roles", () => {
    expect(
      evaluateDatabaseRole(
        "runtime",
        safeFacts({
          bypassRls: true,
          createDatabase: true,
          createRole: true,
          defaultAdministrator: true,
          replication: true,
          superuser: true,
        })
      )
    ).toEqual([
      "default_administrator",
      "superuser",
      "createdb",
      "createrole",
      "replication",
      "bypassrls",
    ])
  })

  it("requires actual TLS negotiation for a public TLS connection", () => {
    expect(
      evaluateDatabaseRole(
        "runtime",
        safeFacts({ transport: "tls", tls: false })
      )
    ).toContain("tls_not_negotiated")
  })

  it("requires a read-only predefined membership for the backup role", () => {
    expect(evaluateDatabaseRole("backup", safeFacts())).toContain(
      "backup_missing_pg_read_all_data"
    )
    expect(
      evaluateDatabaseRole(
        "backup",
        safeFacts({ readAllData: true, writeAllData: true })
      )
    ).toContain("backup_has_pg_write_all_data")
  })

  it("rejects broad read membership for migration and runtime roles", () => {
    expect(
      evaluateDatabaseRole("migration", safeFacts({ readAllData: true }))
    ).toContain("migration_has_pg_read_all_data")
    expect(
      evaluateDatabaseRole("runtime", safeFacts({ readAllData: true }))
    ).toContain("runtime_has_pg_read_all_data")
  })

  it.each(["runtime", "migration"] as const)(
    "rejects broad write membership for %s",
    (profile) => {
      expect(
        evaluateDatabaseRole(profile, safeFacts({ writeAllData: true }))
      ).toEqual([`${profile}_has_pg_write_all_data`])
    }
  )

  it("parses only the three reviewed profiles", () => {
    expect(parseDatabaseRoleProfile("migration")).toBe("migration")
    expect(() => parseDatabaseRoleProfile("postgres")).toThrow(
      "DATABASE_ROLE_PROFILE"
    )
  })

  it.each(["runtime", "backup"] as const)(
    "rejects effective DDL and ownership for %s without rejecting migration authority",
    (profile) => {
      const facts = safeFacts({
        databaseCreate: true,
        schemaCreate: true,
        ownsObjects: true,
        readAllData: profile === "backup",
        effectiveReadAllData: profile === "backup",
      })
      expect(evaluateDatabaseRole(profile, facts)).toEqual([
        `${profile}_has_database_create`,
        `${profile}_has_schema_create`,
        `${profile}_has_object_ownership`,
      ])
      expect(
        evaluateDatabaseRole("migration", {
          ...facts,
          readAllData: false,
          effectiveReadAllData: false,
        })
      ).toEqual([])
    }
  )

  it.each(["runtime", "migration", "backup"] as const)(
    "rejects reachable cluster authority for %s even when login attributes are safe",
    (profile) => {
      expect(
        evaluateDatabaseRole(
          profile,
          safeFacts({
            privilegedMembership: true,
            reachablePrivilegedRole: true,
            readAllData: profile === "backup",
            effectiveReadAllData: profile === "backup",
          })
        )
      ).toEqual(["reachable_privileged_role", "privileged_membership"])
    }
  )

  it("requires effective backup reads rather than dormant NOINHERIT membership", () => {
    expect(
      evaluateDatabaseRole("backup", safeFacts({ readAllData: true }))
    ).toEqual(["backup_missing_effective_pg_read_all_data"])
    expect(
      evaluateDatabaseRole(
        "backup",
        safeFacts({ readAllData: true, effectiveReadAllData: true })
      )
    ).toEqual([])
  })

  it.each(["runtime", "migration", "backup"] as const)(
    "rejects membership administration for %s",
    (profile) => {
      expect(
        evaluateDatabaseRole(
          profile,
          safeFacts({
            membershipAdmin: true,
            readAllData: profile === "backup",
            effectiveReadAllData: profile === "backup",
          })
        )
      ).toEqual(["membership_admin"])
    }
  )

  it("rejects backup object writes while preserving runtime DML", () => {
    const facts = safeFacts({ backupWrite: true })
    expect(evaluateDatabaseRole("runtime", facts)).toEqual([])
    expect(
      evaluateDatabaseRole("backup", {
        ...facts,
        readAllData: true,
        effectiveReadAllData: true,
      })
    ).toEqual(["backup_has_write_privileges"])
  })
})
