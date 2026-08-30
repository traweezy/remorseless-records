import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const backendRequire = createRequire(
  join(repositoryRoot, "backend", "package.json"),
)
const dashboardRoot = dirname(
  backendRequire.resolve("@medusajs/dashboard/package.json"),
)
const distRoot = join(dashboardRoot, "dist")
const readDashboardFile = (relativePath) =>
  readFile(join(dashboardRoot, relativePath), "utf8")

const [
  routeMapSource,
  layoutComposerSource,
  dashboardAppSource,
  commonJsBundle,
  distEntries,
  customRoute,
  legacyRoute,
] = await Promise.all([
    readDashboardFile("src/dashboard-app/routes/get-route.map.tsx"),
    readDashboardFile("src/components/layout-composer/layout-composer.tsx"),
    readDashboardFile("src/dashboard-app/dashboard-app.tsx"),
    readDashboardFile("dist/app.js"),
    readdir(distRoot),
    readFile(
      join(repositoryRoot, "backend/src/admin/routes/products/create/page.tsx"),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "backend/src/admin/routes/catalog/new/page.tsx"),
      "utf8",
    ),
  ])

const nativeCreateRoutePattern =
  /path:\s*"create",\s*lazy:[^}]+(?:routes\/products\/product-create|product-create-)/su
const widgetPlacementPattern =
  /const placement = zoneSuffix\.endsWith\("before"\) \? "before" : "after"/u
const naturalOrderPattern =
  /\.\.\.beforeWidgets,\s*\.\.\.buildCoreEntries\(coreElementsBySection\),\s*\.\.\.afterWidgets/su

assert.doesNotMatch(routeMapSource, nativeCreateRoutePattern)
assert.doesNotMatch(commonJsBundle, nativeCreateRoutePattern)
assert.match(dashboardAppSource, widgetPlacementPattern)
assert.match(layoutComposerSource, naturalOrderPattern)
assert.match(commonJsBundle, widgetPlacementPattern)
assert.match(commonJsBundle, naturalOrderPattern)

const moduleBundleSources = await Promise.all(
  distEntries
    .filter((entry) => entry.endsWith(".mjs"))
    .map((entry) => readFile(join(distRoot, entry), "utf8")),
)
const routeMapBundles = moduleBundleSources.filter((source) =>
  source.includes("src/dashboard-app/routes/get-route.map.tsx"),
)
assert.equal(routeMapBundles.length, 1)
assert.doesNotMatch(routeMapBundles[0], nativeCreateRoutePattern)
const moduleBundleSource = moduleBundleSources.join("\n")
assert.match(moduleBundleSource, widgetPlacementPattern)
assert.match(moduleBundleSource, naturalOrderPattern)

assert.match(customRoute, /CatalogProductCreatePage/u)
assert.match(customRoute, /catalogAdminActions\.authoring\.create/u)
assert.match(legacyRoute, /<Navigate replace to="\/products\/create"/u)

console.log(
  "Medusa Dashboard catalog boundary verified: the guided workflow owns /products/create and widget placement intent is preserved in source and production bundles.",
)
