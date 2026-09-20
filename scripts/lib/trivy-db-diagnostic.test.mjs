import assert from "node:assert/strict"
import test from "node:test"
import {
  publicTrivyFailureFields,
  trivyDatabaseFreshnessDiagnostic,
} from "./trivy-db-diagnostic.mjs"

const now = Date.parse("2026-09-20T07:06:42Z")
const metadata = {
  Version: 2,
  UpdatedAt: "2026-09-19T07:03:12Z",
  DownloadedAt: "2026-09-20T07:05:00Z",
  NextUpdate: "2026-09-20T07:03:12Z",
}

test("classifies an expired DB using only fixed fields", () => {
  assert.deepEqual(trivyDatabaseFreshnessDiagnostic(metadata, now), {
    reasonCode: "database_expired",
    database: {
      repository: "ghcr.io/aquasecurity/trivy-db:2",
      updatedAt: "2026-09-19T07:03:12.000Z",
      nextUpdate: "2026-09-20T07:03:12.000Z",
    },
  })
})

test("separately identifies a DB older than the 48-hour limit", () => {
  assert.equal(
    trivyDatabaseFreshnessDiagnostic(
      {
        ...metadata,
        UpdatedAt: "2026-09-17T07:03:12Z",
        NextUpdate: "2026-09-21T07:03:12Z",
      },
      now
    ).reasonCode,
    "database_older_than_48h"
  )
})

test("never reflects malformed or fresh metadata", () => {
  for (const candidate of [
    null,
    { ...metadata, Version: 3 },
    { ...metadata, UpdatedAt: "2026-09-19T07:03:12Z/private-canary" },
    { ...metadata, DownloadedAt: "2026-09-21T00:00:00Z" },
    { ...metadata, NextUpdate: "2026-09-18T00:00:00Z" },
    { ...metadata, NextUpdate: "2026-09-21T07:03:12Z" },
  ])
    assert.equal(trivyDatabaseFreshnessDiagnostic(candidate, now), undefined)
  assert.equal(
    trivyDatabaseFreshnessDiagnostic(metadata, now, now - 3 * 60 * 1000),
    undefined
  )
})

test("publishes only whitelisted reason and canonical timestamps", () => {
  const source = {
    ...trivyDatabaseFreshnessDiagnostic(metadata, now),
    secret: "private-canary",
    database: {
      ...trivyDatabaseFreshnessDiagnostic(metadata, now).database,
      path: "/private/canary",
    },
  }
  const publicFields = publicTrivyFailureFields(source)
  assert.deepEqual(
    publicFields,
    trivyDatabaseFreshnessDiagnostic(metadata, now)
  )
  assert.equal(JSON.stringify(publicFields).includes("canary"), false)
  assert.deepEqual(
    publicTrivyFailureFields({
      reasonCode: "private-canary",
      database: source.database,
    }),
    {}
  )
  assert.deepEqual(
    publicTrivyFailureFields({
      reasonCode: "database_expired",
      database: { repository: "private-canary" },
    }),
    {}
  )
})
