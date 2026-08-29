import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const PROJECT = {
  id: "1f39263a-25e4-4d69-abc2-f0287b331d1e",
  name: "store",
};
const STAGING_ENVIRONMENT = {
  id: "799a2f98-f819-495d-b8b6-12e71af86568",
  name: "staging",
};
const command = process.argv[2];

assert.match(
  command ?? "",
  /^(?:plan|apply)$/u,
  "Usage: node scripts/railway-config.mjs <plan|apply>",
);

const runRailway = (args, options = {}) =>
  spawnSync("pnpm", ["exec", "railway", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });

const parseJsonResult = (result, operation) => {
  assert.equal(
    result.status,
    0,
    `Railway ${operation} failed before the deployment contract was evaluated`,
  );

  try {
    return JSON.parse(result.stdout);
  } catch {
    assert.fail(`Railway ${operation} returned invalid JSON`);
  }
};

const status = parseJsonResult(
  runRailway(["status", "--json"]),
  "project identity check",
);

assert.deepEqual(
  { id: status.id, name: status.name },
  PROJECT,
  "Refusing to manage an unexpected Railway project",
);

const environmentList = parseJsonResult(
  runRailway(["environment", "list", "--json"]),
  "environment identity check",
);
const linkedEnvironments = environmentList.environments.filter(
  ({ isLinked }) => isLinked,
);

assert.deepEqual(
  linkedEnvironments.map(({ id, name }) => ({ id, name })),
  [STAGING_ENVIRONMENT],
  "Refusing to manage a Railway environment other than staging",
);

const configArgs = ["config", command, "--verbose"];

if (command === "apply") {
  configArgs.push("--yes", "--confirm-destructive");
}

const result = runRailway(configArgs, {
  env: {
    ...process.env,
    RAILWAY_IAC_TARGET_ENVIRONMENT: STAGING_ENVIRONMENT.name,
  },
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
