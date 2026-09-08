import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const aggregate = "qa:ci-shared-contracts"
const boundary = "qa:ci-shared-contracts-boundary"
const toolchain = "qa:toolchain-runtime"
const command = (name) => `pnpm run ${name}`
const toolchainCommand =
  "node --test --test-isolation=process --test-timeout=60000 --experimental-test-coverage --test-coverage-include=scripts/install-git-hooks.mjs --test-coverage-include=scripts/run-git-hook.mjs --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 scripts/git-hooks.test.mjs scripts/tsx-runtime.test.mjs"
const boundaryCommand =
  "node --test --experimental-test-coverage --test-coverage-include=scripts/verify-ci-shared-contracts.mjs --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 scripts/verify-ci-shared-contracts.test.mjs && node scripts/verify-ci-shared-contracts.mjs"
const sharedContracts = Object.freeze({
  "qa:service-container-resolution":
    "node scripts/verify-service-container-resolution.mjs",
  "qa:storefront-response-boundary":
    "node scripts/verify-storefront-response-boundary.mjs",
  "qa:admin-browser-boundary": "node scripts/verify-admin-browser-boundary.mjs",
  "qa:database-release-boundary":
    "node --test scripts/release-prepare.test.mjs scripts/postgres-logical-backup.test.mjs scripts/postgres-restore.test.mjs scripts/recovery-process.test.mjs scripts/postgres-recovery-cli.test.mjs scripts/media-backup.test.mjs scripts/media-object-checksum.test.mjs scripts/media-backup-cli.test.mjs && pnpm run qa:redis-capacity",
  "qa:storefront-provider-fixture":
    "node --test storefront/scripts/ci-medusa-fixture.test.mjs",
  "qa:dashboard-product-create":
    "node scripts/verify-dashboard-product-create-boundary.mjs",
  "qa:workflow-scheduler-timestamps":
    "node scripts/verify-workflow-scheduler-timestamp.mjs",
  "qa:disposable-integration-boundary":
    "node --test --experimental-test-coverage --test-coverage-include=scripts/run-disposable-integration.mjs --test-coverage-include=scripts/scan-disposable-integration-images.mjs --test-coverage-include=scripts/verify-disposable-integration-boundary.mjs --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 scripts/run-disposable-integration.test.mjs scripts/scan-disposable-integration-images.test.mjs scripts/verify-disposable-integration-boundary.test.mjs && node scripts/verify-disposable-integration-boundary.mjs",
  "qa:operations-observation":
    "node --test scripts/observe-operations-health.test.mjs",
  "qa:observability-bootstrap":
    "node scripts/verify-observability-bootstrap.mjs",
})
const existingContracts = Object.freeze([
  "qa:release-policy",
  "qa:dependency-supply-chain",
  "qa:ci-runtime-security",
  "qa:runtime-images",
  "qa:admin-accessibility-boundary",
  "qa:railway-iac",
  "qa:browser-toolchain-security",
  "qa:medusa-build-toolchain",
  "qa:dashboard-product-import",
  "qa:dashboard-product-deletion",
  "qa:secure-artifacts",
  "qa:api-contract",
  "qa:framework-response-headers",
  "qa:checkout-recovery",
  "qa:commerce-reliability",
  "qa:tax-golden-matrix",
  "qa:scheduler-observation",
  "qa:railway-runtime-logs",
])
const compilerCommands = Object.freeze([
  "pnpm --filter remorseless-records-storefront run typecheck",
  "pnpm --filter backend exec tsc --noEmit",
])
const redisCoverageCommand =
  "node --test --experimental-test-coverage --test-coverage-include=scripts/lib/redis-capacity-audit.mjs --test-coverage-include=scripts/lib/redis-audit-client.mjs --test-coverage-include=scripts/lib/cli-arguments.mjs --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 scripts/cli-arguments.test.mjs scripts/redis-capacity-audit.test.mjs scripts/redis-audit-client.test.mjs scripts/redis-audit-cli.test.mjs"

const scriptChain = (source) => {
  assert.equal(typeof source, "string")
  assert.ok(source.length > 0 && source.length <= 16384)
  assert.doesNotMatch(source, /[\r\n\u0000]/u)
  return source.split(" && ")
}

// This deliberately accepts the repository's reviewed YAML-text layout, not
// arbitrary YAML. Ambiguous layouts, aliases, folded run commands, or new
// bypass controls must receive an explicit policy/test review.
const securitySteps = (source) => {
  assert.equal(typeof source, "string")
  assert.ok(source.length > 0 && source.length <= 131072)
  assert.doesNotMatch(source, /[\t\u0000]/u)
  const lines = source.split(/\r?\n/u)
  assert.ok(lines.length <= 4096)
  for (const line of lines.filter((line) => line && !/^\s|^#/u.test(line)))
    assert.ok(
      ["name: Root CI", "on:", "jobs:"].includes(line),
      "Unreviewed workflow-level controls"
    )
  assert.equal(lines.filter((line) => line === "jobs:").length, 1)
  const jobsIndex = lines.indexOf("jobs:")
  assert.deepEqual(
    lines
      .slice(0, jobsIndex)
      .filter((line) => line.trim() && !line.trimStart().startsWith("#")),
    [
      "name: Root CI",
      "on:",
      "  push:",
      "    branches: [staging, master]",
      "  pull_request:",
      "    branches: [staging, master]",
      "  schedule:",
      '    - cron: "0 4 * * 1"',
      "  workflow_dispatch:",
    ],
    "Root trigger changes need explicit review; path filters must not bypass contracts"
  )
  assert.deepEqual(
    lines
      .slice(jobsIndex + 1)
      .filter(
        (line) => /^  \S/u.test(line) && !line.trimStart().startsWith("#")
      ),
    [
      "  dependency-review:",
      "  security:",
      "  supply-chain-artifacts:",
      "  secrets:",
    ],
    "Root job keys must be canonical and unique, without aliases or shadowing"
  )
  const starts = lines.flatMap((line, index) =>
    line === "  security:" ? [index] : []
  )
  assert.equal(starts.length, 1, "Root must retain one security job")
  const start = starts[0]
  assert.ok(start > lines.indexOf("jobs:"))
  const following = lines.findIndex(
    (line, index) => index > start && /^  [a-zA-Z0-9_-]+:/u.test(line)
  )
  const job = lines.slice(start + 1, following < 0 ? undefined : following)
  const significant = job.filter(
    (line) => line.trim() && !line.trimStart().startsWith("#")
  )
  assert.doesNotMatch(
    significant.join("\n"),
    /(?:^|\s)[&*][a-zA-Z_][a-zA-Z0-9_-]*|^\s*<<:/mu
  )
  assert.equal(job.filter((line) => line === "    steps:").length, 1)
  const stepsIndex = job.indexOf("    steps:")
  assert.deepEqual(
    job
      .slice(0, stepsIndex)
      .filter((line) => line.trim() && !line.trimStart().startsWith("#")),
    ["    name: Security & Audit", "    runs-on: ubuntu-latest"],
    "Root security job must not inherit conditional, error-suppression, or shell controls"
  )
  const body = job
    .slice(stepsIndex + 1)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
  const steps = []
  for (const line of body) {
    if (/^      - /u.test(line)) steps.push([line])
    else {
      assert.ok(
        steps.length > 0 && /^        /u.test(line),
        "Unreviewed security step layout"
      )
      steps.at(-1).push(line)
    }
  }
  return steps
}

const exactStep = (steps, run) => {
  const matches = steps.flatMap((step, index) =>
    step.includes(`        run: ${run}`) ? [{ step, index }] : []
  )
  assert.equal(matches.length, 1, `Root requires one enforced ${run} step`)
  const { step, index } = matches[0]
  assert.match(step[0], /^      - name: [a-zA-Z][a-zA-Z0-9 ()/&:-]*$/u)
  assert.deepEqual(
    step.slice(1),
    [`        run: ${run}`],
    `${run} must not have bypass controls`
  )
  return index
}

export const validateCiSharedContracts = ({
  packageManifest,
  rootWorkflow,
}) => {
  const scripts = packageManifest?.scripts
  assert.ok(scripts && typeof scripts === "object")
  const sharedNames = Object.keys(sharedContracts)
  assert.deepEqual(
    scriptChain(scripts[aggregate]),
    sharedNames.map(command),
    "Shared aggregate must run all ten reviewed contracts once"
  )
  assert.equal(scripts[boundary], boundaryCommand)
  assert.equal(
    scripts[toolchain],
    toolchainCommand,
    "Project hook and loader runtime coverage/test scope must remain enforced"
  )
  assert.equal(
    scripts.prepare,
    "node scripts/install-git-hooks.mjs",
    "Prepare must retain the ownership-refusing project hook installer"
  )
  for (const [name, expected] of Object.entries(sharedContracts))
    assert.equal(
      scripts[name],
      expected,
      `Shared contract command drift: ${name}`
    )
  assert.equal(
    scripts["qa:redis-capacity"],
    redisCoverageCommand,
    "Redis helper coverage/test scope must remain enforced"
  )

  const local = scriptChain(scripts["qa:lint"])
  const expectedLocal = [
    "biome check --error-on-warnings .",
    command(boundary),
    command(aggregate),
    command(toolchain),
    ...existingContracts.map(command),
    ...compilerCommands,
  ]
  assert.deepEqual(
    [...local].sort(),
    [...expectedLocal].sort(),
    "Local contracts need an explicit CI mapping; duplicate or unmapped gates are forbidden"
  )
  assert.equal(local[0], expectedLocal[0])
  assert.deepEqual(local.slice(-2), compilerCommands)
  assert.ok(
    local.indexOf(command(boundary)) < local.indexOf(command(aggregate))
  )

  const steps = securitySteps(rootWorkflow)
  const install = exactStep(steps, "pnpm install --frozen-lockfile")
  const guard = exactStep(steps, command(boundary))
  const shared = exactStep(steps, command(aggregate))
  const runtime = exactStep(steps, command(toolchain))
  assert.ok(
    install < guard && guard < shared,
    "Install, independent parity guard, then shared contracts must be ordered"
  )
  assert.ok(guard < runtime, "The parity guard must precede runtime contracts")
  for (const name of [boundary, aggregate, toolchain]) {
    const references = rootWorkflow.match(
      new RegExp(`(?<![a-z0-9:-])${name}(?![a-z0-9:-])`, "gu")
    )
    assert.equal(
      references?.length,
      1,
      `${name} must not be duplicated or hidden in another command`
    )
  }
  // Runtime-image policy stays explicitly in local QA and its dedicated push
  // workflow, whose own verifier enforces that intentional publication split.
  for (const name of existingContracts.filter(
    (name) => name !== "qa:runtime-images"
  ))
    exactStep(steps, command(name))
  // These are mocked/pure/local protocol contract tests, not a second service
  // integration job. Backend CI still owns disposable PostgreSQL/Redis services.
  return Object.freeze({
    event: "ci.shared_contracts.verified",
    contractCount: sharedNames.length,
    serviceIntegration: false,
  })
}

export const verifyCiSharedContracts = () => {
  const read = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
  const result = validateCiSharedContracts({
    packageManifest: JSON.parse(read("package.json")),
    rootWorkflow: read(".github/workflows/root.yml"),
  })
  console.log(JSON.stringify(result))
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  verifyCiSharedContracts()
