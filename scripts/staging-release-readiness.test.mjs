import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { BACKUPS_QUERY } from "./lib/staging-backups.mjs"
import { backupFixture } from "./test-fixtures/staging-backups.mjs"

import {
  assertRevision,
  evaluateReleaseCi,
  evaluateReleaseHealth,
  evaluateStagingDeployments,
  REQUIRED_CHECKS,
  STAGING,
  verifyStagingProtection,
  WORKFLOW_CHECKS,
  WORKFLOWS,
} from "./lib/staging-release.mjs"
import {
  collectReleaseReadiness,
  parseArguments,
  readPublicHealth,
} from "./staging-release-readiness.mjs"

const sha = "b".repeat(40)
const base = "a".repeat(40)
const id = "11111111-2222-4333-8444-555555555555"
const protection = () => ({
  required_status_checks: {
    strict: true,
    checks: REQUIRED_CHECKS.map((context) => ({ context, app_id: 15368 })),
  },
  enforce_admins: { enabled: false },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
})
const ciFixture = () => ({
  sha,
  branch: { name: "staging", commit: { sha } },
  protection: protection(),
  checks: {
    total_count: REQUIRED_CHECKS.length,
    check_runs: REQUIRED_CHECKS.map((name, index) => ({
      id: index + 1,
      name,
      app: { id: 15368 },
      check_suite: {
        id:
          1000 +
          WORKFLOWS.findIndex((workflow) =>
            WORKFLOW_CHECKS[workflow].includes(name)
          ),
      },
      head_sha: sha,
      status: "completed",
      conclusion: "success",
    })),
  },
  workflows: Object.fromEntries(
    WORKFLOWS.map((name, index) => [
      name,
      {
        total_count: 1,
        workflow_runs: [
          {
            id: 100 + index,
            check_suite_id: 1000 + index,
            run_attempt: 1,
            path: `.github/workflows/${name}.yml`,
            head_sha: sha,
            head_branch: "staging",
            head_repository: { full_name: STAGING.repository },
            event: "push",
            status: "completed",
            conclusion: "success",
          },
        ],
      },
    ])
  ),
})
const deploymentFixture = (revision = sha) => ({
  environment: {
    id: STAGING.environmentId,
    projectId: STAGING.projectId,
    deploymentTriggers: {
      pageInfo: { hasNextPage: false },
      edges: STAGING.services.map((service) => ({
        node: {
          serviceId: service.id,
          environmentId: STAGING.environmentId,
          projectId: STAGING.projectId,
          branch: "staging",
          checkSuites: true,
          provider: "github",
          repository: STAGING.repository,
        },
      })),
    },
  },
  ...Object.fromEntries(
    STAGING.services.map((service) => {
      const deployment = {
        id,
        status: "SUCCESS",
        projectId: STAGING.projectId,
        environmentId: STAGING.environmentId,
        serviceId: service.id,
        meta: {
          commitHash: revision,
          branch: "staging",
          repo: STAGING.repository,
          privateValue: "must-never-be-emitted",
        },
      }
      return [
        service.alias,
        {
          serviceId: service.id,
          serviceName: service.name,
          environmentId: STAGING.environmentId,
          healthcheckPath: "/ready",
          domains: {
            serviceDomains: [
              {
                domain: service.domain,
                environmentId: STAGING.environmentId,
                serviceId: service.id,
              },
            ],
            customDomains: [],
          },
          activeDeployments: [deployment],
          latestDeployment: structuredClone(deployment),
        },
      ]
    })
  ),
})
const healthFixture = (service, revision = sha) => ({
  status: 200,
  noStore: true,
  body: {
    status: "ok",
    version: revision,
    checks: service.checks.map((name) => ({ name, status: "ok" })),
    privateValue: "must-never-be-emitted",
  },
})

test("arguments require a full exact revision and reject duplicate, unknown and injected options", () => {
  assert.deepEqual(parseArguments(["--", "--sha", sha, "--ci-only"]), {
    sha,
    ciOnly: true,
  })
  assert.deepEqual(parseArguments(["--help"]), { help: true })
  for (const input of [
    [],
    ["--sha", "abc"],
    ["--sha", sha, "--sha", sha],
    ["--sha", sha, "--unknown"],
    ["--sha", sha, "--candidate-base", sha],
    ["--ci-only", "--ci-only", "--sha", sha],
    ["--sha", sha, "--candidate-base"],
  ])
    assert.throws(() => parseArguments(input))
  for (const value of [null, "0".repeat(40), "HEAD", `${sha}\n`])
    assert.throws(() => assertRevision(value))
})

test("protection requires every exact app-bound check, administrators and direct staging restrictions", () => {
  verifyStagingProtection(protection())
  for (const mutate of [
    (p) => {
      p.required_status_checks.strict = false
    },
    (p) => {
      p.required_status_checks.checks.pop()
    },
    (p) => {
      p.required_status_checks.checks[0].app_id = -1
    },
    (p) => {
      p.required_status_checks.checks[0].context = "other"
    },
    (p) => {
      p.enforce_admins.enabled = true
    },
    (p) => {
      p.allow_force_pushes.enabled = true
    },
    (p) => {
      p.allow_deletions.enabled = true
    },
    (p) => {
      p.required_pull_request_reviews = {}
    },
  ]) {
    const p = protection()
    mutate(p)
    assert.throws(() => verifyStagingProtection(p))
  }
})

test("CI binds workflows and check runs to the same repository, event, ref and revision", () => {
  assert.equal(evaluateReleaseCi(ciFixture()).passed, true)
  for (const mutate of [
    (f) => {
      f.checks.check_runs[0].head_sha = base
    },
    (f) => {
      f.checks.check_runs[0].app.id = 1
    },
    (f) => {
      f.checks.check_runs[0].check_suite.id = 1001
    },
    (f) => {
      delete f.checks.check_runs[0].check_suite
    },
    (f) => {
      f.checks.check_runs[0].conclusion = "skipped"
    },
    (f) => {
      f.checks.check_runs[0].status = "in_progress"
    },
    (f) => {
      f.checks.check_runs.push({
        ...f.checks.check_runs[0],
        id: 500,
        conclusion: "failure",
      })
      f.checks.total_count++
    },
    (f) => {
      f.workflows.backend.workflow_runs[0].head_sha = base
    },
    (f) => {
      f.workflows.backend.workflow_runs[0].head_branch = "master"
    },
    (f) => {
      f.workflows.backend.workflow_runs[0].event = "pull_request"
    },
    (f) => {
      f.workflows.backend.workflow_runs[0].head_repository.full_name =
        "other/repository"
    },
    (f) => {
      f.workflows.backend.workflow_runs[0].conclusion = "cancelled"
    },
    (f) => {
      delete f.workflows.backend.workflow_runs[0].check_suite_id
    },
    (f) => {
      f.workflows.backend.workflow_runs[0].run_attempt = 0
    },
    (f) => {
      f.workflows.backend.workflow_runs.push({
        ...f.workflows.backend.workflow_runs[0],
        id: 999,
        status: "in_progress",
        conclusion: null,
      })
      f.workflows.backend.total_count++
    },
  ]) {
    const f = ciFixture()
    mutate(f)
    assert.equal(evaluateReleaseCi(f).passed, false)
  }
  for (const mutate of [
    (f) => {
      f.branch.commit.sha = "c".repeat(40)
    },
    (f) => {
      f.checks.total_count++
    },
    (f) => {
      f.workflows.root.total_count++
    },
    (f) => {
      f.workflows.backend.workflow_runs[0].check_suite_id =
        f.workflows.root.workflow_runs[0].check_suite_id
    },
  ]) {
    const f = ciFixture()
    mutate(f)
    assert.throws(() => evaluateReleaseCi(f))
  }
})

test("scheduled checks cannot replace the selected push suite or repair its failures", () => {
  const f = ciFixture()
  f.checks.check_runs.push(
    ...f.checks.check_runs.map((row) => ({
      ...row,
      id: row.id + 500,
      check_suite: { id: row.check_suite.id + 500 },
      conclusion: "skipped",
    }))
  )
  f.checks.total_count = f.checks.check_runs.length
  assert.equal(evaluateReleaseCi(f).passed, true)
  const pushReview = f.checks.check_runs.find(
    (row) => row.name === "dependency-review" && row.check_suite.id === 1000
  )
  for (const conclusion of ["failure", "skipped", "cancelled", null]) {
    pushReview.conclusion = conclusion
    f.checks.check_runs.find(
      (row) => row.name === "dependency-review" && row.check_suite.id === 1500
    ).conclusion = "success"
    assert.equal(evaluateReleaseCi(f).passed, false)
  }
  pushReview.conclusion = "success"
  f.workflows.root.workflow_runs.push({
    ...f.workflows.root.workflow_runs[0],
    id: 999,
    check_suite_id: 9999,
  })
  f.workflows.root.total_count++
  assert.equal(evaluateReleaseCi(f).passed, false)
})

test("Railway verifies source triggers, target domains and stable single active deployments", () => {
  const result = evaluateStagingDeployments(deploymentFixture(), sha)
  assert.ok(result.every((service) => service.passed))
  assert.ok(!JSON.stringify(result).includes("must-never-be-emitted"))
  const failed = deploymentFixture()
  failed.backend.latestDeployment.status = "FAILED"
  const failedReport = evaluateStagingDeployments(failed, sha)[0]
  assert.equal(failedReport.passed, false)
  assert.deepEqual(failedReport.latest, {
    id,
    status: "FAILED",
    exact: true,
  })
  for (const mutate of [
    (f) => {
      f.backend.activeDeployments[0].meta.commitHash = base
    },
    (f) => {
      f.backend.activeDeployments[0].meta.branch = "master"
    },
    (f) => {
      f.backend.activeDeployments[0].status = "DEPLOYING"
    },
    (f) => {
      f.backend.latestDeployment.status = "SKIPPED"
    },
    (f) => {
      f.backend.activeDeployments = []
    },
    (f) => {
      f.backend.activeDeployments.push(
        structuredClone(f.backend.activeDeployments[0])
      )
    },
  ]) {
    const f = deploymentFixture()
    mutate(f)
    assert.equal(evaluateStagingDeployments(f, sha)[0].passed, false)
  }
  for (const mutate of [
    (f) => {
      f.environment.projectId = id
    },
    (f) => {
      f.environment.deploymentTriggers.pageInfo.hasNextPage = true
    },
    (f) => {
      f.environment.deploymentTriggers.edges[0].node.checkSuites = false
    },
    (f) => {
      f.environment.deploymentTriggers.edges[0].node.branch = "master"
    },
    (f) => {
      f.backend.domains.serviceDomains[0].domain = "wrong.invalid"
    },
    (f) => {
      f.backend.activeDeployments[0].serviceId = id
    },
    (f) => {
      f.backend.healthcheckPath = "/live"
    },
  ]) {
    const f = deploymentFixture()
    mutate(f)
    assert.throws(() => evaluateStagingDeployments(f, sha))
  }
})

test("health requires uncached exact-revision success and every named dependency", () => {
  const service = STAGING.services[0]
  assert.equal(
    evaluateReleaseHealth(service, "/ready", sha, healthFixture(service))
      .passed,
    true
  )
  for (const mutate of [
    (f) => {
      f.status = 503
    },
    (f) => {
      f.noStore = false
    },
    (f) => {
      f.body.version = base
    },
    (f) => {
      f.body.status = "degraded"
    },
    (f) => {
      f.body.checks.pop()
    },
    (f) => {
      f.body.checks[0].status = "error"
    },
    (f) => {
      f.body.checks.push({ name: "unreviewed", status: "error" })
    },
    (f) => {
      f.body.checks.push(f.body.checks[0])
    },
  ]) {
    const f = healthFixture(service)
    mutate(f)
    assert.equal(evaluateReleaseHealth(service, "/ready", sha, f).passed, false)
  }
})

const transportFixture = (mutate = () => {}) => {
  const ci = ciFixture()
  let deploymentReads = 0
  let branchReads = 0
  const commands = []
  return {
    commands,
    capture: async (command, args) => {
      commands.push([command, args])
      let result
      if (command === "gh") {
        const path = args[1].replace(`repos/${STAGING.repository}/`, "")
        if (path === "branches/staging") {
          result = structuredClone(ci.branch)
          branchReads++
        } else if (path === "branches/staging/protection")
          result = structuredClone(ci.protection)
        else if (path.startsWith("check-suites/")) {
          const suiteId = Number(path.match(/^check-suites\/(\d+)\//u)?.[1])
          const rows = ci.checks.check_runs.filter(
            (row) => row.check_suite.id === suiteId
          )
          result = {
            total_count: rows.length,
            check_runs: structuredClone(rows),
          }
        } else {
          const name = path.match(
            /^actions\/workflows\/(.*)\.yml\/runs\?/u
          )?.[1]
          assert.ok(WORKFLOWS.includes(name))
          result = structuredClone(ci.workflows[name])
        }
      } else if (args[0] === "--version") return "railway 5.45.0\n"
      else if (args[0] === "status")
        result = { id: STAGING.projectId, name: "store" }
      else if (args[0] === "environment")
        result = {
          environments: [
            { id: STAGING.environmentId, name: "staging", isLinked: true },
          ],
        }
      else {
        assert.equal(args[0], "api")
        if (args[1] === BACKUPS_QUERY) result = backupFixture()
        else {
          result = deploymentFixture(sha)
          deploymentReads++
        }
      }
      mutate(result, { command, args, deploymentReads, branchReads })
      return JSON.stringify(result)
    },
    health: async (url) => {
      const service = STAGING.services.find(
        (value) => value.domain === url.hostname
      )
      assert.ok(service)
      return healthFixture(service, sha)
    },
  }
}

test("collector rechecks deployments and branch after probing; health never claims complete acceptance", async () => {
  const full = transportFixture()
  const result = await collectReleaseReadiness({ sha }, full)
  assert.equal(result.passed, true)
  assert.equal(result.releaseAccepted, false)
  assert.equal(result.readyForLocalWork, true)
  assert.equal(result.readyForAcceptance, true)
  assert.equal(
    full.commands.filter(
      ([, args]) => args[0] === "api" && args[1].startsWith("query ")
    ).length,
    3
  )
  assert.ok(!JSON.stringify(result).includes("must-never-be-emitted"))
  assert.equal(result.backups.passed, true)
  const stale = await collectReleaseReadiness(
    { sha },
    transportFixture((value, state) => {
      if (state.args[1] === BACKUPS_QUERY) value.postgresBackups = []
    })
  )
  assert.equal(stale.readyForLocalWork, true)
  assert.equal(stale.readyForAcceptance, false)
  assert.equal(stale.backups.passed, false)
  const ciOnly = transportFixture()
  assert.equal(
    (await collectReleaseReadiness({ sha, ciOnly: true }, ciOnly)).passed,
    true
  )
  assert.ok(ciOnly.commands.every(([command]) => command === "gh"))
  for (const mutate of [
    (value, state) => {
      if (state.args[0] === "status") value.id = id
    },
    (value, state) => {
      if (state.args[0] === "environment")
        value.environments[0].isLinked = false
    },
    (value, state) => {
      if (state.deploymentReads === 2 && value.backend)
        value.backend.activeDeployments[0].id =
          "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    },
    (value, state) => {
      if (
        state.args[1]?.endsWith("branches/staging") &&
        state.branchReads === 2
      )
        value.commit.sha = base
    },
  ])
    await assert.rejects(
      collectReleaseReadiness({ sha }, transportFixture(mutate))
    )
  const io = transportFixture()
  io.health = async () => {
    throw new Error("private provider response")
  }
  const failedHealth = await collectReleaseReadiness({ sha }, io)
  assert.equal(failedHealth.passed, false)
  assert.ok(!JSON.stringify(failedHealth).includes("private provider response"))
})

test("collector reads complete push suites and rejects a rerun during the snapshot", async () => {
  const complete = transportFixture()
  assert.equal(
    (await collectReleaseReadiness({ sha, ciOnly: true }, complete)).passed,
    true
  )
  const suites = complete.commands.filter(
    ([command, args]) => command === "gh" && args[1].includes("/check-suites/")
  )
  assert.equal(suites.length, 4)
  assert.ok(
    suites.every(([, args]) => args[1].endsWith("/check-runs?per_page=100"))
  )
  assert.ok(
    !complete.commands.some(([, args]) => args[1]?.includes("/commits/"))
  )
  for (const mutate of [
    (value, state) => {
      if (state.args[1]?.includes("/check-suites/1000/")) value.total_count++
    },
    (value, state) => {
      if (state.args[1]?.includes("/check-suites/1000/"))
        value.check_runs[0].check_suite.id = 9999
    },
  ])
    await assert.rejects(
      collectReleaseReadiness({ sha, ciOnly: true }, transportFixture(mutate))
    )
  let reads = 0
  await assert.rejects(
    collectReleaseReadiness(
      { sha, ciOnly: true },
      transportFixture((value, state) => {
        if (state.args[1]?.includes("/workflows/root.yml/runs?")) {
          reads++
          if (reads === 2) value.workflow_runs[0].run_attempt++
        }
      })
    )
  )
})

test("HTTP reads are bounded, reject redirects and preserve uncached response requirements", async () => {
  const body = JSON.stringify(healthFixture(STAGING.services[0]).body)
  const result = await readPublicHealth(
    new URL("https://example.invalid/ready"),
    async (_url, options) => {
      assert.equal(options.redirect, "error")
      assert.ok(options.signal instanceof AbortSignal)
      return new Response(body, {
        status: 200,
        headers: { "cache-control": "private, no-store" },
      })
    }
  )
  assert.equal(result.noStore, true)
  for (const value of ["not json", "x".repeat(65537)])
    await assert.rejects(
      readPublicHealth(
        new URL("https://example.invalid/ready"),
        async () => new Response(value)
      )
    )
})

test("CLI help and invalid arguments never invoke provider commands or echo input", () => {
  const script = new URL("./staging-release-readiness.mjs", import.meta.url)
  const help = spawnSync(process.execPath, [script.pathname, "--help"], {
    encoding: "utf8",
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Usage:/u)
  const invalid = spawnSync(
    process.execPath,
    [script.pathname, "--sha", "private-invalid-value"],
    { encoding: "utf8" }
  )
  assert.equal(invalid.status, 1)
  assert.equal(invalid.stdout, "")
  assert.deepEqual(JSON.parse(invalid.stderr), {
    readOnly: true,
    passed: false,
    error: "staging_release_readiness_unverified",
  })
})
