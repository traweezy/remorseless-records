import {
  DATABASE_ROLE_AUDIT_QUERY,
  inspectDatabaseRole,
  runDatabaseRoleAudit,
} from "./role-audit"

const validRow = () => ({
  backup_write: false,
  bypass_rls: false,
  create_database: false,
  create_role: false,
  database_create: false,
  default_administrator: false,
  effective_read_all_data: false,
  membership_admin: false,
  owns_objects: false,
  privileged_membership: false,
  read_all_data: false,
  reachable_privileged_role: false,
  replication: false,
  schema_create: false,
  superuser: false,
  tls: false,
  write_all_data: false,
})

const createClient = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  end: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue({ rows: [validRow()] }),
})

describe("read-only database role inspection", () => {
  it("maps a complete boolean row through one read-only query", async () => {
    const client = createClient()
    const facts = await inspectDatabaseRole(client, "tls")
    expect(client.query).toHaveBeenCalledTimes(1)
    expect(client.query).toHaveBeenCalledWith(DATABASE_ROLE_AUDIT_QUERY)
    expect(facts).toEqual({
      backupWrite: false,
      bypassRls: false,
      createDatabase: false,
      createRole: false,
      databaseCreate: false,
      defaultAdministrator: false,
      effectiveReadAllData: false,
      membershipAdmin: false,
      ownsObjects: false,
      privilegedMembership: false,
      readAllData: false,
      reachablePrivilegedRole: false,
      replication: false,
      schemaCreate: false,
      superuser: false,
      tls: false,
      transport: "tls",
      writeAllData: false,
    })
    expect(DATABASE_ROLE_AUDIT_QUERY).not.toMatch(
      /\b(?:insert|update|delete|create|grant|revoke|alter|drop|set)\s+(?:role|table|schema|database|session)\b/iu
    )
  })

  it.each(Object.keys(validRow()))(
    "rejects a non-boolean %s fact",
    async (column) => {
      const client = createClient()
      client.query.mockResolvedValue({
        rows: [{ ...validRow(), [column]: "false" }],
      })
      await expect(
        inspectDatabaseRole(client, "railway_private")
      ).rejects.toThrow("invalid_role_facts")
    }
  )

  it.each([
    { rows: [] },
    { rows: [null] },
    { rows: [false] },
    { rows: [[]] },
    { rows: [validRow(), validRow()] },
  ])("rejects an incomplete or ambiguous result %#", async ({ rows }) => {
    const client = createClient()
    client.query.mockResolvedValue({ rows })
    await expect(
      inspectDatabaseRole(client, "railway_private")
    ).rejects.toThrow("invalid_role_facts")
  })

  it("rejects inherited rather than returned boolean facts", async () => {
    const client = createClient()
    client.query.mockResolvedValue({ rows: [Object.create(validRow())] })
    await expect(
      inspectDatabaseRole(client, "railway_private")
    ).rejects.toThrow("invalid_role_facts")
  })
})

describe("database audit lifecycle and redaction", () => {
  it("connects, accepts least privilege and closes exactly once", async () => {
    const client = createClient()
    await expect(
      runDatabaseRoleAudit({
        client,
        profile: "runtime",
        transport: "railway_private",
      })
    ).resolves.toEqual({ status: "accepted" })
    expect(client.connect).toHaveBeenCalledTimes(1)
    expect(client.end).toHaveBeenCalledTimes(1)
    expect(client.connect.mock.invocationCallOrder[0]).toBeLessThan(
      client.query.mock.invocationCallOrder[0] ?? 0
    )
    expect(client.query.mock.invocationCallOrder[0]).toBeLessThan(
      client.end.mock.invocationCallOrder[0] ?? 0
    )
  })

  it("reports only fixed rejection reasons and closes rejected inspections", async () => {
    const client = createClient()
    client.query.mockResolvedValue({
      rows: [
        { ...validRow(), database_create: true, role: "private_role_name" },
      ],
    })
    await expect(
      runDatabaseRoleAudit({
        client,
        profile: "runtime",
        transport: "railway_private",
      })
    ).resolves.toEqual({
      status: "rejected",
      reasons: ["runtime_has_database_create"],
    })
    expect(client.end).toHaveBeenCalledTimes(1)
  })

  it.each(["connect", "query", "end"] as const)(
    "redacts %s failures and attempts cleanup",
    async (method) => {
      const client = createClient()
      client[method].mockRejectedValue(
        new Error(
          "postgresql://private_role:private_password@private_host/private_database"
        )
      )
      const result = await runDatabaseRoleAudit({
        client,
        profile: "runtime",
        transport: "railway_private",
      })
      expect(result).toEqual({ status: "failed" })
      expect(JSON.stringify(result)).not.toContain("private_")
      expect(client.end).toHaveBeenCalledTimes(1)
      if (method === "connect") expect(client.query).not.toHaveBeenCalled()
    }
  )
})
