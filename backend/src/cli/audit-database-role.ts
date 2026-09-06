import { resolveDatabaseConnection } from "../lib/database/connection-policy"
import { runDatabaseRoleAudit } from "../lib/database/role-audit"
import { parseDatabaseRoleProfile } from "../lib/database/role-policy"
import { createPostgreSqlClient } from "../lib/database/standalone-postgres"

const auditDatabaseRole = async (): Promise<void> => {
  const profile = parseDatabaseRoleProfile(process.env.DATABASE_ROLE_PROFILE)
  const connection = resolveDatabaseConnection({
    connectionString: process.env.DATABASE_URL ?? "",
    environment: process.env.NODE_ENV,
  })
  const client = await createPostgreSqlClient("database-role-audit")

  const result = await runDatabaseRoleAudit({
    client,
    profile,
    transport: connection.transport,
  })
  if (result.status === "accepted") {
    process.stdout.write(
      `[database-role] profile=${profile} transport=${connection.transport} status=accepted\n`
    )
    return
  }
  process.stderr.write(
    result.status === "rejected"
      ? `[database-role] profile=${profile} status=rejected reasons=${result.reasons.join(",")}\n`
      : "[database-role] status=failed reason=audit_unavailable\n"
  )
  process.exitCode = 1
}

auditDatabaseRole().catch(() => {
  process.stderr.write(
    "[database-role] status=failed reason=configuration_invalid\n"
  )
  process.exitCode = 1
})
