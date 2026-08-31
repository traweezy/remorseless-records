import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const readRepositoryFile = (relativePath) =>
  readFile(join(repositoryRoot, relativePath), "utf8")

const [
  packageSource,
  acceptanceSource,
  matrixSource,
  permissionBoundarySource,
  formContractSource,
  newsRouteSource,
  discographyRouteSource,
  mediaCleanupRouteSource,
  uiPatchSource,
  dashboardPatchSource,
  dialogPatchSource,
  popoverPatchSource,
  selectPatchSource,
] = await Promise.all([
  readRepositoryFile("package.json"),
  readRepositoryFile("qa/admin-visual-acceptance.mjs"),
  readRepositoryFile("qa/run-admin-accessibility-matrix.mjs"),
  readRepositoryFile(
    "backend/src/admin/components/admin-permission-boundary.tsx"
  ),
  readRepositoryFile("backend/src/admin/components/admin-form-contract.tsx"),
  readRepositoryFile("backend/src/admin/routes/news/page.tsx"),
  readRepositoryFile("backend/src/admin/routes/discography/page.tsx"),
  readRepositoryFile("backend/src/admin/routes/media-cleanup/page.tsx"),
  readRepositoryFile("patches/@medusajs__ui@4.2.0.patch"),
  readRepositoryFile("patches/@medusajs__dashboard@2.18.0.patch"),
  readRepositoryFile("patches/@radix-ui__react-dialog@1.1.5.patch"),
  readRepositoryFile("patches/@radix-ui__react-popover@1.1.5.patch"),
  readRepositoryFile("patches/@radix-ui__react-select@2.1.5.patch"),
])

const packageManifest = JSON.parse(packageSource)
assert.equal(
  packageManifest.scripts?.["qa:admin:accessibility"],
  "node qa/run-admin-accessibility-matrix.mjs"
)
assert.match(
  packageManifest.scripts?.["qa:lint"] ?? "",
  /pnpm run qa:admin-accessibility-boundary/u
)

for (const findingCode of [
  "axe_incomplete",
  "axe_violation",
  "dangling_aria_controls",
  "focus_not_visible",
  "focus_obscured",
  "horizontal_overflow",
  "reduced_motion_animation",
  "undersized_target",
  "unnamed_control",
]) {
  assert.match(acceptanceSource, new RegExp(`"${findingCode}"`, "u"))
}

for (const caseName of [
  "product-create-validation-200-percent",
  "product-create-offerings-laptop",
  "product-authoring-wide",
  "product-list-laptop",
  "merchandising-laptop",
  "merchandising-create-mobile",
  "news-create-mobile",
  "discography-create-mobile",
  "tax-control-laptop",
  "media-cleanup-mobile",
  "refund-operations-laptop",
  "tax-records-wide",
]) {
  assert.match(matrixSource, new RegExp(`name: "${caseName}"`, "u"))
}

assert.match(
  permissionBoundarySource,
  /useAdminFocusVisibility\(surface === "page"\)/u
)
assert.match(formContractSource, /headingLevel\?: "h2" \| "h3"/u)
for (const source of [
  newsRouteSource,
  discographyRouteSource,
  mediaCleanupRouteSource,
]) {
  assert.match(source, /<Tabs\.Content className="sr-only" tabIndex=\{-1\}/u)
}

assert.match(uiPatchSource, /"aria-label": rest\["aria-label"\]/u)
assert.match(uiPatchSource, /"aria-hidden": true/u)
for (const label of ["Open actions", "Sort results"]) {
  assert.ok(dashboardPatchSource.includes(`aria-label="${label}"`))
}

for (const source of [
  dialogPatchSource,
  popoverPatchSource,
  selectPatchSource,
]) {
  assert.match(
    source,
    /\+\s+"aria-controls": context\.open \? context\.contentId : void 0/u
  )
}

console.log(
  "Admin accessibility boundary verified: the full matrix, keyboard guard, semantic form contract, and patched dependency fixes remain wired."
)
