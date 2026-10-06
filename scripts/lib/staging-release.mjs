import assert from "node:assert/strict"

export const STAGING = Object.freeze({
  repository: "traweezy/remorseless-records",
  projectId: "1f39263a-25e4-4d69-abc2-f0287b331d1e",
  environmentId: "799a2f98-f819-495d-b8b6-12e71af86568",
  services: [
    {
      name: "Backend",
      alias: "backend",
      id: "99d4fd5e-955b-416a-9078-0266bcf949d2",
      domain: "remorseless-records-admin-staging.up.railway.app",
      checks: [
        "database",
        "redis",
        "search",
        "object_storage",
        "capability_payment",
        "capability_tax",
        "capability_notification",
        "capability_payment_lifecycle",
        "capability_search",
        "capability_object_storage",
        "capability_admin_rbac",
      ],
    },
    {
      name: "Storefront",
      alias: "storefront",
      id: "a6cc2c60-16db-4753-8206-b3d02187810c",
      domain: "storefront-staging-41f0.up.railway.app",
      checks: ["backend", "redis"],
    },
  ],
})
export const WORKFLOWS = ["root", "backend", "storefront", "runtime-images"]
export const WORKFLOW_CHECKS = {
  root: [
    "Security & Audit",
    "Secret scan",
    "SBOM & Production Licenses",
    "dependency-review",
  ],
  backend: [
    "Backend Security & Audit (Shai-Hulud, pnpm audit)",
    "Backend Secret Scan (TruffleHog)",
    "Backend CodeQL Analyze (JS/TS, security-extended)",
    "Typecheck + Trivy FS (backend)",
    "Lint (backend)",
    "Unit Tests (backend)",
    "Disposable PostgreSQL & Redis Integration",
    "Build (backend)",
    "Backend Dependency Review (push/PR)",
  ],
  storefront: [
    "Storefront Security & Audit (Shai-Hulud, pnpm audit)",
    "Storefront Secret Scan (TruffleHog)",
    "Storefront CodeQL Analyze (JS/TS, security-extended)",
    "Typecheck + Trivy FS (storefront)",
    "Lint (storefront)",
    "Unit Tests (storefront)",
    "Build (storefront)",
    "Storefront Dependency Review (push/PR)",
  ],
  "runtime-images": [
    "Validate runtime image (backend)",
    "Validate runtime image (storefront)",
  ],
}
export const REQUIRED_CHECKS = Object.values(WORKFLOW_CHECKS).flat()

export const assertRevision = (value) => {
  assert.equal(typeof value, "string")
  assert.equal(value.length, 40)
  assert.match(value, /^[a-f0-9]{40}$/u)
  assert.notEqual(value, "0".repeat(40))
}
const safeId = (value) =>
  typeof value === "string" &&
  value.length === 36 &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value)
    ? value
    : null
const safeEnum = (value, allowed) =>
  allowed.includes(value) ? value : "unknown"

export const verifyStagingProtection = (protection) => {
  assert.equal(protection.required_status_checks.strict, true)
  assert.deepEqual(
    protection.required_status_checks.checks
      .map(({ context, app_id }) => {
        assert.equal(app_id, 15368)
        return context
      })
      .sort(),
    [...REQUIRED_CHECKS].sort()
  )
  assert.equal(protection.enforce_admins.enabled, false)
  assert.equal(protection.allow_force_pushes.enabled, false)
  assert.equal(protection.allow_deletions.enabled, false)
  assert.ok(!protection.required_pull_request_reviews)
}

export const selectReleaseWorkflowRuns = (workflows, sha) => {
  assertRevision(sha)
  const runs = WORKFLOWS.map((workflow) => {
    const response = workflows[workflow]
    assert.ok(
      Array.isArray(response?.workflow_runs) &&
        response.total_count === response.workflow_runs.length &&
        response.total_count < 100
    )
    const matches = response.workflow_runs
      .filter(
        (run) =>
          run.path === `.github/workflows/${workflow}.yml` &&
          run.head_sha === sha &&
          run.event === "push" &&
          run.head_branch === "staging" &&
          run.head_repository?.full_name === STAGING.repository
      )
      .sort((a, b) => b.id - a.id)
    const latest = matches[0]
    return {
      workflow,
      runId: Number.isSafeInteger(latest?.id) ? latest.id : null,
      checkSuiteId: Number.isSafeInteger(latest?.check_suite_id)
        ? latest.check_suite_id
        : null,
      runAttempt: Number.isSafeInteger(latest?.run_attempt)
        ? latest.run_attempt
        : null,
      passed:
        Number.isSafeInteger(latest?.id) &&
        latest.id > 0 &&
        Number.isSafeInteger(latest.check_suite_id) &&
        latest.check_suite_id > 0 &&
        Number.isSafeInteger(latest.run_attempt) &&
        latest.run_attempt > 0 &&
        latest.status === "completed" &&
        latest.conclusion === "success",
    }
  })
  const suiteIds = runs
    .map((run) => run.checkSuiteId)
    .filter((value) => Number.isSafeInteger(value) && value > 0)
  assert.equal(new Set(suiteIds).size, suiteIds.length)
  return runs
}

export const evaluateReleaseCi = ({
  sha,
  branch,
  protection,
  checks,
  workflows,
}) => {
  assertRevision(sha)
  assert.equal(branch.name, "staging")
  assert.equal(branch.commit.sha, sha)
  verifyStagingProtection(protection)
  const runs = selectReleaseWorkflowRuns(workflows, sha)
  assert.ok(
    Array.isArray(checks.check_runs) &&
      checks.total_count === checks.check_runs.length &&
      checks.total_count < 100
  )
  const required = runs.flatMap((run) =>
    WORKFLOW_CHECKS[run.workflow].map((name) => {
      const matching = checks.check_runs
        .filter(
          (row) =>
            row.name === name &&
            row.app?.id === 15368 &&
            row.head_sha === sha &&
            row.check_suite?.id === run.checkSuiteId &&
            run.checkSuiteId > 0
        )
        .sort((a, b) => b.id - a.id)
      const latest = matching[0]
      return {
        name,
        passed:
          Number.isSafeInteger(latest?.id) &&
          latest.id > 0 &&
          latest.status === "completed" &&
          latest.conclusion === "success",
      }
    })
  )
  return {
    sha,
    ref: "refs/heads/staging",
    requiredChecks: required,
    workflows: runs,
    passed:
      required.every((row) => row.passed) && runs.every((row) => row.passed),
  }
}

export const evaluateStagingDeployments = (data, sha) => {
  assertRevision(sha)
  const environment = data.environment
  assert.equal(environment.id, STAGING.environmentId)
  assert.equal(environment.projectId, STAGING.projectId)
  assert.equal(environment.deploymentTriggers.pageInfo.hasNextPage, false)
  const triggers = environment.deploymentTriggers.edges.map(({ node }) => node)
  return STAGING.services.map((service) => {
    const instance = data[service.alias]
    assert.equal(instance.serviceId, service.id)
    assert.equal(instance.serviceName, service.name)
    assert.equal(instance.environmentId, STAGING.environmentId)
    assert.equal(instance.healthcheckPath, "/ready")
    assert.ok(
      [
        ...instance.domains.serviceDomains,
        ...instance.domains.customDomains,
      ].some(
        (domain) =>
          domain.domain === service.domain &&
          domain.serviceId === service.id &&
          domain.environmentId === STAGING.environmentId
      )
    )
    const matched = triggers.filter(
      (trigger) => trigger.serviceId === service.id
    )
    assert.equal(matched.length, 1)
    for (const trigger of matched) {
      assert.equal(trigger.projectId, STAGING.projectId)
      assert.equal(trigger.environmentId, STAGING.environmentId)
      assert.equal(trigger.branch, "staging")
      assert.equal(trigger.repository, STAGING.repository)
      assert.equal(trigger.provider, "github")
      assert.equal(trigger.checkSuites, true)
    }
    assert.ok(
      Array.isArray(instance.activeDeployments) &&
        instance.activeDeployments.length <= 4
    )
    const active = instance.activeDeployments.map((deployment) => {
      assert.equal(deployment.projectId, STAGING.projectId)
      assert.equal(deployment.environmentId, STAGING.environmentId)
      assert.equal(deployment.serviceId, service.id)
      return {
        id: safeId(deployment.id),
        status: safeEnum(deployment.status, [
          "SUCCESS",
          "BUILDING",
          "DEPLOYING",
          "WAITING",
          "FAILED",
          "CRASHED",
          "REMOVING",
        ]),
        exact:
          deployment.meta?.commitHash === sha &&
          deployment.meta?.branch === "staging" &&
          deployment.meta?.repo === STAGING.repository,
      }
    })
    const latest = instance.latestDeployment
    return {
      service: service.name,
      active,
      latest: {
        id: safeId(latest?.id),
        status: safeEnum(latest?.status, [
          "SUCCESS",
          "BUILDING",
          "DEPLOYING",
          "WAITING",
          "FAILED",
          "CRASHED",
          "SKIPPED",
        ]),
        exact: latest?.meta?.commitHash === sha,
      },
      passed:
        active.length === 1 &&
        active[0].id !== null &&
        active[0].status === "SUCCESS" &&
        active[0].exact &&
        latest?.id === active[0].id &&
        latest.status === "SUCCESS" &&
        latest.meta?.commitHash === sha,
    }
  })
}

export const evaluateReleaseHealth = (
  service,
  path,
  sha,
  { status, noStore, body }
) => {
  assertRevision(sha)
  assert.ok(
    STAGING.services.includes(service) && ["/live", "/ready"].includes(path)
  )
  const checks = service.checks.map((name) => ({
    name,
    passed:
      Array.isArray(body?.checks) &&
      body.checks.filter(
        (check) => check.name === name && check.status === "ok"
      ).length === 1,
  }))
  return {
    service: service.name,
    path,
    httpStatus: Number.isInteger(status) ? status : null,
    passed:
      status === 200 &&
      noStore === true &&
      body?.status === "ok" &&
      body.version === sha &&
      (path === "/live" ||
        (checks.every((check) => check.passed) &&
          body.checks.every((check) => check.status === "ok"))),
  }
}
