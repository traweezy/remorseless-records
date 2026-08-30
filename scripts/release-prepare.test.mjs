import assert from "node:assert/strict"
import test from "node:test"

import { buildReleasePreparePlan } from "../backend/scripts/lib/release-prepare.mjs"

const environment = {
  DATABASE_MIGRATION_URL:
    "postgresql://migration:secret@postgres.railway.internal:5432/railway",
  DATABASE_ROLE_SPLIT_REQUIRED: "true",
  DATABASE_URL:
    "postgresql://runtime:secret@postgres.railway.internal:5432/railway",
  NODE_ENV: "production",
}

test("keeps migration and runtime database authorities on separate steps", () => {
  const plan = buildReleasePreparePlan({
    environment,
    nodePath: "/usr/bin/node",
    pnpmPath: "/usr/bin/pnpm",
  })

  assert.equal(plan.length, 4)
  assert.equal(plan[0]?.environment.DATABASE_URL, environment.DATABASE_MIGRATION_URL)
  assert.equal(plan[1]?.environment.DATABASE_URL, environment.DATABASE_MIGRATION_URL)
  assert.equal(plan[2]?.environment.DATABASE_URL, environment.DATABASE_URL)
  assert.equal(plan[3]?.environment.DATABASE_URL, environment.DATABASE_URL)
  assert.ok(
    plan.every((step) => !("DATABASE_MIGRATION_URL" in step.environment)),
  )
  assert.deepEqual(plan[0]?.args, ["exec", "medusa", "db:migrate"])
  assert.ok(
    plan.every(
      (step) =>
        !step.args.some((argument) => argument.includes("postgresql://")),
    ),
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
      /distinct DATABASE_MIGRATION_URL/u,
    )
  }
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
    /must be true, false, 1, or 0/u,
  )
})
