import assert from "node:assert/strict";
import { lstat, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const medusaOutput = join(backendRoot, ".medusa");
const requiredArtifacts = [
  join(medusaOutput, "server", "package.json"),
  join(medusaOutput, "server", "medusa-config.js"),
  join(medusaOutput, "server", "src", "api", "middlewares.js"),
];

assert.equal(dirname(medusaOutput), backendRoot);
await rm(medusaOutput, { force: true, maxRetries: 2, recursive: true });

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  assert.equal(
    result.signal,
    null,
    `${command} ${args.join(" ")} terminated with ${result.signal}`,
  );
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} exited with ${result.status}`,
  );
};

run("pnpm", ["exec", "medusa", "build"]);

for (const artifactPath of requiredArtifacts) {
  const artifact = await lstat(artifactPath);
  assert.equal(
    artifact.isSymbolicLink(),
    false,
    `${artifactPath} is a symlink`,
  );
  assert.equal(artifact.isFile(), true, `${artifactPath} is not a file`);
  assert.ok(artifact.size > 0, `${artifactPath} is empty`);
}

run(process.execPath, ["src/scripts/postBuild.js"]);
