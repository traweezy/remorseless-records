import { resolveDatabaseConnection } from "../lib/database/connection-policy"
import {
  evaluateDatabaseRole,
  parseDatabaseRoleProfile,
  type DatabaseRoleFacts,
} from "../lib/database/role-policy"
import { createPostgreSqlClient } from "../lib/database/standalone-postgres"

type DatabaseRoleRow = {
  bypass_rls: boolean
  create_database: boolean
  create_role: boolean
  default_administrator: boolean
  read_all_data: boolean
  replication: boolean
  superuser: boolean
  tls: boolean
  write_all_data: boolean
}

const auditDatabaseRole = async (): Promise<void> => {
  const profile = parseDatabaseRoleProfile(process.env.DATABASE_ROLE_PROFILE)
  const connection = resolveDatabaseConnection({
    connectionString: process.env.DATABASE_URL ?? "",
    environment: process.env.NODE_ENV,
  })
  const client = await createPostgreSqlClient("database-role-audit")

  try {
    await client.connect()
    const result = await client.query<DatabaseRoleRow>(`
      select
        current_user = 'postgres' as default_administrator,
        role.rolsuper as superuser,
        role.rolcreatedb as create_database,
        role.rolcreaterole as create_role,
        role.rolreplication as replication,
        role.rolbypassrls as bypass_rls,
        pg_has_role(current_user, 'pg_read_all_data', 'member') as read_all_data,
        pg_has_role(current_user, 'pg_write_all_data', 'member') as write_all_data,
        coalesce(
          (select ssl from pg_stat_ssl where pid = pg_backend_pid()),
          false
        ) as tls
      from pg_roles as role
      where role.rolname = current_user
    `)
    const row = result.rows[0]
    if (!row) {
      throw new Error("[database-role] Current role could not be inspected.")
    }
    const facts: DatabaseRoleFacts = {
      bypassRls: row.bypass_rls,
      createDatabase: row.create_database,
      createRole: row.create_role,
      defaultAdministrator: row.default_administrator,
      readAllData: row.read_all_data,
      replication: row.replication,
      superuser: row.superuser,
      tls: row.tls,
      transport: connection.transport,
      writeAllData: row.write_all_data,
    }
    const errors = evaluateDatabaseRole(profile, facts)
    if (errors.length) {
      throw new Error(
        `[database-role] ${profile} profile rejected: ${errors.join(",")}`,
      )
    }

    process.stdout.write(
      `[database-role] profile=${profile} transport=${connection.transport} cluster_privileges=none status=accepted\n`,
    )
  } finally {
    await client.end()
  }
}

auditDatabaseRole().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown failure."
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
