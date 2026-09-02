import assert from "node:assert/strict"
import { readFileSync, readdirSync, realpathSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const manifestPath = join(
  root,
  "scripts",
  "security",
  "ci-runtime-security-policy.json"
)
const reviewedActions = {
  hardenRunner: {
    commit: "05e31511f85b41b11d1cf0ef85d0992719546e2c",
    publishedAt: "2026-08-15T05:52:25.000Z",
    repository: "step-security/harden-runner",
    runtime: "node24",
    version: "v2.21.0",
  },
  shaiHuludDetector: {
    commit: "2755f94762bf5012bc7be82c93e172eabbcd0802",
    publishedAt: "2026-08-07T20:19:45.000Z",
    repository: "gensecaihq/Shai-Hulud-2.0-Detector",
    runtime: "node24",
    version: "v2.2.0",
  },
}
const forbiddenEndpoints = new Set(["cloudflare-dns.com:443", "dns.google:443"])
const trivyDatabaseRepository = "ghcr.io/aquasecurity/trivy-db"

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const leadingWidth = (line) => line.match(/^\s*/u)?.[0].length ?? 0

const extractActionSteps = (source, repository, expectedCount) => {
  const lines = source.split(/\r?\n/u)
  const pattern = new RegExp(
    `^(\\s*)uses:\\s+${escapeRegExp(repository)}@([0-9a-f]{40})\\s+#\\s+(\\S+)\\s*$`,
    "u"
  )
  const matches = lines.flatMap((line, index) => {
    const match = line.match(pattern)
    return match
      ? [
          {
            commit: match[2],
            index,
            usesIndent: match[1].length,
            version: match[3],
          },
        ]
      : []
  })
  assert.equal(
    matches.length,
    expectedCount,
    `${repository} must appear exactly ${expectedCount} time(s)`
  )
  return matches.map((match) => {
    const stepIndent = match.usesIndent - 2
    const endIndex = lines.findIndex(
      (line, index) =>
        index > match.index &&
        line.trim().startsWith("- ") &&
        leadingWidth(line) === stepIndent
    )
    return {
      ...match,
      block: lines.slice(
        match.index,
        endIndex === -1 ? lines.length : endIndex
      ),
    }
  })
}

const readStepScalar = (block, key) => {
  const pattern = new RegExp(`^\\s+${escapeRegExp(key)}:\\s+(\\S+)\\s*$`, "u")
  const values = block.flatMap((line) => {
    const match = line.match(pattern)
    return match ? [match[1]] : []
  })
  assert.equal(values.length, 1, `${key} must appear exactly once in its step`)
  return values[0]
}

const readEndpointBlock = (block) => {
  const keyIndexes = block.flatMap((line, index) =>
    /^\s+allowed-endpoints:\s+>-\s*$/u.test(line) ? [index] : []
  )
  assert.equal(
    keyIndexes.length,
    1,
    "allowed-endpoints must use one folded block"
  )
  const keyIndex = keyIndexes[0]
  const keyIndent = leadingWidth(block[keyIndex])
  const endpoints = []
  for (const line of block.slice(keyIndex + 1)) {
    if (!line.trim()) continue
    if (leadingWidth(line) <= keyIndent) break
    endpoints.push(line.trim())
  }
  return endpoints
}

const assertAction = (actual, expected) => {
  assert.equal(actual.commit, expected.commit)
  assert.equal(actual.version, expected.version)
}

export const validateCiRuntimeManifest = (manifest) => {
  assert.deepEqual(manifest.hardenRunner, reviewedActions.hardenRunner)
  assert.deepEqual(
    manifest.shaiHuludDetector,
    reviewedActions.shaiHuludDetector
  )
  assert.equal(manifest.trivyDatabaseRepository, trivyDatabaseRepository)
  assert.ok(
    Array.isArray(manifest.observedRuns) && manifest.observedRuns.length === 5
  )
  assert.equal(new Set(manifest.observedRuns).size, 5)
  manifest.observedRuns.forEach((runId) =>
    assert.ok(Number.isSafeInteger(runId) && runId > 0)
  )
  assert.ok(
    Array.isArray(manifest.workflows) && manifest.workflows.length === 6
  )

  const expectedSecurityJobCounts = new Map([
    [".github/workflows/root.yml", 1],
    [".github/workflows/backend.yml", 1],
    [".github/workflows/storefront.yml", 1],
    [".github/workflows/runtime-images.yml", 2],
    [".github/workflows/staging-operations-monitor.yml", 1],
    [".github/workflows/staging-scheduler-monitor.yml", 1],
  ])
  const paths = manifest.workflows.map((workflow) => {
    assert.equal(typeof workflow.path, "string")
    assert.match(workflow.profile, /^(?:ci-security|staging-monitor)$/u)
    assert.equal(
      workflow.securityJobCount,
      expectedSecurityJobCounts.get(workflow.path)
    )
    assert.ok(!isAbsolute(workflow.path))
    const absolutePath = resolve(root, workflow.path)
    const canonicalRelative = relative(root, realpathSync(absolutePath))
    assert.ok(
      canonicalRelative &&
        canonicalRelative !== ".." &&
        !canonicalRelative.startsWith(`..${sep}`) &&
        !isAbsolute(canonicalRelative)
    )
    assert.ok(
      Array.isArray(workflow.allowedEndpoints) &&
        workflow.allowedEndpoints.length > 0
    )
    assert.equal(
      new Set(workflow.allowedEndpoints).size,
      workflow.allowedEndpoints.length
    )
    workflow.allowedEndpoints.forEach((endpoint) => {
      assert.match(endpoint, /^(?:\*\.)?[a-z0-9][a-z0-9.-]*:443$/u)
      assert.equal(forbiddenEndpoints.has(endpoint), false)
    })
    assert.deepEqual(
      workflow.allowedEndpoints,
      [...workflow.allowedEndpoints].sort()
    )
    return workflow.path
  })
  assert.deepEqual(paths, [
    ".github/workflows/root.yml",
    ".github/workflows/backend.yml",
    ".github/workflows/storefront.yml",
    ".github/workflows/runtime-images.yml",
    ".github/workflows/staging-operations-monitor.yml",
    ".github/workflows/staging-scheduler-monitor.yml",
  ])
}

export const validateWorkflowRuntimeSecurity = (
  source,
  expectedEndpoints,
  profile = "ci-security",
  securityJobCount = 1
) => {
  assert.doesNotMatch(source, /egress-policy:\s+audit/u)
  const hardenRunners = extractActionSteps(
    source,
    reviewedActions.hardenRunner.repository,
    securityJobCount
  )
  hardenRunners.forEach((hardenRunner, index) => {
    assertAction(hardenRunner, reviewedActions.hardenRunner)
    assert.equal(readStepScalar(hardenRunner.block, "egress-policy"), "block")
    assert.deepEqual(readEndpointBlock(hardenRunner.block), expectedEndpoints)

    const nextHardenRunnerIndex =
      hardenRunners[index + 1]?.index ?? Number.POSITIVE_INFINITY
    const checkoutLineIndex = source
      .split(/\r?\n/u)
      .findIndex(
        (line, lineIndex) =>
          lineIndex > hardenRunner.index &&
          lineIndex < nextHardenRunnerIndex &&
          line.includes("uses: actions/checkout@")
      )
    assert.ok(
      checkoutLineIndex > hardenRunner.index,
      "Harden-Runner must execute before each security job checkout"
    )
  })

  if (profile === "ci-security") {
    const shaiHuludSteps = extractActionSteps(
      source,
      reviewedActions.shaiHuludDetector.repository,
      securityJobCount
    )
    shaiHuludSteps.forEach((shaiHulud) => {
      assertAction(shaiHulud, reviewedActions.shaiHuludDetector)
      assert.equal(readStepScalar(shaiHulud.block, "fail-on-critical"), "true")
      assert.equal(readStepScalar(shaiHulud.block, "scan-lockfiles"), "true")
      assert.equal(
        readStepScalar(shaiHulud.block, "scan-node-modules"),
        "false"
      )
    })
    assert.equal(
      source.match(/run:\s+pnpm run qa:ci-runtime-security/gu)?.length,
      securityJobCount
    )
    return
  }

  assert.equal(profile, "staging-monitor")
  assert.doesNotMatch(source, /gensecaihq\/Shai-Hulud-2\.0-Detector@/u)
}

export const verifyCiRuntimeSecurityPolicy = () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  validateCiRuntimeManifest(manifest)
  for (const workflow of manifest.workflows) {
    validateWorkflowRuntimeSecurity(
      readFileSync(join(root, workflow.path), "utf8"),
      workflow.allowedEndpoints,
      workflow.profile,
      workflow.securityJobCount
    )
  }

  const workflowDirectory = join(root, ".github", "workflows")
  const hardenedWorkflowPaths = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/u.test(name))
    .flatMap((name) => {
      const path = `.github/workflows/${name}`
      const source = readFileSync(join(root, path), "utf8")
      assert.doesNotMatch(source, /egress-policy:\s+audit/u)
      return source.includes(`${reviewedActions.hardenRunner.repository}@`)
        ? [path]
        : []
    })
    .sort()
  assert.deepEqual(
    hardenedWorkflowPaths,
    manifest.workflows.map((workflow) => workflow.path).sort()
  )

  const rootWorkflow = readFileSync(
    join(root, ".github/workflows/root.yml"),
    "utf8"
  )
  assert.equal(
    rootWorkflow.match(
      new RegExp(`TRIVY_DB_REPOSITORY:\\s+${trivyDatabaseRepository}`, "gu")
    )?.length,
    1
  )

  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8")
  )
  assert.equal(
    packageJson.scripts?.["qa:ci-runtime-security"],
    "node --test scripts/verify-ci-runtime-security-policy.test.mjs && node scripts/verify-ci-runtime-security-policy.mjs"
  )
  assert.match(
    packageJson.scripts?.["qa:lint"] ?? "",
    /pnpm run qa:ci-runtime-security/u
  )

  const hardenedJobCount = manifest.workflows.reduce(
    (total, workflow) => total + workflow.securityJobCount,
    0
  )
  console.info(
    `CI runtime security verified: ${hardenedJobCount} blocked-egress jobs across ${manifest.workflows.length} workflows, two exact Node 24 action identities, and one fixed Trivy database source.`
  )
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (executedPath === fileURLToPath(import.meta.url)) {
  verifyCiRuntimeSecurityPolicy()
}
