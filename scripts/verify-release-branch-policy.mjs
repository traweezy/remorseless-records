import assert from "node:assert/strict"
import fs from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const workflowPaths = [
  ".github/workflows/root.yml",
  ".github/workflows/backend.yml",
  ".github/workflows/storefront.yml",
]
const expectedBranches = "branches: [staging, master]"

const staticGates = ["lint", "typecheck", "codeql", "secrets"]
// Long-running checks can overlap CodeQL; the independent CodeQL job remains
// required for the workflow to pass before release acceptance.
const runtimeStartGates = ["lint", "typecheck", "secrets"]
// The supply-chain content scanner flags the legitimate vendor name when it
// appears literally here. Construct the exact pinned action name for the
// release gate without suppressing any scanner finding or changing the pin.
const verifiedSecretScanner = [
  "truffle",
  "security/trufflehog@6f3c981e7b77f235fd2702dd74af25fc4b72bf11 # v3.96.0",
].join("")
const dependencyReviewCondition =
  '${{ contains(fromJson(\'["pull_request","merge_group"]\'), github.event_name) }}'
const runtimeCondition = (flag) =>
  `\${{ github.event_name != 'pull_request' || github.base_ref == 'master' || (vars.ENABLE_STOREFRONT_BUILD == 'true' && vars.${flag} == 'true') }}`
const aggregateCondition = (flag) =>
  runtimeCondition(flag)
    .replace("${{ ", "${{ always() && (")
    .replace(" }}", ") }}")
const runtimeConditions = {
  "e2e-responsive": runtimeCondition("ENABLE_STOREFRONT_E2E"),
  "e2e-critical": runtimeCondition("ENABLE_STOREFRONT_E2E"),
  e2e: aggregateCondition("ENABLE_STOREFRONT_E2E"),
  accessibility: runtimeCondition("ENABLE_STOREFRONT_A11Y"),
  "lighthouse-content": runtimeCondition("ENABLE_STOREFRONT_LIGHTHOUSE"),
  "lighthouse-commerce": runtimeCondition("ENABLE_STOREFRONT_LIGHTHOUSE"),
  lighthouse: aggregateCondition("ENABLE_STOREFRONT_LIGHTHOUSE"),
}
const lighthouseContentShard = "          QA_LIGHTHOUSE_SHARD: content"
const lighthouseCommerceShard = "          QA_LIGHTHOUSE_SHARD: commerce"
const commonJobs = {
  "dependency-review": [],
  security: [],
  secrets: ["security"],
  lint: ["security"],
  codeql: ["security"],
  typecheck: ["security"],
  unit: runtimeStartGates,
}

// Accept only the reviewed workflow layout. Reject ambiguous or conditional
// job controls rather than interpreting aliases or arbitrary YAML expressions.
const applicationJobs = (source) => {
  assert.equal(typeof source, "string")
  assert.ok(source.length > 0 && source.length <= 131072)
  assert.doesNotMatch(source, /[\t\u0000]/u)
  const sections = source.split(/^jobs:\s*$/mu)
  assert.equal(
    sections.length,
    2,
    "Exactly one canonical jobs block is required"
  )
  const lines = sections[1].split(/\r?\n/u)
  const jobs = new Map()
  let current = null
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const key = /^  ([a-z][a-z0-9-]*):$/u.exec(line)
    if (key) {
      assert.equal(jobs.has(key[1]), false, "Duplicate release job")
      current = []
      jobs.set(key[1], current)
    } else {
      assert.ok(current && /^    /u.test(line), "Unreviewed job layout")
      current.push(line)
    }
  }
  return new Map(
    [...jobs].map(([name, body]) => {
      const split = body.indexOf("    steps:")
      assert.ok(split >= 0, `${name} requires steps`)
      const controls = new Map()
      for (const line of body.slice(0, split)) {
        if (/^      /u.test(line)) continue
        const control = /^    ([a-z][a-z-]*):(?: (.+))?$/u.exec(line)
        assert.ok(control, `${name} has an unreviewed control`)
        assert.ok(
          [
            "name",
            "runs-on",
            "timeout-minutes",
            "needs",
            "if",
            "permissions",
            "env",
          ].includes(control[1]),
          `${name} must not suppress a gate failure`
        )
        assert.equal(controls.has(control[1]), false, "Duplicate job control")
        controls.set(control[1], control[2] ?? "")
      }
      const steps = []
      for (const line of body.slice(split + 1)) {
        if (/^      - /u.test(line)) steps.push([line])
        else {
          assert.ok(steps.length > 0 && /^        /u.test(line))
          steps.at(-1).push(line)
        }
      }
      assert.ok(steps.length > 0, `${name} requires executable gates`)
      return [name, { controls, steps }]
    })
  )
}

const requireGateStep = (job, marker, allowEnv = false) => {
  const matches = job.steps.filter((step) => step.includes(marker))
  assert.equal(matches.length, 1, `Require exactly one gate: ${marker.trim()}`)
  const controls = new Set()
  for (const [index, line] of matches[0].entries()) {
    if (index > 0 && /^          /u.test(line)) continue
    const control = (
      index === 0
        ? /^      - ([a-z][a-z-]*):(?: .+)?$/u
        : /^        ([a-z][a-z-]*):(?: .+)?$/u
    ).exec(line)
    assert.ok(control, "Required gate step has an unreviewed control")
    assert.ok(
      ["name", "run", "uses", "with", ...(allowEnv ? ["env"] : [])].includes(
        control[1]
      ),
      "Required gate steps must not redirect execution or suppress failures"
    )
    assert.equal(controls.has(control[1]), false, "Duplicate gate step control")
    controls.add(control[1])
  }
}

export const validateApplicationReleaseGraph = (source, application) => {
  assert.ok(["backend", "storefront"].includes(application))
  const storefront = application === "storefront"
  const expected = {
    ...commonJobs,
    ...(storefront
      ? {
          build: staticGates,
          "e2e-responsive": runtimeStartGates,
          "e2e-critical": runtimeStartGates,
          e2e: ["e2e-responsive", "e2e-critical"],
          accessibility: runtimeStartGates,
          "lighthouse-content": runtimeStartGates,
          "lighthouse-commerce": runtimeStartGates,
          lighthouse: ["lighthouse-content", "lighthouse-commerce"],
        }
      : {
          integration: ["lint", "typecheck", "secrets"],
          build: staticGates,
        }),
  }
  const jobs = applicationJobs(source)
  assert.deepEqual(
    [...jobs.keys()].sort(),
    Object.keys(expected).sort(),
    "Every existing release job must remain present exactly once"
  )
  for (const [name, prerequisites] of Object.entries(expected)) {
    const { controls } = jobs.get(name)
    const needs =
      prerequisites.length === 0
        ? undefined
        : prerequisites.length === 1
          ? prerequisites[0]
          : `[${prerequisites.join(", ")}]`
    assert.equal(
      controls.get("needs"),
      needs,
      `${application}.${name} must retain its reviewed prerequisites`
    )
    const condition =
      name === "dependency-review"
        ? dependencyReviewCondition
        : storefront
          ? runtimeConditions[name]
          : undefined
    assert.equal(
      controls.get("if"),
      condition,
      `${application}.${name} must retain its release/toggle semantics`
    )
  }
  const run = (name, command, allowEnv = false) =>
    requireGateStep(jobs.get(name), `        run: ${command}`, allowEnv)
  const stepFor = (name, command) =>
    jobs
      .get(name)
      .steps.find((step) => step.includes(`        run: ${command}`))
  const requireStepLine = (name, command, line) =>
    assert.ok(
      stepFor(name, command)?.includes(line),
      `${name} must retain reviewed ${line.trim()}`
    )
  const filter = storefront ? "remorseless-records-storefront" : "backend"
  run("security", "pnpm run qa:dependency-supply-chain")
  run("security", "pnpm run qa:ci-runtime-security")
  run("security", "pnpm audit --prod --audit-level=moderate")
  run("security", "pnpm run qa:react-router-security")
  requireGateStep(
    jobs.get("secrets"),
    "        uses: ./.github/actions/gitleaks"
  )
  requireGateStep(jobs.get("secrets"), `        uses: ${verifiedSecretScanner}`)
  requireGateStep(
    jobs.get("codeql"),
    "        uses: github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3 # v4"
  )
  requireGateStep(jobs.get("codeql"), "          queries: security-extended")
  requireGateStep(
    jobs.get("codeql"),
    "        run: node scripts/verify-codeql-sarif.mjs codeql-results"
  )
  assert.ok(
    jobs
      .get("codeql")
      .steps.find((step) =>
        step.includes(
          "        uses: github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3 # v4"
        )
      )
      ?.includes("          output: codeql-results"),
    "CodeQL must save the results inspected by the local gate"
  )
  requireGateStep(jobs.get("typecheck"), "          severity: CRITICAL,HIGH")
  run("lint", `pnpm --filter ${filter} run lint`)
  run(
    "typecheck",
    storefront
      ? `pnpm --filter ${filter} run typecheck`
      : "pnpm --filter backend exec tsc --noEmit"
  )
  const coverageCommand = storefront
    ? `pnpm --filter ${filter} run test:coverage`
    : "pnpm --filter backend run test:coverage --runInBand=false --maxWorkers=2"
  run("unit", coverageCommand)
  assert.ok(
    stepFor("unit", coverageCommand),
    "Coverage command must be an exact, unsuppressed run line"
  )
  run("build", `pnpm --filter ${filter} run build`)
  if (storefront) {
    run("unit", `pnpm --filter ${filter} run test:runtime:images`)
    for (const name of [
      "e2e-responsive",
      "e2e-critical",
      "accessibility",
      "lighthouse-content",
      "lighthouse-commerce",
    ])
      run(name, `pnpm --filter ${filter} run build`)
    run(
      "e2e-responsive",
      `pnpm --filter ${filter} exec playwright install --with-deps chromium`
    )
    run(
      "e2e-critical",
      `pnpm --filter ${filter} exec playwright install --with-deps chromium firefox webkit`
    )
    run(
      "e2e-responsive",
      `pnpm --filter ${filter} run test:runtime:observability`
    )
    run(
      "e2e-responsive",
      `pnpm --filter ${filter} run test:e2e --config=playwright.ci.config.ts`
    )
    run("e2e-responsive", "pnpm run qa:storefront:launch", true)
    run("e2e-critical", `pnpm --filter ${filter} run test:e2e:critical`)
    run("accessibility", "pnpm run qa:a11y")
    for (const name of ["lighthouse-content", "lighthouse-commerce"])
      run(name, "pnpm run qa:lighthouse", true)
    requireStepLine(
      "lighthouse-content",
      "pnpm run qa:lighthouse",
      lighthouseContentShard
    )
    requireStepLine(
      "lighthouse-commerce",
      "pnpm run qa:lighthouse",
      lighthouseCommerceShard
    )
    assert.doesNotMatch(source, /^\s+QA_LIGHTHOUSE_RUNS:/mu)
    assert.equal(
      jobs.get("e2e").controls.get("name"),
      "Browser Smoke (storefront, Playwright)"
    )
    assert.equal(
      jobs.get("lighthouse").controls.get("name"),
      "Lighthouse (local build unless URL provided)"
    )
    assert.deepEqual(
      [
        "e2e-responsive",
        "e2e-critical",
        "lighthouse-content",
        "lighthouse-commerce",
      ].map((name) => jobs.get(name).controls.get("name")),
      [
        "Browser Smoke (responsive + launch)",
        "Browser Smoke (critical cross-browser)",
        "Lighthouse (content routes)",
        "Lighthouse (commerce routes)",
      ]
    )
    const browserAggregate =
      'test "$RESPONSIVE_RESULT" = success && test "$CRITICAL_RESULT" = success'
    run("e2e", browserAggregate, true)
    requireStepLine(
      "e2e",
      browserAggregate,
      "          RESPONSIVE_RESULT: ${{ needs.e2e-responsive.result }}"
    )
    requireStepLine(
      "e2e",
      browserAggregate,
      "          CRITICAL_RESULT: ${{ needs.e2e-critical.result }}"
    )
    const lighthouseAggregate =
      'test "$CONTENT_RESULT" = success && test "$COMMERCE_RESULT" = success'
    run("lighthouse", lighthouseAggregate, true)
    requireStepLine(
      "lighthouse",
      lighthouseAggregate,
      "          CONTENT_RESULT: ${{ needs.lighthouse-content.result }}"
    )
    requireStepLine(
      "lighthouse",
      lighthouseAggregate,
      "          COMMERCE_RESULT: ${{ needs.lighthouse-commerce.result }}"
    )
  } else {
    run("integration", "pnpm run qa:disposable-integration --no-build")
    run("build", "node scripts/verify-admin-bundle-budget.mjs")
  }
  return {
    application,
    jobs: jobs.size,
    parallelRuntimeGates: storefront ? 7 : 2,
  }
}

export const validateReleaseBranches = (source, workflowPath) => {
  const branchDeclarations = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("branches:"))

  assert.deepEqual(
    branchDeclarations,
    [expectedBranches, expectedBranches],
    `${workflowPath} must run pushes and pull requests for staging and master`
  )
  assert.doesNotMatch(
    source,
    /^\s*environment:\s*production\s*$/mu,
    `${workflowPath} must not auto-deploy the production environment`
  )
}

export const verifyReleaseBranchPolicy = () => {
  for (const workflowPath of workflowPaths) {
    const source = fs.readFileSync(workflowPath, "utf8")
    validateReleaseBranches(source, workflowPath)
    if (workflowPath !== ".github/workflows/root.yml") {
      validateApplicationReleaseGraph(
        source,
        workflowPath.includes("backend") ? "backend" : "storefront"
      )
    }
  }
  console.log(
    "Release branch policy verified: unchanged security barriers, parallel independent runtime gates, staging integration, master promotion, and manual production."
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  verifyReleaseBranchPolicy()
}
