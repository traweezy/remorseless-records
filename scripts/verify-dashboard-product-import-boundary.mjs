import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const backendRequire = createRequire(
  join(repositoryRoot, "backend", "package.json")
)
const dashboardPackagePath = backendRequire.resolve(
  "@medusajs/dashboard/package.json"
)
const dashboardRoot = dirname(dashboardPackagePath)
const distRoot = join(dashboardRoot, "dist")

const readDashboardFile = (relativePath) =>
  readFile(join(dashboardRoot, relativePath), "utf8")

const [
  dashboardPackageSource,
  pnpmWorkspace,
  standardProductListSource,
  configurableProductListSource,
  routeMapSource,
  commonJsBundle,
  distEntries,
] = await Promise.all([
  readFile(dashboardPackagePath, "utf8"),
  readFile(join(repositoryRoot, "pnpm-workspace.yaml"), "utf8"),
  readDashboardFile(
    "src/routes/products/product-list/components/product-list-table/product-list-table.tsx"
  ),
  readDashboardFile(
    "src/routes/products/product-list/components/product-list-table/configurable-product-list-table.tsx"
  ),
  readDashboardFile("src/dashboard-app/routes/get-route.map.tsx"),
  readDashboardFile("dist/app.js"),
  readdir(distRoot),
])

const dashboardPackage = JSON.parse(dashboardPackageSource)
assert.equal(dashboardPackage.version, "2.18.0")
assert.match(
  pnpmWorkspace,
  /^\s+["']?@medusajs\/dashboard@2\.18\.0["']?: patches\/@medusajs__dashboard@2\.18\.0\.patch$/mu
)

const importLinkPattern =
  /to(?:=|:)\s*\{?`import\$\{location\.search\}`\}?[^\n]*actions\.import/u
const importRoutePattern = /path:\s*"import",\s*lazy:[^}]+product-import/su

assert.match(standardProductListSource, /actions\.export/u)
assert.match(standardProductListSource, /to="create"/u)
assert.doesNotMatch(standardProductListSource, importLinkPattern)

assert.match(configurableProductListSource, /actions\.export/u)
assert.match(configurableProductListSource, /to:\s*"create"/u)
assert.doesNotMatch(configurableProductListSource, importLinkPattern)

assert.match(routeMapSource, /path:\s*"export"/u)
assert.doesNotMatch(routeMapSource, importRoutePattern)

const moduleBundleSources = await Promise.all(
  distEntries
    .filter((entry) => entry.endsWith(".mjs"))
    .map(async (entry) => ({
      entry,
      source: await readFile(join(distRoot, entry), "utf8"),
    }))
)

const findUniqueBundle = (marker) => {
  const matches = moduleBundleSources.filter(({ source }) =>
    source.includes(marker)
  )

  assert.equal(
    matches.length,
    1,
    `Expected one Dashboard module bundle containing ${marker}, found ${matches.length}`
  )
  return matches[0].source
}

const productListBundle = findUniqueBundle(
  "src/routes/products/product-list/components/product-list-table/product-list-table.tsx"
)
const routeMapBundle = findUniqueBundle(
  "src/dashboard-app/routes/get-route.map.tsx"
)

for (const productListArtifact of [productListBundle, commonJsBundle]) {
  assert.match(productListArtifact, /actions\.export/u)
  assert.match(productListArtifact, /to:\s*"create"/u)
  assert.doesNotMatch(productListArtifact, importLinkPattern)
}

for (const routeMapArtifact of [routeMapBundle, commonJsBundle]) {
  assert.match(routeMapArtifact, /path:\s*"export"/u)
  assert.doesNotMatch(routeMapArtifact, importRoutePattern)
}

console.log(
  "Medusa Dashboard product import boundary verified: unsupported links and route are absent from source and production bundles."
)
