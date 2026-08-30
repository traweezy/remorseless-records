import type { DatabaseConnectionTransport } from "./connection-policy"

export type DatabaseRoleProfile = "backup" | "migration" | "runtime"

export type DatabaseRoleFacts = {
  bypassRls: boolean
  createDatabase: boolean
  createRole: boolean
  defaultAdministrator: boolean
  readAllData: boolean
  replication: boolean
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
    }
    if (facts.writeAllData) {
      errors.push("backup_has_pg_write_all_data")
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
