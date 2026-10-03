import assert from "node:assert/strict"
import { createHash } from "node:crypto"

const identifier = (value) => {
  assert.match(value, /^[a-z_][a-z0-9_]{0,62}$/u)
  return `"${value}"`
}
const migrationTables = new Set([
  "link_module_migrations",
  "mikro_orm_migrations",
  "script_migrations",
])
const runtimeReadOnlyTables = new Set([
  ...migrationTables,
  "remorseless_migration_receipt",
])

// A plan only handles the reviewed public-schema, ordinary-table topology.
// The caller must bind it to a fresh backup, exact source identity and a
// transactional re-read of this inventory before executing it as administrator.
// This module never connects, commits, assigns passwords or enables logins.
export const buildPostgresRoleSplitPlan = ({
  database,
  tables,
  sequences,
  enumTypes,
}) => {
  const databaseSql = identifier(database)
  assert.ok(Array.isArray(tables) && tables.length > 0 && tables.length <= 1000)
  assert.ok(Array.isArray(sequences) && sequences.length <= 1000)
  assert.ok(Array.isArray(enumTypes) && enumTypes.length <= 1000)
  for (const names of [tables, sequences, enumTypes]) {
    assert.equal(new Set(names).size, names.length)
    for (const name of names) identifier(name)
  }
  assert.ok([...migrationTables].every((table) => tables.includes(table)))
  const sortedTables = [...tables].sort()
  const sortedSequences = [...sequences].sort()
  const sortedTypes = [...enumTypes].sort()
  const objects = (names) => names.map((name) => `public.${identifier(name)}`)
  const statements = [
    "create role app_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls",
    "create role app_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 40",
    "create role app_migrator nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 5",
    "create role app_backup nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 3",
    "grant app_owner to app_migrator with inherit true, set true, admin false",
    "grant pg_read_all_data to app_backup with inherit true, set false, admin false",
    // All migration-created objects retain the non-login owner. Setting the
    // login's default role is database-scoped and does not expand membership.
    `alter role app_migrator in database ${databaseSql} set role = 'app_owner'`,
    `revoke create, temporary on database ${databaseSql} from public`,
    `grant connect on database ${databaseSql} to app_runtime, app_migrator, app_backup`,
    `grant temporary on database ${databaseSql} to app_owner`,
    "revoke create on schema public from public",
    "alter schema public owner to app_owner",
    "grant usage on schema public to app_runtime, app_backup",
    ...objects(sortedTables).map(
      (name) => `alter table ${name} owner to app_owner`
    ),
    ...objects(sortedSequences).map(
      (name) => `alter sequence ${name} owner to app_owner`
    ),
    ...objects(sortedTypes).map(
      (name) => `alter type ${name} owner to app_owner`
    ),
    ...sortedTables.map(
      (name) =>
        `grant ${runtimeReadOnlyTables.has(name) ? "select" : "select, insert, update, delete"} on table public.${identifier(name)} to app_runtime`
    ),
    ...sortedSequences
      .filter(
        (name) =>
          ![...migrationTables].some((table) => name === `${table}_id_seq`)
      )
      .map(
        (name) =>
          `grant usage, select on sequence public.${identifier(name)} to app_runtime`
      ),
    "alter default privileges for role app_owner in schema public grant select, insert, update, delete on tables to app_runtime",
    "alter default privileges for role app_owner in schema public grant usage, select on sequences to app_runtime",
    "alter default privileges for role app_owner revoke execute on functions from public",
    // A deliberate RESET ROLE by a migration must not accidentally create
    // unrestricted definer entrypoints either. Table grants still require the
    // default app_owner role, so accidental ownership drift fails visibly.
    "alter default privileges for role app_migrator revoke execute on functions from public",
  ]
  const sql = `${statements.join(";\n")};\n`
  return {
    sql,
    sha256: createHash("sha256").update(sql).digest("hex"),
    tableCount: tables.length,
    sequenceCount: sequences.length,
    enumTypeCount: enumTypes.length,
    connectionLimits: { runtime: 40, migration: 5, backup: 3 },
  }
}
