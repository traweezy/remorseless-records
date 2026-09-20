import assert from "node:assert/strict"
import { constants, createWriteStream } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import { createHash } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { parseBackupManifest } from "./postgres-logical-backup.mjs"
import { openPrivateOutputDirectory } from "./postgres-snapshot.mjs"

export const openRegularFile = async (path) => {
  assert.equal(resolve(path), path, "Recovery inputs must be absolute.")
  const parent = await openPrivateOutputDirectory(dirname(path))
  let file
  try {
    file = await open(
      join(parent.descriptorPath, basename(path)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600
    )
    const opened = await file.stat()
    const named = await lstat(path)
    assert.ok(
      opened.isFile() &&
        opened.nlink === 1 &&
        opened.uid === process.getuid() &&
        (opened.mode & 0o077) === 0 &&
        named.isFile() &&
        !named.isSymbolicLink() &&
        named.dev === opened.dev &&
        named.ino === opened.ino,
      "Recovery input must be a regular file."
    )
    assert.equal(
      await realpath(path),
      path,
      "Recovery inputs must be canonical."
    )
    await parent.assertStable()
  } catch (error) {
    await file?.close()
    await parent.close()
    throw error
  }
  try {
    await parent.close()
  } catch (error) {
    await file.close()
    throw error
  }
  return file
}

export const readBackupManifest = async (path, signal) => {
  const file = await openRegularFile(path)
  try {
    const chunks = []
    let bytes = 0
    for await (const chunk of file.createReadStream({
      autoClose: false,
      signal,
    })) {
      bytes += chunk.length
      assert.ok(bytes <= 64 * 1024, "Backup manifest exceeded 64 KiB.")
      chunks.push(chunk)
    }
    return parseBackupManifest(
      JSON.parse(Buffer.concat(chunks).toString("utf8"))
    )
  } finally {
    await file.close()
  }
}

export const readRestoreReceipt = async (path, signal) => {
  const file = await openRegularFile(path)
  try {
    const chunks = []
    let bytes = 0
    for await (const chunk of file.createReadStream({
      autoClose: false,
      signal,
    })) {
      bytes += chunk.length
      assert.ok(bytes <= 256 * 1024, "Restore receipt exceeded 256 KiB.")
      chunks.push(chunk)
    }
    return parseRestoreReceipt(
      JSON.parse(Buffer.concat(chunks).toString("utf8"))
    )
  } finally {
    await file.close()
  }
}

export const restoreArchiveLimit = (raw) => {
  if (raw === undefined) return 10 * 1024 ** 3
  assert.match(raw, /^[1-9]\d*$/u, "Invalid archive size budget.")
  const value = Number(raw)
  assert.ok(
    Number.isSafeInteger(value) && value <= 1024 ** 4,
    "Archive budget exceeds 1 TiB."
  )
  return value
}

// Restore reads only this private verified snapshot, never the mutable input path.
export const snapshotBackupArchive = async (
  source,
  target,
  manifest,
  signal
) => {
  const file = await openRegularFile(source)
  try {
    assert.equal(
      (await file.stat()).size,
      manifest.bytes,
      "Backup byte length changed."
    )
    let bytes = 0
    const hash = createHash("sha256")
    const verifier = new Transform({
      transform: (chunk, _encoding, done) => {
        bytes += chunk.length
        if (bytes > manifest.bytes) {
          done(new Error("Backup exceeded its declared size."))
          return
        }
        hash.update(chunk)
        done(null, chunk)
      },
    })
    await pipeline(
      file.createReadStream({ autoClose: false }),
      verifier,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
      { signal }
    )
    assert.equal(bytes, manifest.bytes, "Backup byte length changed.")
    assert.equal(
      hash.digest("hex"),
      manifest.sha256,
      "Backup checksum verification failed."
    )
  } finally {
    await file.close()
  }
}

// pg_catalog counts do not hide objects from a role lacking table privileges.
// Namespace dependencies cover routines/types/operators/collations as well as
// relations. Database-scoped objects without namespaces are checked separately.
export const RESTORE_TARGET_INVENTORY_SQL = `
WITH user_namespaces AS (
  SELECT oid, nspname FROM pg_catalog.pg_namespace
  WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
)
SELECT pg_catalog.json_build_object(
  'tables', (SELECT count(*) FROM pg_catalog.pg_class c
    JOIN user_namespaces n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p')),
  'objects',
    (SELECT count(*) FROM user_namespaces WHERE nspname <> 'public') +
    (SELECT count(*) FROM pg_catalog.pg_depend d JOIN user_namespaces n
      ON d.refclassid = 'pg_catalog.pg_namespace'::regclass AND d.refobjid = n.oid) +
    (SELECT count(*) FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql') +
    (SELECT count(*) FROM pg_catalog.pg_largeobject_metadata) +
    (SELECT count(*) FROM pg_catalog.pg_event_trigger) +
    (SELECT count(*) FROM pg_catalog.pg_foreign_server) +
    (SELECT count(*) FROM pg_catalog.pg_foreign_data_wrapper) +
    (SELECT count(*) FROM pg_catalog.pg_publication) +
    (SELECT count(*) FROM pg_catalog.pg_subscription
      WHERE subdbid = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())) +
    (SELECT count(*) FROM pg_catalog.pg_default_acl) +
    (SELECT count(*) FROM pg_catalog.pg_cast WHERE oid >= 16384) +
    (SELECT count(*) FROM pg_catalog.pg_language WHERE lanname NOT IN ('internal', 'c', 'sql', 'plpgsql'))
);`

// Keep preflight read-only even with role/database defaults and prevent a user
// schema from shadowing catalog functions, types, or operators.
export const RESTORE_TARGET_PREFLIGHT_SQL = `BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
${RESTORE_TARGET_INVENTORY_SQL}
COMMIT;`

export const parseRestoreInventory = (raw) => {
  const value = JSON.parse(raw)
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), ["objects", "tables"])
  for (const count of Object.values(value))
    assert.ok(Number.isSafeInteger(count) && count >= 0)
  assert.ok(value.tables === 0 || value.objects > 0)
  return value
}

const userTables = `FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname !~ '^pg_'
  AND n.nspname <> 'information_schema'`

const snapshotClause = (snapshot) => {
  if (snapshot === undefined) return ""
  assert.match(snapshot, /^[A-Za-z0-9:_-]{1,128}$/u)
  return `SET TRANSACTION SNAPSHOT '${snapshot}';\n`
}

export const buildRestoreTableListSql = (
  snapshot
) => `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
${snapshotClause(snapshot)}SET LOCAL search_path = pg_catalog;
SET LOCAL row_security = off;
SET LOCAL lock_timeout = '10s';
SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object(
  'schema', n.nspname, 'table', c.relname)
  ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"), '[]'::json)
${userTables};
COMMIT;`

export const RESTORE_TABLE_LIST_SQL = buildRestoreTableListSql()

const identifier = /^[a-z_][a-z0-9_]*$/u

export const parseRestoreTableList = (raw) => {
  const value = JSON.parse(raw)
  assert.ok(Array.isArray(value) && value.length > 0 && value.length <= 1000)
  let previous = ""
  for (const table of value) {
    assert.ok(table && typeof table === "object" && !Array.isArray(table))
    assert.deepEqual(Object.keys(table).sort(), ["schema", "table"])
    assert.match(table.schema, identifier)
    assert.match(table.table, identifier)
    const key = `${table.schema}.${table.table}`
    assert.ok(key > previous, "Table inventory must be sorted and unique.")
    previous = key
  }
  return value
}

const schemaCountSql = {
  tables: `(SELECT count(*) ${userTables})`,
  indexes: `(SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace WHERE c.relkind IN ('i', 'I')
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')`,
  sequences: `(SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace WHERE c.relkind = 'S'
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')`,
  views: `(SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace WHERE c.relkind IN ('v', 'm')
    AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')`,
  constraints: `(SELECT count(*) FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n
    ON n.oid = c.connamespace WHERE n.nspname !~ '^pg_'
    AND n.nspname <> 'information_schema')`,
  routines: `(SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_'
    AND n.nspname <> 'information_schema')`,
}

const countNames = Object.keys(schemaCountSql).sort()

export const buildRestoreInvariantsSql = (tables, snapshot) => {
  assert.deepEqual(parseRestoreTableList(JSON.stringify(tables)), tables)
  const counts = countNames.flatMap((name) => [
    `'${name}'`,
    schemaCountSql[name],
  ])
  // Each VALUES row has two expressions, so large schemas do not hit
  // PostgreSQL's function-argument limit. The ordinal preserves the receipt's
  // canonical table order independently of planner evaluation order.
  const rows = tables.map(
    ({ schema, table }, ordinal) =>
      `(${ordinal}, pg_catalog.json_build_object('schema', '${schema}', 'table', '${table}', 'rows', (SELECT count(*) FROM "${schema}"."${table}")))`
  )
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
${snapshotClause(snapshot)}SET LOCAL search_path = pg_catalog;
SET LOCAL row_security = off;
SET LOCAL lock_timeout = '10s';
SELECT pg_catalog.json_build_object(
  'serverMajor', pg_catalog.current_setting('server_version_num')::integer / 10000,
  'counts', pg_catalog.json_build_object(${counts.join(", ")}),
  'tableRows', (SELECT pg_catalog.json_agg(row_data ORDER BY ordinal)
    FROM (VALUES ${rows.join(",\n      ")}) AS ordered_rows(ordinal, row_data))
);
COMMIT;`
}

export const parseRestoreInvariants = (raw) => {
  const value = JSON.parse(raw)
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [
    "counts",
    "serverMajor",
    "tableRows",
  ])
  assert.ok(Number.isSafeInteger(value.serverMajor) && value.serverMajor >= 12)
  assert.ok(value.counts && typeof value.counts === "object")
  assert.deepEqual(Object.keys(value.counts).sort(), countNames)
  for (const count of Object.values(value.counts))
    assert.ok(Number.isSafeInteger(count) && count >= 0)
  const tables = parseRestoreTableList(
    JSON.stringify(
      value.tableRows?.map(({ schema, table }) => ({ schema, table }))
    )
  )
  assert.equal(tables.length, value.counts.tables)
  for (const row of value.tableRows) {
    assert.deepEqual(Object.keys(row).sort(), ["rows", "schema", "table"])
    assert.ok(Number.isSafeInteger(row.rows) && row.rows >= 0)
  }
  return value
}

export const parseRestoreReceipt = (value) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [
    "archiveSha256",
    "invariants",
    "schemaVersion",
    "sourceFingerprint",
  ])
  assert.equal(value.schemaVersion, 1)
  assert.match(value.archiveSha256, /^[a-f0-9]{64}$/u)
  assert.match(value.sourceFingerprint, /^[a-f0-9]{64}$/u)
  return {
    ...value,
    invariants: parseRestoreInvariants(JSON.stringify(value.invariants)),
  }
}
