import type { DatabaseConnectionTransport } from "./connection-policy"

export type DatabaseRoleProfile = "backup" | "migration" | "runtime"

export type DatabaseRoleFacts = {
  backupWrite: boolean
  bypassRls: boolean
  createDatabase: boolean
  createRole: boolean
  databaseCreate: boolean
  defaultAdministrator: boolean
  effectiveReadAllData: boolean
  membershipAdmin: boolean
  ownsObjects: boolean
  privilegedMembership: boolean
  readAllData: boolean
  reachablePrivilegedRole: boolean
  replication: boolean
  schemaCreate: boolean
  superuser: boolean
  tls: boolean
  transport: DatabaseConnectionTransport
  writeAllData: boolean
}

const privilegedAttributeErrors = (facts: DatabaseRoleFacts): string[] => [
  ...(facts.defaultAdministrator ? ["default_administrator"] : []),
  ...(facts.superuser ? ["superuser"] : []),
  ...(facts.createDatabase ? ["createdb"] : []),
  ...(facts.createRole ? ["createrole"] : []),
  ...(facts.replication ? ["replication"] : []),
  ...(facts.bypassRls ? ["bypassrls"] : []),
  ...(facts.reachablePrivilegedRole ? ["reachable_privileged_role"] : []),
  ...(facts.privilegedMembership ? ["privileged_membership"] : []),
  ...(facts.membershipAdmin ? ["membership_admin"] : []),
]

export const evaluateDatabaseRole = (
  profile: DatabaseRoleProfile,
  facts: DatabaseRoleFacts
): string[] => {
  const errors = privilegedAttributeErrors(facts)
  if (facts.transport === "tls" && !facts.tls) {
    errors.push("tls_not_negotiated")
  }

  if (profile === "runtime" || profile === "migration") {
    if (facts.readAllData) {
      errors.push(`${profile}_has_pg_read_all_data`)
    }
  }
  if (profile === "runtime") {
    if (facts.writeAllData) {
      errors.push("runtime_has_pg_write_all_data")
    }
  }
  if (profile === "migration" && facts.writeAllData) {
    errors.push("migration_has_pg_write_all_data")
  }
  if (profile === "backup") {
    if (!facts.readAllData) {
      errors.push("backup_missing_pg_read_all_data")
    } else if (!facts.effectiveReadAllData) {
      errors.push("backup_missing_effective_pg_read_all_data")
    }
    if (facts.writeAllData) {
      errors.push("backup_has_pg_write_all_data")
    }
    if (facts.backupWrite) {
      errors.push("backup_has_write_privileges")
    }
  }

  if (profile !== "migration") {
    if (facts.databaseCreate) {
      errors.push(`${profile}_has_database_create`)
    }
    if (facts.schemaCreate) {
      errors.push(`${profile}_has_schema_create`)
    }
    if (facts.ownsObjects) {
      errors.push(`${profile}_has_object_ownership`)
    }
  }

  return errors
}

export const parseDatabaseRoleProfile = (
  value: string | undefined
): DatabaseRoleProfile => {
  if (value === "backup" || value === "migration" || value === "runtime") {
    return value
  }
  throw new Error(
    "DATABASE_ROLE_PROFILE must be backup, migration, or runtime."
  )
}
