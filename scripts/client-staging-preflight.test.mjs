import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  parseArguments,
  queryRailway,
  readManifest,
  runPreflight,
} from "./client-staging-preflight.mjs"
import {
  evaluatePreflight,
  OWNER_ENVIRONMENT_ID,
  OWNER_PROJECT_ID,
  QUERY,
  SERVICE_NAMES,
  validateManifest,
} from "./lib/client-staging-preflight.mjs"

const NOW = new Date("2026-09-20T16:00:00.000Z")
const SOURCE_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
const TARGET_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222"
const TARGET_PROJECT_ID = "33333333-3333-4333-8333-333333333333"
const TARGET_ENVIRONMENT_ID = "44444444-4444-4444-8444-444444444444"
const serviceId = (index) => `55555555-5555-4555-8555-55555555555${index}`

const backendSealed = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "COOKIE_SECRET",
  "CHECKOUT_BFF_SECRET",
  "PUBLIC_FORM_BFF_SECRET",
  "STRIPE_API_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_LIFECYCLE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "TAX_RATE_LOOKUP_API_KEY",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MEILISEARCH_ADMIN_KEY",
  "MEILISEARCH_MASTER_KEY",
]
const storefrontSealed = [
  "CART_COOKIE_SECRET",
  "CHECKOUT_BFF_SECRET",
  "CHECKOUT_RECEIPT_SECRET",
  "PUBLIC_FORM_BFF_SECRET",
  "MEILISEARCH_API_KEY",
]

const manifest = () => ({
  schemaVersion: 2,
  target: {
    projectId: TARGET_PROJECT_ID,
    environmentId: TARGET_ENVIRONMENT_ID,
    workspaceId: TARGET_WORKSPACE_ID,
  },
  provenance: {
    reviewedAt: "2026-09-20T15:30:00.000Z",
    reviewer: "operator@example.test",
    creationEventId: "audit-event-1234",
    creationMode: "empty",
    noSyncSinceCreation: true,
  },
  inventory: {
    reviewedAt: "2026-09-20T15:30:00.000Z",
    reviewer: "operator@example.test",
    services: SERVICE_NAMES.map((name) => {
      const sealedVariableNames =
        name === "Backend"
          ? backendSealed
          : name === "Storefront"
            ? storefrontSealed
            : [`${name.toUpperCase()}_SECRET`]
      const references =
        name === "Backend"
          ? [
              { variableName: "DATABASE_URL", targetService: "Postgres" },
              { variableName: "REDIS_URL", targetService: "Redis" },
              { variableName: "MINIO_ENDPOINT", targetService: "Bucket" },
              {
                variableName: "MEILISEARCH_HOST",
                targetService: "MeiliSearch",
              },
            ]
          : name === "Storefront"
            ? [
                {
                  variableName: "MEDUSA_BACKEND_URL",
                  targetService: "Backend",
                },
                { variableName: "MEILISEARCH_HOST", targetService: "Backend" },
                { variableName: "REDIS_URL", targetService: "Redis" },
              ]
            : []
      return {
        name,
        variableNames: [
          ...new Set([
            ...sealedVariableNames,
            ...references.map((reference) => reference.variableName),
            ...(name === "Backend" ? ["MEDUSA_PUBLISHABLE_KEY"] : []),
            ...(name === "Storefront"
              ? ["NEXT_PUBLIC_STRIPE_PK", "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY"]
              : []),
          ]),
        ],
        sealedVariableNames,
        references,
      }
    }),
  },
})

const response = () => ({
  data: {
    sourceProject: { id: OWNER_PROJECT_ID, workspaceId: SOURCE_WORKSPACE_ID },
    targetProject: {
      id: TARGET_PROJECT_ID,
      name: "client-project",
      workspaceId: TARGET_WORKSPACE_ID,
    },
    targetEnvironment: {
      id: TARGET_ENVIRONMENT_ID,
      name: "client-staging",
      projectId: TARGET_PROJECT_ID,
      configEtag: "synthetic-config-etag",
      sourceEnvironment: null,
      serviceInstances: {
        edges: SERVICE_NAMES.map((serviceName, index) => ({
          node: {
            serviceName,
            serviceId: serviceId(index),
            environmentId: TARGET_ENVIRONMENT_ID,
            hasEverDeployed: false,
            activeDeployments: [],
          },
        })),
        pageInfo: { hasNextPage: false },
      },
      deploymentTriggers: { edges: [], pageInfo: { hasNextPage: false } },
      variables: {
        edges: manifest().inventory.services.flatMap((service, index) =>
          service.variableNames.map((name) => ({
            node: {
              name,
              isSealed: service.sealedVariableNames.includes(name),
              serviceId: serviceId(index),
              references: [],
            },
          }))
        ),
        pageInfo: { hasNextPage: false },
      },
    },
  },
})

test("metadata-only Railway query never requests variable values", () => {
  assert.match(QUERY, /serviceInstances\(first: 8\)/u)
  assert.match(QUERY, /deploymentTriggers\(first: 1\)/u)
  assert.match(QUERY, /variables\(first: 100, after: \$after\)/u)
  assert.match(QUERY, /name isSealed serviceId references/u)
  assert.match(QUERY, /hasEverDeployed activeDeployments/u)
  assert.doesNotMatch(QUERY, /\bvalue\b|decryptVariables|config\s*\{/u)
  assert.deepEqual(evaluatePreflight(manifest(), response(), NOW), {
    passed: true,
    problems: [],
  })
})

test("manifest rejects owner targets, unknown value fields, and stale attestations", () => {
  const owner = manifest()
  owner.target.projectId = OWNER_PROJECT_ID
  assert.match(validateManifest(owner, NOW), /Owner Railway/u)
  owner.target.projectId = TARGET_PROJECT_ID
  owner.target.environmentId = OWNER_ENVIRONMENT_ID
  assert.match(validateManifest(owner, NOW), /Owner Railway/u)

  const withValue = manifest()
  withValue.inventory.services[0].value = "private-synthetic-value"
  assert.match(validateManifest(withValue, NOW), /variable names/u)

  const stale = manifest()
  stale.inventory.reviewedAt = "2026-09-18T15:30:00.000Z"
  assert.match(validateManifest(stale, NOW), /last 24 hours/u)

  const noAudit = manifest()
  noAudit.provenance.noSyncSinceCreation = false
  assert.match(validateManifest(noAudit, NOW), /audit attestation/u)
  noAudit.provenance.noSyncSinceCreation = true
  noAudit.provenance.creationMode = "duplicate"
  assert.match(validateManifest(noAudit, NOW), /audit attestation/u)
  noAudit.provenance.creationMode = "empty"
  noAudit.provenance.reviewedAt = "2026-09-18T15:30:00.000Z"
  assert.match(validateManifest(noAudit, NOW), /audit attestation/u)
})

test("preflight rejects same-workspace targets and duplicated environments", () => {
  const sameWorkspace = response()
  sameWorkspace.data.targetProject.workspaceId = SOURCE_WORKSPACE_ID
  const matchingManifest = manifest()
  matchingManifest.target.workspaceId = SOURCE_WORKSPACE_ID
  assert.match(
    evaluatePreflight(matchingManifest, sameWorkspace, NOW).problems.join(" "),
    /separate Railway workspace/u
  )

  const duplicate = response()
  duplicate.data.targetEnvironment.sourceEnvironment = {
    id: OWNER_ENVIRONMENT_ID,
  }
  assert.match(
    evaluatePreflight(manifest(), duplicate, NOW).problems.join(" "),
    /source-environment link/u
  )
})

test("preflight rejects missing services, truncated pages, and deployment triggers", () => {
  const missing = response()
  missing.data.targetEnvironment.serviceInstances.edges.pop()
  assert.match(
    evaluatePreflight(manifest(), missing, NOW).problems.join(" "),
    /topology is incomplete/u
  )

  const truncated = response()
  truncated.data.targetEnvironment.serviceInstances.pageInfo.hasNextPage = true
  assert.match(
    evaluatePreflight(manifest(), truncated, NOW).problems.join(" "),
    /topology is incomplete/u
  )

  const duplicateId = response()
  duplicateId.data.targetEnvironment.serviceInstances.edges[1].node.serviceId =
    duplicateId.data.targetEnvironment.serviceInstances.edges[0].node.serviceId
  assert.match(
    evaluatePreflight(manifest(), duplicateId, NOW).problems.join(" "),
    /topology is incomplete/u
  )

  const trigger = response()
  trigger.data.targetEnvironment.deploymentTriggers.edges.push({
    node: { id: "x" },
  })
  assert.match(
    evaluatePreflight(manifest(), trigger, NOW).problems.join(" "),
    /no automatic deployment triggers/u
  )
})

test("preflight requires reviewed sealed names and valid live identities", () => {
  const unsealed = manifest()
  unsealed.inventory.services[0].sealedVariableNames = ["DATABASE_URL"]
  assert.match(
    evaluatePreflight(unsealed, response(), NOW).problems.join(" "),
    /lacks required sealed names|live variable names or sealing differ/u
  )

  const wrongProject = response()
  wrongProject.data.targetProject.id = OWNER_PROJECT_ID
  assert.match(
    evaluatePreflight(manifest(), wrongProject, NOW).problems.join(" "),
    /workspace identity does not match/u
  )

  const graphqlError = response()
  graphqlError.errors = [{ message: "synthetic-private-text" }]
  assert.deepEqual(evaluatePreflight(manifest(), graphqlError, NOW), {
    passed: false,
    problems: ["Railway metadata query returned errors"],
  })

  const wrongReference = manifest()
  wrongReference.inventory.services[0].references.pop()
  assert.match(
    evaluatePreflight(wrongReference, response(), NOW).problems.join(" "),
    /lacks required client references/u
  )
})

test("preflight rejects live variable drift, missing metadata, and prior app deployments", () => {
  const unsealed = response()
  unsealed.data.targetEnvironment.variables.edges[0].node.isSealed = false
  assert.match(
    evaluatePreflight(manifest(), unsealed, NOW).problems.join(" "),
    /live variable names or sealing differ/u
  )

  const missing = response()
  missing.data.targetEnvironment.variables.edges.pop()
  assert.match(
    evaluatePreflight(manifest(), missing, NOW).problems.join(" "),
    /live variable names or sealing differ/u
  )

  const shared = response()
  shared.data.targetEnvironment.variables.edges[0].node.serviceId = null
  assert.match(
    evaluatePreflight(manifest(), shared, NOW).problems.join(" "),
    /variable metadata is incomplete/u
  )

  const truncated = response()
  truncated.data.targetEnvironment.variables.pageInfo.hasNextPage = true
  assert.match(
    evaluatePreflight(manifest(), truncated, NOW).problems.join(" "),
    /variable metadata is incomplete/u
  )

  const deployed = response()
  deployed.data.targetEnvironment.serviceInstances.edges[0].node.hasEverDeployed = true
  assert.match(
    evaluatePreflight(manifest(), deployed, NOW).problems.join(" "),
    /must never have deployed/u
  )
  const active = response()
  active.data.targetEnvironment.serviceInstances.edges[1].node.activeDeployments =
    [{ id: "synthetic-deployment" }]
  assert.match(
    evaluatePreflight(manifest(), active, NOW).problems.join(" "),
    /must never have deployed/u
  )
})

test("CLI paginates variable metadata and rejects revision or cursor drift", () => {
  const all = response()
  const first = structuredClone(all)
  const second = structuredClone(all)
  first.data.targetEnvironment.variables.edges =
    all.data.targetEnvironment.variables.edges.slice(0, 2)
  first.data.targetEnvironment.variables.pageInfo = {
    hasNextPage: true,
    endCursor: "synthetic-cursor",
  }
  second.data.targetEnvironment.variables.edges =
    all.data.targetEnvironment.variables.edges.slice(2)
  let calls = 0
  const spawn = (_bin, args) => {
    calls += 1
    assert.equal(args.includes(`projectId=${TARGET_PROJECT_ID}`), true)
    assert.equal(args.includes(`environmentId=${TARGET_ENVIRONMENT_ID}`), true)
    assert.equal(args.includes("after=synthetic-cursor"), calls === 2)
    return {
      status: 0,
      stdout: JSON.stringify(calls === 1 ? first : second),
    }
  }
  assert.equal(
    queryRailway(manifest(), spawn).data.targetEnvironment.variables.edges
      .length,
    all.data.targetEnvironment.variables.edges.length
  )
  assert.equal(calls, 2)

  const drift = structuredClone(second)
  drift.data.targetEnvironment.configEtag = "changed"
  assert.throws(
    () =>
      queryRailway(manifest(), (_bin, args) => ({
        status: 0,
        stdout: JSON.stringify(
          args.includes("after=synthetic-cursor") ? drift : first
        ),
      })),
    /response was incomplete/u
  )

  const workspaceDrift = structuredClone(second)
  workspaceDrift.data.targetProject.workspaceId = SOURCE_WORKSPACE_ID
  assert.throws(
    () =>
      queryRailway(manifest(), (_bin, args) => ({
        status: 0,
        stdout: JSON.stringify(
          args.includes("after=synthetic-cursor") ? workspaceDrift : first
        ),
      })),
    /response was incomplete/u
  )

  const triggerDrift = structuredClone(second)
  triggerDrift.data.targetEnvironment.deploymentTriggers.edges.push({
    node: { id: "synthetic-trigger" },
  })
  assert.throws(
    () =>
      queryRailway(manifest(), (_bin, args) => ({
        status: 0,
        stdout: JSON.stringify(
          args.includes("after=synthetic-cursor") ? triggerDrift : first
        ),
      })),
    /response was incomplete/u
  )

  const noCursor = structuredClone(first)
  noCursor.data.targetEnvironment.variables.pageInfo.endCursor = null
  assert.throws(
    () =>
      queryRailway(manifest(), () => ({
        status: 0,
        stdout: JSON.stringify(noCursor),
      })),
    /response was incomplete/u
  )
})

test("CLI validates before querying and suppresses Railway response failures", () => {
  assert.deepEqual(parseArguments(["--help"]), { help: true })
  assert.throws(() => parseArguments([]), /Usage:/u)
  let calls = 0
  const invalid = manifest()
  invalid.inventory.services = []
  const result = runPreflight(["--manifest", "ignored"], {
    read: () => invalid,
    query: () => {
      calls += 1
      return response()
    },
    now: NOW,
  })
  assert.equal(result.passed, false)
  assert.equal(calls, 0)

  assert.throws(
    () =>
      queryRailway(manifest(), () => ({ status: 1, stdout: "private-value" })),
    /Railway metadata query failed/u
  )
  assert.throws(
    () => queryRailway(manifest(), () => ({ status: 0, stdout: "not json" })),
    /response was invalid/u
  )
  assert.throws(
    () =>
      queryRailway(manifest(), () => ({
        status: 0,
        stdout: '{"errors":["private-value"]}',
      })),
    /response was incomplete/u
  )
  assert.equal(
    runPreflight(["--manifest", "ignored"], {
      read: manifest,
      query: response,
      now: NOW,
    }).passed,
    true
  )
})

test("CLI help and invalid args do not contact Railway", () => {
  const script = new URL("./client-staging-preflight.mjs", import.meta.url)
  const help = spawnSync(process.execPath, [script.pathname, "--help"], {
    encoding: "utf8",
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /--manifest/u)

  const invalid = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
  })
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /Usage:/u)
})

test("CLI rejects value-bearing manifests without printing their content", () => {
  const directory = mkdtempSync(join(tmpdir(), "client-staging-preflight-"))
  try {
    const path = join(directory, "inventory.json")
    writeFileSync(path, '{"STRIPE_API_KEY":"synthetic-private-value"}', {
      mode: 0o600,
    })
    const script = new URL("./client-staging-preflight.mjs", import.meta.url)
    const result = spawnSync(
      process.execPath,
      [script.pathname, "--manifest", path],
      { encoding: "utf8" }
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Manifest must contain only/u)
    assert.doesNotMatch(result.stderr, /synthetic-private-value/u)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("manifest reader rejects symlinks, non-0600 modes, and nonregular files", () => {
  const directory = mkdtempSync(join(tmpdir(), "client-staging-manifest-"))
  try {
    const path = join(directory, "inventory.json")
    const link = join(directory, "inventory-link.json")
    writeFileSync(path, JSON.stringify(manifest()), { mode: 0o600 })
    assert.deepEqual(readManifest(path), manifest())

    symlinkSync(path, link)
    assert.throws(() => readManifest(link), /valid names-only manifest/u)
    chmodSync(path, 0o644)
    assert.throws(() => readManifest(path), /valid names-only manifest/u)
    chmodSync(path, 0o400)
    assert.throws(() => readManifest(path), /valid names-only manifest/u)
    assert.throws(() => readManifest(directory), /valid names-only manifest/u)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
