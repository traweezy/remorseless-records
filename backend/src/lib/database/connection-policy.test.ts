import { resolveDatabaseConnection } from "./connection-policy"

describe("database connection policy", () => {
  it("accepts Railway private networking without public TLS options", () => {
    expect(
      resolveDatabaseConnection({
        connectionString:
          "postgresql://runtime:secret@postgres.railway.internal:5432/railway",
        environment: "production",
      }),
    ).toEqual({
      connectionString:
        "postgresql://runtime:secret@postgres.railway.internal:5432/railway",
      transport: "railway_private",
    })
  })

  it("upgrades Railway public proxy URLs to encrypted libpq mode", () => {
    const result = resolveDatabaseConnection({
      connectionString:
        "postgresql://runtime:secret@roundhouse.proxy.rlwy.net:5432/railway",
      environment: "production",
    })
    const url = new URL(result.connectionString)

    expect(result.transport).toBe("tls")
    expect(url.searchParams.get("sslmode")).toBe("require")
    expect(url.searchParams.get("uselibpqcompat")).toBe("true")
  })

  it.each(["disable", "allow", "prefer"])(
    "rejects the non-enforcing %s SSL mode outside private networking",
    (sslmode) => {
      expect(() =>
        resolveDatabaseConnection({
          connectionString: `postgresql://runtime:secret@db.example.com:5432/app?sslmode=${sslmode}`,
          environment: "production",
        }),
      ).toThrow("must require TLS")
    },
  )

  it("accepts certificate-verifying external TLS", () => {
    expect(
      resolveDatabaseConnection({
        connectionString:
          "postgresql://runtime:secret@db.example.com:5432/app?sslmode=verify-full&sslrootcert=system",
        environment: "production",
      }).transport,
    ).toBe("tls")
  })

  it("rejects incomplete production credentials without exposing the URL", () => {
    expect(() =>
      resolveDatabaseConnection({
        connectionString: "postgresql://db.example.com/app?sslmode=require",
        environment: "production",
        label: "DATABASE_MIGRATION_URL",
      }),
    ).toThrow(
      "DATABASE_MIGRATION_URL must include a database, username, and password",
    )
  })

  it("permits a passwordless local development database", () => {
    expect(
      resolveDatabaseConnection({
        connectionString: "postgresql://localhost:5432/remorseless",
        environment: "development",
      }).transport,
    ).toBe("local")
  })
})
