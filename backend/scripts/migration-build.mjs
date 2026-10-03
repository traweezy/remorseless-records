import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { migrationJobEnvironment } from "./migration-job.mjs"

export const migrationBuildEnvironment = (environment) =>
  migrationJobEnvironment({
    ...environment,
    // Compilation loads Medusa configuration but must not use a live database.
    DATABASE_URL: "postgresql://migration_build:unused@127.0.0.1:1/build",
  })

export const runMigrationBuild = ({
  environment = process.env,
  run = spawnSync,
} = {}) => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const result = run(process.execPath, [join(root, "scripts/build.mjs")], {
    cwd: root,
    env: migrationBuildEnvironment(environment),
    shell: false,
    stdio: "inherit",
    timeout: 600_000,
    killSignal: "SIGKILL",
  })
  assert.ok(!result.error && !result.signal && result.status === 0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2)
    runMigrationBuild()
  } catch {
    process.stderr.write("[migration-build] status=failed\n")
    process.exitCode = 1
  }
}
