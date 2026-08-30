import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { buildReleasePreparePlan } from "./lib/release-prepare.mjs"

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const plan = buildReleasePreparePlan({
  environment: process.env,
  nodePath: process.execPath,
})

for (const step of plan) {
  process.stdout.write(`[release] Starting ${step.label}.\n`)
  const result = spawnSync(step.command, step.args, {
    cwd: backendRoot,
    env: step.environment,
    stdio: "inherit",
  })
  if (result.error) {
    throw result.error
  }
  assert.equal(result.signal, null, `${step.label} terminated unexpectedly.`)
  assert.equal(result.status, 0, `${step.label} failed.`)
  process.stdout.write(`[release] Completed ${step.label}.\n`)
}
