const mockRunAudit = jest.fn()
const mockCreateClient = jest.fn()
const mockResolveConnection = jest.fn()
const mockParseProfile = jest.fn()

jest.mock("../lib/database/role-audit", () => ({
  runDatabaseRoleAudit: mockRunAudit,
}))
jest.mock("../lib/database/standalone-postgres", () => ({
  createPostgreSqlClient: mockCreateClient,
}))
jest.mock("../lib/database/connection-policy", () => ({
  resolveDatabaseConnection: mockResolveConnection,
}))
jest.mock("../lib/database/role-policy", () => ({
  parseDatabaseRoleProfile: mockParseProfile,
}))

const originalExitCode = process.exitCode
let stdout: jest.SpyInstance
let stderr: jest.SpyInstance

const executeCli = async () => {
  jest.isolateModules(() => {
    require("./audit-database-role")
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  jest.resetAllMocks()
  mockRunAudit.mockResolvedValue({ status: "accepted" })
  mockCreateClient.mockResolvedValue({ fixture: "client" })
  mockResolveConnection.mockReturnValue({ transport: "local" })
  mockParseProfile.mockReturnValue("runtime")
  stdout = jest.spyOn(process.stdout, "write").mockReturnValue(true)
  stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true)
  process.exitCode = undefined
})

afterEach(() => {
  stdout.mockRestore()
  stderr.mockRestore()
  process.exitCode = originalExitCode
})

describe("database role audit CLI", () => {
  it("emits a credential-free acceptance record after the inspected lifecycle", async () => {
    await executeCli()
    expect(mockCreateClient).toHaveBeenCalledWith("database-role-audit")
    expect(mockRunAudit).toHaveBeenCalledWith({
      client: { fixture: "client" },
      profile: "runtime",
      transport: "local",
    })
    expect(stdout).toHaveBeenCalledWith(
      "[database-role] profile=runtime transport=local status=accepted\n"
    )
    expect(stderr).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  it("fails with fixed policy reasons", async () => {
    mockRunAudit.mockResolvedValue({
      status: "rejected",
      reasons: ["runtime_has_schema_create", "runtime_has_object_ownership"],
    })
    await executeCli()
    expect(stderr).toHaveBeenCalledWith(
      "[database-role] profile=runtime status=rejected reasons=runtime_has_schema_create,runtime_has_object_ownership\n"
    )
    expect(stdout).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it("fails closed when the inspected connection or query is unavailable", async () => {
    mockRunAudit.mockResolvedValue({ status: "failed" })
    await executeCli()
    expect(stderr).toHaveBeenCalledWith(
      "[database-role] status=failed reason=audit_unavailable\n"
    )
    expect(process.exitCode).toBe(1)
  })

  it.each(["profile", "connection", "client"])(
    "redacts unexpected %s configuration failures",
    async (stage) => {
      const error = new Error("private_role private_host private_password")
      if (stage === "profile")
        mockParseProfile.mockImplementation(() => {
          throw error
        })
      if (stage === "connection")
        mockResolveConnection.mockImplementation(() => {
          throw error
        })
      if (stage === "client") mockCreateClient.mockRejectedValue(error)
      await executeCli()
      expect(stderr).toHaveBeenCalledWith(
        "[database-role] status=failed reason=configuration_invalid\n"
      )
      expect(JSON.stringify(stderr.mock.calls)).not.toContain("private_")
      expect(mockRunAudit).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    }
  )
})
