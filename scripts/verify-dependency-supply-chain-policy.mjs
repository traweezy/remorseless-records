import assert from "node:assert/strict"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const policyPath = join(
  root,
  "scripts",
  "security",
  "dependency-supply-chain-policy.json"
)
const expectedAuditIgnores = [
  "GHSA-337j-9hxr-rhxg",
  "GHSA-jjmj-jmhj-qwj2",
  "GHSA-wrjc-x8rr-h8h6",
]

const parseYamlScalar = (source) => {
  const value = source.trim()
  if (value === "true") return true
  if (value === "false") return false
  if (/^\d+$/u.test(value)) return Number(value)
  if (value.startsWith('"') || value.startsWith("'")) {
    if (value.startsWith("'")) return value.slice(1, -1)
    return JSON.parse(value)
  }
  return value
}

export const readTopLevelScalar = (source, key) => {
  const prefix = `${key}:`
  const lines = source
    .split(/\r?\n/u)
    .filter((candidate) => candidate.startsWith(prefix))
  assert.ok(lines.length <= 1, `${key} must not be duplicated`)
  return lines[0] ? parseYamlScalar(lines[0].slice(prefix.length)) : undefined
}

export const readYamlList = (source, key) => {
  const lines = source.split(/\r?\n/u)
  const matchingIndexes = lines.flatMap((line, index) =>
    line.trim().startsWith(`${key}:`) ? [index] : []
  )
  assert.ok(matchingIndexes.length <= 1, `${key} must not be duplicated`)
  const keyIndex = matchingIndexes[0]
  if (keyIndex === undefined) return []
  assert.equal(
    lines[keyIndex].trim(),
    `${key}:`,
    `${key} must use a block list`
  )

  const keyIndent = lines[keyIndex].match(/^\s*/u)?.[0].length ?? 0
  const values = []
  for (const line of lines.slice(keyIndex + 1)) {
    if (!line.trim()) continue
    const indent = line.match(/^\s*/u)?.[0].length ?? 0
    if (indent <= keyIndent) break
    const item = line.match(/^\s*-\s+(.+)$/u)
    if (item?.[1]) values.push(parseYamlScalar(item[1]))
  }
  return values
}

const exactVersionSelector =
  /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

const assertEvidencePaths = (entries) => {
  for (const entry of entries) {
    assert.ok(Array.isArray(entry.evidence) && entry.evidence.length > 0)
    assert.equal(new Set(entry.evidence).size, entry.evidence.length)
    for (const evidencePath of entry.evidence) {
      assert.equal(typeof evidencePath, "string")
      assert.ok(evidencePath.length > 0)
      assert.equal(isAbsolute(evidencePath), false)
      const normalized = normalize(evidencePath)
      assert.ok(normalized !== ".." && !normalized.startsWith(`..${sep}`))
    }
  }
}

export const validatePolicyManifest = (policy) => {
  assert.ok(policy && typeof policy === "object" && !Array.isArray(policy))
  assert.equal(policy.coolingWindowMinutes, 10_080)
  assert.ok(Array.isArray(policy.coolingWindowExceptions))
  assert.ok(policy.coolingWindowExceptions.length <= 3)
  assertEvidencePaths(policy.coolingWindowExceptions)

  const selectors = policy.coolingWindowExceptions.map((entry) => {
    assert.equal(typeof entry.selector, "string")
    assert.match(entry.selector, exactVersionSelector)
    assert.equal(typeof entry.reason, "string")
    assert.ok(entry.reason.length >= 80)
    assert.equal(typeof entry.publishedAt, "string")
    assert.equal(new Date(entry.publishedAt).toISOString(), entry.publishedAt)
    return entry.selector
  })
  assert.equal(new Set(selectors).size, selectors.length)

  assert.ok(Array.isArray(policy.auditIgnores))
  assertEvidencePaths(policy.auditIgnores)
  const auditIds = policy.auditIgnores.map((entry) => {
    assert.equal(typeof entry.id, "string")
    assert.match(entry.id, /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/u)
    assert.equal(typeof entry.reason, "string")
    assert.ok(entry.reason.length >= 80)
    assert.ok(
      Array.isArray(entry.affectedPackages) && entry.affectedPackages.length > 0
    )
    assert.equal(
      new Set(entry.affectedPackages).size,
      entry.affectedPackages.length
    )
    entry.affectedPackages.forEach((selector) =>
      assert.match(selector, exactVersionSelector)
    )
    return entry.id
  })
  assert.deepEqual(auditIds.sort(), [...expectedAuditIgnores].sort())

  return { auditIds, selectors }
}

export const validateWorkspacePolicy = (source, expectedExceptions, label) => {
  assert.equal(
    readTopLevelScalar(source, "minimumReleaseAge"),
    10_080,
    `${label} must enforce a one-week dependency cooling window`
  )
  assert.equal(
    readTopLevelScalar(source, "minimumReleaseAgeStrict"),
    true,
    `${label} must fail when no mature version satisfies a range`
  )
  assert.equal(
    readTopLevelScalar(source, "minimumReleaseAgeIgnoreMissingTime"),
    false,
    `${label} must fail when registry publish time is unavailable`
  )
  assert.equal(
    readTopLevelScalar(source, "trustLockfile"),
    false,
    `${label} must verify the lockfile against supply-chain policy`
  )
  assert.equal(
    readTopLevelScalar(source, "blockExoticSubdeps"),
    true,
    `${label} must reject exotic transitive dependency sources`
  )
  assert.deepEqual(
    readYamlList(source, "minimumReleaseAgeExclude"),
    expectedExceptions,
    `${label} cooling exceptions must match the reviewed manifest`
  )
}

const assertRegularEvidence = (evidencePath) => {
  const absolutePath = resolve(root, evidencePath)
  const relativePath = relative(root, absolutePath)
  assert.ok(
    relativePath &&
      !relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath)
  )
  const canonicalRelativePath = relative(
    realpathSync(root),
    realpathSync(absolutePath)
  )
  assert.ok(
    canonicalRelativePath &&
      !canonicalRelativePath.startsWith(`..${sep}`) &&
      canonicalRelativePath !== ".." &&
      !isAbsolute(canonicalRelativePath)
  )
  const status = lstatSync(absolutePath)
  assert.ok(status.isFile() && !status.isSymbolicLink())
}

export const verifyDependencySupplyChainPolicy = () => {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"))
  const { auditIds, selectors } = validatePolicyManifest(policy)

  const rootWorkspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")
  const backendWorkspace = readFileSync(
    join(root, "backend", "pnpm-workspace.yaml"),
    "utf8"
  )
  const storefrontWorkspace = readFileSync(
    join(root, "storefront", "pnpm-workspace.yaml"),
    "utf8"
  )
  validateWorkspacePolicy(rootWorkspace, selectors, "root workspace")
  validateWorkspacePolicy(backendWorkspace, [], "Backend workspace")
  validateWorkspacePolicy(storefrontWorkspace, [], "Storefront workspace")
  assert.deepEqual(
    readYamlList(rootWorkspace, "ignoreGhsas").sort(),
    [...auditIds].sort()
  )
  assert.deepEqual(
    readYamlList(backendWorkspace, "ignoreGhsas").sort(),
    [...auditIds].sort()
  )

  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8")
  )
  assert.equal(packageJson.devDependencies?.["@railway/cli"], "5.45.0")
  assert.match(
    packageJson.scripts?.["qa:lint"] ?? "",
    /pnpm run qa:dependency-supply-chain/u
  )
  assert.equal(
    packageJson.scripts?.["qa:dependency-supply-chain"],
    "node --test scripts/verify-dependency-supply-chain-policy.test.mjs && node scripts/verify-dependency-supply-chain-policy.mjs"
  )

  for (const entry of [
    ...policy.coolingWindowExceptions,
    ...policy.auditIgnores,
  ]) {
    entry.evidence.forEach(assertRegularEvidence)
  }

  const workflowPaths = [
    ".github/workflows/root.yml",
    ".github/workflows/backend.yml",
    ".github/workflows/storefront.yml",
  ]
  for (const workflowPath of workflowPaths) {
    const workflow = readFileSync(join(root, workflowPath), "utf8")
    assert.match(workflow, /pnpm run qa:dependency-supply-chain/u)
    assert.match(workflow, /pnpm run qa:react-router-security/u)
  }

  const postBuild = readFileSync(
    join(root, "backend/src/scripts/postBuild.js"),
    "utf8"
  )
  const postBuildConfiguration = readFileSync(
    join(root, "backend/src/scripts/post-build-configuration.js"),
    "utf8"
  )
  for (const setting of [
    "minimumReleaseAge",
    "minimumReleaseAgeStrict",
    "minimumReleaseAgeIgnoreMissingTime",
    "trustLockfile",
    "blockExoticSubdeps",
  ]) {
    assert.ok(postBuild.includes(`"${setting}"`))
    assert.ok(postBuildConfiguration.includes(`${setting}:`))
  }

  console.info(
    `Dependency supply-chain policy verified: one-week strict cooling, ${selectors.length} exact release exception, and ${auditIds.length} behaviorally patched audit ignores.`
  )
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (executedPath === fileURLToPath(import.meta.url)) {
  verifyDependencySupplyChainPolicy()
}
