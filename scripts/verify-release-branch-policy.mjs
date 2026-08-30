import assert from "node:assert/strict"
import fs from "node:fs"

const workflowPaths = [
  ".github/workflows/root.yml",
  ".github/workflows/backend.yml",
  ".github/workflows/storefront.yml",
]
const expectedBranches = "branches: [staging, master]"

for (const workflowPath of workflowPaths) {
  const source = fs.readFileSync(workflowPath, "utf8")
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

const storefrontWorkflow = fs.readFileSync(
  ".github/workflows/storefront.yml",
  "utf8"
)
const masterReleaseGateCount = storefrontWorkflow.match(
  /github\.base_ref == 'master'/gu
)?.length

assert.equal(
  masterReleaseGateCount,
  4,
  "Storefront master pull requests must run build, browser, accessibility, and Lighthouse gates"
)

console.log(
  "Release branch policy verified: staging integration, master promotion, manual production."
)
