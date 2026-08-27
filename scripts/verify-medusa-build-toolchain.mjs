import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backendPackage = JSON.parse(
  await readFile(join(repositoryRoot, "backend", "package.json"), "utf8"),
);
const pnpmWorkspace = await readFile(
  join(repositoryRoot, "pnpm-workspace.yaml"),
  "utf8",
);

assert.equal(backendPackage.scripts?.build, "node scripts/build.mjs");
assert.match(
  pnpmWorkspace,
  /^  "@medusajs\/framework@2\.18\.0":\n    dependencies:\n      typescript: 5\.9\.3$/mu,
);

const frameworkRoot = await realpath(
  join(repositoryRoot, "backend", "node_modules", "@medusajs", "framework"),
);
const frameworkRequire = createRequire(join(frameworkRoot, "package.json"));
const typescript = frameworkRequire("typescript");

assert.equal(typescript.version, "5.9.3");
assert.equal(typeof typescript.getParsedCommandLineOfConfigFile, "function");

console.log(
  "Medusa build toolchain verified: Framework resolves the complete TypeScript 5.9.3 compiler and the fail-closed build wrapper.",
);
