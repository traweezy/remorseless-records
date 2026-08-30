import type { PostgreSqlClient } from "./standalone-postgres"

const mockQuery = jest.fn<Promise<{ rows: never[] }>, [string, unknown[]?]>()
const mockPostgreSqlClient = {
  connect: jest.fn<Promise<void>, []>(),
  end: jest.fn<Promise<void>, []>(),
  query: mockQuery as PostgreSqlClient["query"],
} satisfies PostgreSqlClient
const mockClientConstructor = jest
  .fn()
  .mockImplementation(() => mockPostgreSqlClient)

jest.mock("pg", () => ({
  Client: mockClientConstructor,
}))

import { createPostgreSqlClient, rollbackQuietly } from "./standalone-postgres"

const originalDatabaseUrl = process.env.DATABASE_URL
const originalNodeEnvironment = process.env.NODE_ENV

beforeEach(() => {
  jest.clearAllMocks()
  process.env.DATABASE_URL =
    "postgresql://runtime:secret@localhost:5432/remorseless"
  process.env.NODE_ENV = "test"
})

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl
  }
  if (originalNodeEnvironment === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnvironment
  }
})

describe("standalone PostgreSQL client", () => {
  it("constructs a bounded CLI connection", async () => {
    await expect(createPostgreSqlClient("database-role-audit")).resolves.toBe(
      mockPostgreSqlClient
    )
    expect(mockClientConstructor).toHaveBeenCalledWith({
      application_name: "database-role-audit",
      connectionString:
        "postgresql://runtime:secret@localhost:5432/remorseless",
      connectionTimeoutMillis: 10_000,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    })
  })

  it("fails closed when the database URL is absent", async () => {
    delete process.env.DATABASE_URL

    await expect(createPostgreSqlClient("database-role-audit")).rejects.toThrow(
      "[database-cli] DATABASE_URL is required."
    )
  })
})

describe("rollbackQuietly", () => {
  it("attempts rollback without replacing the original failure", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await expect(rollbackQuietly(mockPostgreSqlClient)).resolves.toBeUndefined()

    mockQuery.mockRejectedValueOnce(new Error("rollback unavailable"))
    await expect(rollbackQuietly(mockPostgreSqlClient)).resolves.toBeUndefined()
    expect(mockQuery).toHaveBeenNthCalledWith(1, "rollback")
    expect(mockQuery).toHaveBeenNthCalledWith(2, "rollback")
  })
})
