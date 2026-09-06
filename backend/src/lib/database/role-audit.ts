import type { DatabaseConnectionTransport } from "./connection-policy"
import {
  evaluateDatabaseRole,
  type DatabaseRoleFacts,
  type DatabaseRoleProfile,
} from "./role-policy"
import type { PostgreSqlClient } from "./standalone-postgres"

// SET follows SET-enabled membership chains; USAGE checks inherited privileges.
// Checking MEMBER alone misses NOINHERIT escalation and can accept an unusable
// backup identity. Each reachable principal can also inherit object privileges.
// This is a bounded capability inventory, not a SECURITY DEFINER/function audit.
// https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE
export const DATABASE_ROLE_AUDIT_QUERY = `
with principals as materialized (
  select role.*
  from pg_catalog.pg_roles as role
  where role.rolname in (session_user, current_user)
     or pg_catalog.pg_has_role(session_user, role.oid, 'SET')
), current_database_record as (
  select oid, datdba from pg_catalog.pg_database where datname = current_database()
), owners as (
  select datdba as owner from current_database_record
  union select nspowner from pg_catalog.pg_namespace
  union select relowner from pg_catalog.pg_class
  union select proowner from pg_catalog.pg_proc
  union select typowner from pg_catalog.pg_type
  union select extowner from pg_catalog.pg_extension
  union select lomowner from pg_catalog.pg_largeobject_metadata
  union
  select refobjid from pg_catalog.pg_shdepend
  where refclassid = 'pg_catalog.pg_authid'::regclass and deptype = 'o'
    and (dbid = 0 or dbid = (select oid from current_database_record))
), user_relations as materialized (
  select relation.oid, relation.relkind
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname <> 'information_schema'
    and namespace.nspname !~ '^pg_'
)
select
  session_user = 'postgres' as default_administrator,
  role.rolsuper as superuser,
  role.rolcreatedb as create_database,
  role.rolcreaterole as create_role,
  role.rolreplication as replication,
  role.rolbypassrls as bypass_rls,
  pg_catalog.pg_has_role(session_user, 'pg_read_all_data', 'MEMBER') as read_all_data,
  pg_catalog.pg_has_role(session_user, 'pg_write_all_data', 'MEMBER') as write_all_data,
  pg_catalog.pg_has_role(current_user, 'pg_read_all_data', 'USAGE') as effective_read_all_data,
  coalesce((select ssl from pg_catalog.pg_stat_ssl where pid = pg_backend_pid()), false) as tls,
  exists (
    select 1 from principals
    where oid <> role.oid
      and (rolname = 'postgres' or rolsuper or rolcreatedb or rolcreaterole
           or rolreplication or rolbypassrls)
  ) as reachable_privileged_role,
  exists (
    select 1 from principals
    cross join pg_catalog.pg_roles as privileged
    where privileged.rolname in (
      'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program',
      'pg_checkpoint', 'pg_create_subscription', 'pg_maintain', 'pg_signal_backend',
      'pg_signal_autovacuum_worker', 'pg_use_reserved_connections', 'pg_monitor',
      'pg_read_all_settings', 'pg_read_all_stats', 'pg_stat_scan_tables'
    ) and pg_catalog.pg_has_role(principals.oid, privileged.oid, 'USAGE')
  ) as privileged_membership,
  exists (
    select 1 from principals cross join pg_catalog.pg_roles as administrable
    where pg_catalog.pg_has_role(principals.oid, administrable.oid, 'MEMBER WITH ADMIN OPTION')
  ) as membership_admin,
  exists (
    select 1 from principals cross join current_database_record as database
    where pg_catalog.has_database_privilege(principals.oid, database.oid, 'CREATE')
  ) as database_create,
  exists (
    select 1 from principals cross join pg_catalog.pg_namespace as namespace
    where pg_catalog.has_schema_privilege(principals.oid, namespace.oid, 'CREATE')
  ) as schema_create,
  exists (
    select 1 from principals cross join owners
    where pg_catalog.pg_has_role(principals.oid, owners.owner, 'USAGE')
  ) as owns_objects,
  exists (
    select 1 from principals cross join user_relations as relation
    where case when relation.relkind = 'S' then
      pg_catalog.has_sequence_privilege(principals.oid, relation.oid, 'USAGE, UPDATE')
    when relation.relkind in ('r', 'p', 'v', 'm', 'f') then
      pg_catalog.has_table_privilege(principals.oid, relation.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
      or pg_catalog.has_any_column_privilege(principals.oid, relation.oid, 'INSERT, UPDATE, REFERENCES')
    else false end
  ) or exists (
    select 1 from principals cross join pg_catalog.pg_largeobject_metadata as object
    where pg_catalog.has_largeobject_privilege(principals.oid, object.oid, 'UPDATE')
  ) as backup_write
from pg_catalog.pg_roles as role where role.rolname = session_user
`

const booleanColumns = [
  "backup_write",
  "bypass_rls",
  "create_database",
  "create_role",
  "database_create",
  "default_administrator",
  "effective_read_all_data",
  "membership_admin",
  "owns_objects",
  "privileged_membership",
  "read_all_data",
  "reachable_privileged_role",
  "replication",
  "schema_create",
  "superuser",
  "tls",
  "write_all_data",
] as const

type DatabaseRoleRow = Record<(typeof booleanColumns)[number], boolean>

const parseRoleRow = (value: unknown): DatabaseRoleRow => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid_role_facts")
  }
  const row = value as Record<string, unknown>
  for (const column of booleanColumns) {
    if (!Object.hasOwn(row, column) || typeof row[column] !== "boolean") {
      throw new Error("invalid_role_facts")
    }
  }
  return row as DatabaseRoleRow
}

export const inspectDatabaseRole = async (
  client: Pick<PostgreSqlClient, "query">,
  transport: DatabaseConnectionTransport
): Promise<DatabaseRoleFacts> => {
  const result = await client.query<unknown>(DATABASE_ROLE_AUDIT_QUERY)
  if (result.rows.length !== 1) {
    throw new Error("invalid_role_facts")
  }
  const row = parseRoleRow(result.rows[0])
  return {
    backupWrite: row.backup_write,
    bypassRls: row.bypass_rls,
    createDatabase: row.create_database,
    createRole: row.create_role,
    databaseCreate: row.database_create,
    defaultAdministrator: row.default_administrator,
    effectiveReadAllData: row.effective_read_all_data,
    membershipAdmin: row.membership_admin,
    ownsObjects: row.owns_objects,
    privilegedMembership: row.privileged_membership,
    readAllData: row.read_all_data,
    reachablePrivilegedRole: row.reachable_privileged_role,
    replication: row.replication,
    schemaCreate: row.schema_create,
    superuser: row.superuser,
    tls: row.tls,
    transport,
    writeAllData: row.write_all_data,
  }
}

type RoleAuditResult =
  | { status: "accepted" }
  | { status: "rejected"; reasons: string[] }
  | { status: "failed" }

// Provider failures (including connect/end errors) cannot expose database names,
// roles, connection strings or driver details through this CLI's output.
export const runDatabaseRoleAudit = async ({
  client,
  profile,
  transport,
}: {
  client: PostgreSqlClient
  profile: DatabaseRoleProfile
  transport: DatabaseConnectionTransport
}): Promise<RoleAuditResult> => {
  let result: RoleAuditResult
  try {
    await client.connect()
    const facts = await inspectDatabaseRole(client, transport)
    const reasons = evaluateDatabaseRole(profile, facts)
    result = reasons.length
      ? { status: "rejected", reasons }
      : { status: "accepted" }
  } catch {
    result = { status: "failed" }
  }
  try {
    await client.end()
  } catch {
    result = { status: "failed" }
  }
  return result
}
