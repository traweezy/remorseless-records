import assert from "node:assert/strict";
import fs from "node:fs";

const [sbomPath, licensesPath] = process.argv.slice(2);

assert.ok(sbomPath, "Provide the CycloneDX SBOM path");
assert.ok(licensesPath, "Provide the production license inventory path");

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

const sbom = readJson(sbomPath);
assert.equal(sbom.bomFormat, "CycloneDX");
assert.match(sbom.specVersion, /^1\.[4-9]$/);
assert.ok(Array.isArray(sbom.components) && sbom.components.length > 0);
assert.ok(Array.isArray(sbom.dependencies) && sbom.dependencies.length > 0);

const licenses = readJson(licensesPath);
assert.ok(licenses && typeof licenses === "object" && !Array.isArray(licenses));

const entries = Object.values(licenses).flat();
assert.ok(entries.length > 0, "Production license inventory is empty");

for (const entry of entries) {
  assert.equal(typeof entry.name, "string");
  assert.ok(Array.isArray(entry.versions) && entry.versions.length > 0);
  assert.equal(typeof entry.license, "string");
}

const expectedMedusaUnknowns = new Set([
  "@medusajs/admin-bundler",
  "@medusajs/admin-sdk",
  "@medusajs/admin-shared",
  "@medusajs/admin-vite-plugin",
  "@medusajs/dashboard",
]);
const unknowns = licenses.Unknown ?? [];
const unexpectedUnknowns = unknowns
  .map((entry) => entry.name)
  .filter((name) => !expectedMedusaUnknowns.has(name));

assert.deepEqual(
  unexpectedUnknowns,
  [],
  `Unexpected packages without SPDX metadata: ${unexpectedUnknowns.join(", ")}`,
);

console.log(
  JSON.stringify(
    {
      bomComponents: sbom.components.length,
      bomDependencies: sbom.dependencies.length,
      licenseGroups: Object.keys(licenses).length,
      packages: entries.length,
      upstreamMitPackagesWithoutManifestMetadata: unknowns.length,
    },
    null,
    2,
  ),
);
