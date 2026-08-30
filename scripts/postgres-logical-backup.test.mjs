import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  createPostgresClientEnvironment,
  hashFileSha256,
  parseBackupManifest,
} from "./lib/postgres-logical-backup.mjs"

test("streams deterministic archive hashing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "postgres-hash-"))
  const archive = join(directory, "archive.dump")
  try {
    await writeFile(archive, "portable backup evidence", { mode: 0o600 })
    assert.equal(
      await hashFileSha256(archive),
      "8be9870e10ec18c488e3450fe249f24fac6808fb697b61965df8ae814897173f",
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("moves PostgreSQL credentials into process environment only", () => {
  const result = createPostgresClientEnvironment(
    "postgresql://backup:p%40ss@db.example.com:6432/store?sslmode=verify-full&sslrootcert=system",
    "DATABASE_BACKUP_URL",
  )

  assert.deepEqual(result.environment, {
    PGAPPNAME: "remorseless-recovery",
    PGCONNECT_TIMEOUT: "10",
    PGDATABASE: "store",
    PGHOST: "db.example.com",
    PGPASSWORD: "p@ss",
    PGPORT: "6432",
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "system",
    PGUSER: "backup",
  })
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/u)
})

test("rejects a public backup connection that can fall back to plaintext", () => {
  assert.throws(
    () =>
      createPostgresClientEnvironment(
        "postgresql://backup:secret@db.example.com/store?sslmode=prefer",
        "DATABASE_BACKUP_URL",
      ),
    /must require TLS/u,
  )
})

test("rejects ambiguous PostgreSQL destinations", () => {
  for (const value of [
    "postgresql://backup:secret@db.example.com/store%3Dother?sslmode=require",
    "postgresql://backup:secret@db.example.com/store#ignored",
  ]) {
    assert.throws(
      () => createPostgresClientEnvironment(value, "DATABASE_BACKUP_URL"),
      /unsafe database name|must not include a URL fragment/u,
    )
  }
})

test("accepts a strict bounded backup manifest", () => {
  const manifest = {
    bytes: 42,
    createdAt: "2026-08-30T20:00:00.000Z",
    format: "postgres-custom",
    pgDumpVersion: "pg_dump (PostgreSQL) 18.6",
    schemaVersion: 1,
    sha256: "a".repeat(64),
    sourceFingerprint: "b".repeat(64),
  }

  assert.equal(parseBackupManifest(manifest), manifest)
  assert.throws(() => parseBackupManifest({ ...manifest, bytes: 0 }))
  assert.throws(() =>
    parseBackupManifest({ ...manifest, sourceFingerprint: "source" }),
  )
  assert.throws(() =>
    parseBackupManifest({ ...manifest, createdAt: "2026-08-30T20:00:00Z" }),
  )
  assert.throws(() => parseBackupManifest({ ...manifest, unexpected: true }))
})
