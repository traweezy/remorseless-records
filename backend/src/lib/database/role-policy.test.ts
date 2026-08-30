import {
  evaluateDatabaseRole,
  parseDatabaseRoleProfile,
  type DatabaseRoleFacts,
} from "./role-policy"

const safeFacts = (
  overrides: Partial<DatabaseRoleFacts> = {},
): DatabaseRoleFacts => ({
  bypassRls: false,
  createDatabase: false,
  createRole: false,
  defaultAdministrator: false,
  readAllData: false,
  replication: false,
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
        }),
      ),
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
        safeFacts({ transport: "tls", tls: false }),
      ),
    ).toContain("tls_not_negotiated")
  })

  it("requires a read-only predefined membership for the backup role", () => {
    expect(evaluateDatabaseRole("backup", safeFacts())).toContain(
      "backup_missing_pg_read_all_data",
    )
    expect(
      evaluateDatabaseRole(
        "backup",
        safeFacts({ readAllData: true, writeAllData: true }),
      ),
    ).toContain("backup_has_pg_write_all_data")
  })

  it("rejects broad read membership for migration and runtime roles", () => {
    expect(
      evaluateDatabaseRole(
        "migration",
        safeFacts({ readAllData: true }),
      ),
    ).toContain("migration_has_pg_read_all_data")
    expect(
      evaluateDatabaseRole("runtime", safeFacts({ readAllData: true })),
    ).toContain("runtime_has_pg_read_all_data")
  })

  it("parses only the three reviewed profiles", () => {
    expect(parseDatabaseRoleProfile("migration")).toBe("migration")
    expect(() => parseDatabaseRoleProfile("postgres")).toThrow(
      "DATABASE_ROLE_PROFILE",
    )
  })
})
