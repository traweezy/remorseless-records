import assert from "node:assert/strict"
import test from "node:test"

import {
  buildReleasePreparePlan,
  buildRuntimeReleasePreparePlan,
} from "../backend/scripts/lib/release-prepare.mjs"

const environment = {
  DATABASE_MIGRATION_URL:
    "postgresql://migration:secret@postgres.railway.internal:5432/railway",
  DATABASE_ROLE_SPLIT_REQUIRED: "true",
  DATABASE_URL:
    "postgresql://runtime:secret@postgres.railway.internal:5432/railway",
  NODE_ENV: "production",
}

test("external release preparation has only runtime authority and waits before storage or search", () => {
  const external = {
    DATABASE_URL:
      "postgresql://app_runtime:fixture@postgres.railway.internal:5432/railway",
    DATABASE_ROLE_SPLIT_REQUIRED: "true",
    DATABASE_MIGRATION_MODE: "external",
    RAILWAY_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
    RAILWAY_ENVIRONMENT_ID: "22222222-2222-4222-8222-222222222222",
    DATABASE_MIGRATION_SERVICE_ID: "33333333-3333-4333-8333-333333333333",
    RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
  }
  for (const build of [
    buildReleasePreparePlan,
    buildRuntimeReleasePreparePlan,
  ]) {
    const options = {
      environment: external,
      nodePath: "/node",
      serverRoot: "/server",
      cliPath: "/cli",
      now: new Date("2026-10-03T12:00:00Z"),
    }
    const plan = build(options)
    assert.equal(plan.length, 4)
    assert.equal(plan[0].environment.DATABASE_ROLE_PROFILE, "runtime")
    assert.match(plan[1].args[0], /wait-migration\.mjs$/u)
    for (const step of plan) {
      assert.equal(step.environment.DATABASE_URL, external.DATABASE_URL)
      assert.equal(step.environment.DATABASE_MIGRATION_URL, undefined)
      assert.ok(
        !step.args.some((arg) => ["db:migrate", "db:sync-links"].includes(arg))
      )
    }
    for (const override of [
      { DATABASE_MIGRATION_URL: environment.DATABASE_MIGRATION_URL },
      { DATABASE_BACKUP_URL: "unexpected" },
      { DATABASE_SOURCE_IDENTITY_URL: "unexpected" },
      { PGOPTIONS: "unexpected" },
      { DATABASE_ROLE_SPLIT_REQUIRED: "false" },
      { DATABASE_MIGRATION_SERVICE_ID: undefined },
      { RAILWAY_GIT_COMMIT_SHA: "short" },
      { DATABASE_MIGRATION_MODE: "externl" },
      { DATABASE_URL: environment.DATABASE_MIGRATION_URL },
    ])
      assert.throws(() =>
        build({ ...options, environment: { ...external, ...override } })
      )
  }
})

test("audits separate database authorities before release mutations", () => {
  const plan = buildReleasePreparePlan({
    environment,
    nodePath: "/usr/bin/node",
    pnpmPath: "/usr/bin/pnpm",
  })

  assert.equal(plan.length, 6)
  assert.deepEqual(
    plan.slice(0, 2).map((step) => step.label),
    ["migration database role audit", "runtime database role audit"]
  )
  assert.deepEqual(plan[0]?.args, ["run", "database:role:audit"])
  assert.deepEqual(plan[1]?.args, ["run", "database:role:audit"])
  assert.equal(plan[0]?.environment.DATABASE_ROLE_PROFILE, "migration")
  assert.equal(plan[1]?.environment.DATABASE_ROLE_PROFILE, "runtime")
  assert.equal(
    plan[0]?.environment.DATABASE_URL,
    environment.DATABASE_MIGRATION_URL
  )
  assert.equal(
    plan[2]?.environment.DATABASE_URL,
    environment.DATABASE_MIGRATION_URL
  )
  assert.equal(plan[1]?.environment.DATABASE_URL, environment.DATABASE_URL)
  assert.equal(plan[4]?.environment.DATABASE_URL, environment.DATABASE_URL)
  assert.equal(plan[5]?.environment.DATABASE_URL, environment.DATABASE_URL)
  assert.ok(
    plan.every((step) => !("DATABASE_MIGRATION_URL" in step.environment))
  )
  assert.deepEqual(plan[2]?.args, ["exec", "medusa", "db:migrate"])
  assert.ok(
    plan.every(
      (step) =>
        !step.args.some((argument) => argument.includes("postgresql://"))
    )
  )
})

test("supports a non-breaking rollout before enforcement is enabled", () => {
  const plan = buildReleasePreparePlan({
    environment: {
      DATABASE_ROLE_SPLIT_REQUIRED: "false",
      DATABASE_URL: environment.DATABASE_URL,
    },
    nodePath: "/usr/bin/node",
  })

  assert.equal(plan[0]?.environment.DATABASE_URL, environment.DATABASE_URL)
  assert.equal(plan.length, 4)
  assert.deepEqual(plan[0]?.args, ["exec", "medusa", "db:migrate"])
})

test("fails closed when an enforced migration role is absent or reused", () => {
  for (const migrationUrl of [undefined, environment.DATABASE_URL]) {
    assert.throws(
      () =>
        buildReleasePreparePlan({
          environment: {
            DATABASE_MIGRATION_URL: migrationUrl,
            DATABASE_ROLE_SPLIT_REQUIRED: "true",
            DATABASE_URL: environment.DATABASE_URL,
          },
          nodePath: "/usr/bin/node",
        }),
      /distinct DATABASE_MIGRATION_URL/u
    )
  }
})

test("rejects the same login even when URL spelling or options differ", () => {
  for (const migrationUrl of [
    `${environment.DATABASE_URL}?application_name=migrations`,
    "postgresql://%72untime:other-secret@postgres.railway.internal:5432/railway",
  ]) {
    assert.throws(
      () =>
        buildReleasePreparePlan({
          environment: {
            ...environment,
            DATABASE_MIGRATION_URL: migrationUrl,
          },
          nodePath: "/usr/bin/node",
        }),
      /must use a distinct PostgreSQL login/u
    )
  }
})

test("rejects a migration login aimed at another database endpoint", () => {
  for (const migrationUrl of [
    "postgresql://migration:secret@other.railway.internal:5432/railway",
    "postgresql://migration:secret@postgres.railway.internal:5433/railway",
    "postgresql://migration:secret@postgres.railway.internal:5432/other",
  ]) {
    assert.throws(
      () =>
        buildReleasePreparePlan({
          environment: {
            ...environment,
            DATABASE_MIGRATION_URL: migrationUrl,
          },
          nodePath: "/usr/bin/node",
        }),
      /must target the same PostgreSQL endpoint and database/u
    )
  }
})

test("rejects query parameters that override a reviewed URL identity", () => {
  for (const [key, value] of [
    ["user", "runtime"],
    ["password", "other-secret"],
    ["host", "other.railway.internal"],
    ["hostaddr", "127.0.0.1"],
    ["port", "5433"],
    ["dbname", "other"],
    ["service", "another-cluster"],
    ["options", "-csearch_path=other"],
  ]) {
    assert.throws(
      () =>
        buildReleasePreparePlan({
          environment: {
            ...environment,
            DATABASE_MIGRATION_URL: `${environment.DATABASE_MIGRATION_URL}?${key}=${value}`,
          },
          nodePath: "/usr/bin/node",
        }),
      /without unsupported connection parameters/u
    )
  }
})

test("rejects ambiguous encoded database path separators", () => {
  assert.throws(
    () =>
      buildReleasePreparePlan({
        environment: {
          ...environment,
          DATABASE_MIGRATION_URL:
            "postgresql://migration:secret@postgres.railway.internal:5432/rail%2Fway",
        },
        nodePath: "/usr/bin/node",
      }),
    /without unsupported connection parameters/u
  )
})

test("rejects ambiguous enforcement values", () => {
  assert.throws(
    () =>
      buildReleasePreparePlan({
        environment: {
          DATABASE_ROLE_SPLIT_REQUIRED: "enabled",
          DATABASE_URL: environment.DATABASE_URL,
        },
        nodePath: "/usr/bin/node",
      }),
    /must be true, false, 1, or 0/u
  )
})

test("builds a package-manager-free runtime image release plan", () => {
  const plan = buildRuntimeReleasePreparePlan({
    environment: {
      ...environment,
      COMMIT_SHA: "abcdef1234567890",
    },
    nodePath: "/usr/local/bin/node",
    now: new Date("2026-09-01T12:34:56.789Z"),
    serverRoot: "/app",
  })

  assert.equal(plan.length, 6)
  assert.ok(plan.every((step) => step.command === "/usr/local/bin/node"))
  assert.deepEqual(plan[0]?.args, ["/app/src/cli/audit-database-role.js"])
  assert.equal(plan[0]?.environment.DATABASE_ROLE_PROFILE, "migration")
  assert.equal(plan[1]?.environment.DATABASE_ROLE_PROFILE, "runtime")
  assert.deepEqual(plan[2]?.args, [
    "/app/node_modules/@medusajs/cli/cli.js",
    "db:migrate",
  ])
  assert.deepEqual(plan[4]?.args, [
    "/app/node_modules/@medusajs/cli/cli.js",
    "exec",
    "./src/scripts/check-object-storage.js",
  ])
  assert.equal(
    plan[5]?.environment.MEILISEARCH_CANDIDATE_INDEX,
    "products_build_20260901t123456789z_abcdef123456"
  )
  assert.ok(
    plan.every(
      (step) =>
        !step.args.some((argument) => argument.includes("postgresql://"))
    )
  )
})

test("rejects invalid runtime search candidate indexes", () => {
  assert.throws(
    () =>
      buildRuntimeReleasePreparePlan({
        environment: {
          ...environment,
          MEILISEARCH_CANDIDATE_INDEX: "products/stable",
        },
        nodePath: "/usr/local/bin/node",
        now: new Date("2026-09-01T12:34:56.789Z"),
        serverRoot: "/app",
      }),
    /must match products_build_/u
  )
})
