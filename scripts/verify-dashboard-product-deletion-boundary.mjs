import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backendRequire = createRequire(
  join(repositoryRoot, "backend", "package.json"),
);
const dashboardPackagePath = backendRequire.resolve(
  "@medusajs/dashboard/package.json",
);
const dashboardRoot = dirname(dashboardPackagePath);
const distRoot = join(dashboardRoot, "dist");

const dashboardSourcePaths = {
  productList:
    "src/routes/products/product-list/components/product-list-table/product-list-table-actions.tsx",
  productGeneral:
    "src/routes/products/product-detail/components/product-general-section/product-general-section.tsx",
  productVariants:
    "src/routes/products/product-detail/components/product-variant-section/product-variant-section.tsx",
  variantGeneral:
    "src/routes/product-variants/product-variant-detail/components/variant-general-section/variant-general-section.tsx",
};

const readDashboardFile = (relativePath) =>
  readFile(join(dashboardRoot, relativePath), "utf8");

const [
  dashboardPackageSource,
  pnpmWorkspace,
  dashboardPatch,
  productListSource,
  productGeneralSource,
  productVariantsSource,
  variantGeneralSource,
  commonJsBundle,
  distEntries,
] = await Promise.all([
  readFile(dashboardPackagePath, "utf8"),
  readFile(join(repositoryRoot, "pnpm-workspace.yaml"), "utf8"),
  readFile(
    join(repositoryRoot, "patches", "@medusajs__dashboard@2.18.0.patch"),
    "utf8",
  ),
  readDashboardFile(dashboardSourcePaths.productList),
  readDashboardFile(dashboardSourcePaths.productGeneral),
  readDashboardFile(dashboardSourcePaths.productVariants),
  readDashboardFile(dashboardSourcePaths.variantGeneral),
  readDashboardFile("dist/app.js"),
  readdir(distRoot),
]);

const dashboardPackage = JSON.parse(dashboardPackageSource);
assert.equal(dashboardPackage.version, "2.18.0");
assert.match(
  pnpmWorkspace,
  /^\s+["']?@medusajs\/dashboard@2\.18\.0["']?: patches\/@medusajs__dashboard@2\.18\.0\.patch$/mu,
);

for (const sourcePath of Object.values(dashboardSourcePaths)) {
  assert.match(
    dashboardPatch,
    new RegExp(`diff --git a/${sourcePath} b/${sourcePath}`, "u"),
  );
}

const assertSafeActionSection = (source, forbiddenPatterns) => {
  assert.match(source, /PencilSquare/u);
  assert.match(source, /actions\.edit/u);

  for (const forbiddenPattern of forbiddenPatterns) {
    assert.doesNotMatch(source, forbiddenPattern);
  }
};

assertSafeActionSection(productListSource, [
  /useDeleteProduct/u,
  /products\.deleteWarning/u,
  /actions\.delete/u,
]);
assertSafeActionSection(productGeneralSource, [
  /useDeleteProduct/u,
  /products\.deleteWarning/u,
  /actions\.delete/u,
]);
assertSafeActionSection(productVariantsSource, [
  /useDeleteVariantLazy/u,
  /products\.deleteVariantWarning/u,
  /actions\.delete/u,
  /secondaryActions/u,
]);
assertSafeActionSection(variantGeneralSource, [
  /useDeleteVariant/u,
  /products\.variant\.deleteWarning/u,
  /actions\.delete/u,
]);

const moduleBundleSources = await Promise.all(
  distEntries
    .filter((entry) => entry.endsWith(".mjs"))
    .map(async (entry) => ({
      entry,
      source: await readFile(join(distRoot, entry), "utf8"),
    })),
);

const findUniqueBundle = (marker) => {
  const matches = moduleBundleSources.filter(({ source }) =>
    source.includes(marker),
  );

  assert.equal(
    matches.length,
    1,
    `Expected one Dashboard module bundle containing ${marker}, found ${matches.length}`,
  );
  return matches[0].source;
};

const extractSourceSection = (source, marker) => {
  const sourceComment = `// ${marker}`;
  const firstIndex = source.indexOf(sourceComment);
  assert.notEqual(firstIndex, -1, `Missing Dashboard source marker ${marker}`);
  assert.equal(
    source.indexOf(sourceComment, firstIndex + sourceComment.length),
    -1,
    `Dashboard source marker ${marker} must be unique`,
  );

  const nextSourceIndex = source.indexOf("\n// src/", firstIndex + 1);
  return source.slice(
    firstIndex,
    nextSourceIndex === -1 ? source.length : nextSourceIndex,
  );
};

const artifactSections = [
  {
    source: productListSource,
    marker: dashboardSourcePaths.productList,
    forbiddenPatterns: [
      /useDeleteProduct/u,
      /products\.deleteWarning/u,
      /actions\.delete/u,
    ],
  },
  {
    source: productGeneralSource,
    marker: dashboardSourcePaths.productGeneral,
    forbiddenPatterns: [
      /useDeleteProduct/u,
      /products\.deleteWarning/u,
      /actions\.delete/u,
    ],
  },
  {
    source: productVariantsSource,
    marker: dashboardSourcePaths.productVariants,
    forbiddenPatterns: [
      /useDeleteVariantLazy/u,
      /products\.deleteVariantWarning/u,
      /actions\.delete/u,
      /secondaryActions/u,
    ],
  },
  {
    source: variantGeneralSource,
    marker: dashboardSourcePaths.variantGeneral,
    forbiddenPatterns: [
      /useDeleteVariant/u,
      /products\.variant\.deleteWarning/u,
      /actions\.delete/u,
    ],
  },
];

for (const { marker, forbiddenPatterns } of artifactSections) {
  for (const bundleSource of [findUniqueBundle(marker), commonJsBundle]) {
    const section = extractSourceSection(bundleSource, marker);
    assertSafeActionSection(section, forbiddenPatterns);
  }
}

console.log(
  "Medusa Dashboard product deletion boundary verified: Product and Variant destructive actions are absent from source and production bundles.",
);
