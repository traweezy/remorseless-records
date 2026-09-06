import assert from "node:assert/strict"
import { constants, createWriteStream } from "node:fs"
import { open, realpath } from "node:fs/promises"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { parseBackupManifest } from "./postgres-logical-backup.mjs"

const openRegularFile = async (path) => {
  assert.equal(resolve(path), path, "Recovery inputs must be absolute.")
  assert.equal(await realpath(path), path, "Recovery inputs must be canonical.")
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    assert.ok(
      (await file.stat()).isFile(),
      "Recovery input must be a regular file."
    )
    return file
  } catch (error) {
    await file.close()
    throw error
  }
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
