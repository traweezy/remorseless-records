import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  CLIENT_ENVIRONMENT_ID,
  CLIENT_PROJECT_ID,
  evaluateDormant,
  QUERY,
} from "./lib/client-staging-dormant.mjs"

const require = createRequire(import.meta.url)
const USAGE =
  "Usage: node scripts/client-staging-dormant-preflight.mjs [--help]"
const MAX_RESPONSE_BYTES = 512 * 1024
const SAFE_ERRORS = new Set([
  USAGE,
  "Railway metadata query failed; check authentication and access",
  "Railway metadata response was invalid",
  "Railway metadata response was incomplete",
])

const railwayExecutable = () =>
  join(
    dirname(require.resolve("@railway/cli/package.json")),
    "bin",
    process.platform === "win32" ? "railway.exe" : "railway"
  )

export const parseArguments = (args) => {
  if (args.length === 0) return { help: false }
  if (args.length === 1 && args[0] === "--help") return { help: true }
  throw new Error(USAGE)
}

export const queryRailway = (
  spawn = spawnSync,
  executable = railwayExecutable()
) => {
  const result = spawn(
    executable,
    [
      "api",
      QUERY,
      "--raw-var",
      `projectId=${CLIENT_PROJECT_ID}`,
      "--raw-var",
      `environmentId=${CLIENT_ENVIRONMENT_ID}`,
      "--compact",
    ],
    {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: MAX_RESPONSE_BYTES,
      env: { ...process.env, _: executable },
    }
  )
  if (result.error || result.status !== 0) {
    throw new Error(
      "Railway metadata query failed; check authentication and access"
    )
  }
  let response
  try {
    response = JSON.parse(result.stdout)
  } catch {
    throw new Error("Railway metadata response was invalid")
  }
  if (!response?.data || response.errors) {
    throw new Error("Railway metadata response was incomplete")
  }
  return response
}

export const runDormant = (args, { query = queryRailway } = {}) => {
  const { help } = parseArguments(args)
  if (help) return { help: true, passed: true, problems: [] }
  return evaluateDormant(query())
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = runDormant(process.argv.slice(2))
    if (result.help) {
      process.stdout.write(`${USAGE}\n`)
    } else if (result.passed) {
      process.stdout.write(
        "Client staging dormant check: PASS (read-only Railway metadata; no activation performed)\n"
      )
    } else {
      process.stderr.write("Client staging dormant check: FAIL\n")
      for (const problem of result.problems) {
        process.stderr.write(`- ${problem}\n`)
      }
      process.exitCode = 1
    }
  } catch (error) {
    const message =
      error instanceof Error && SAFE_ERRORS.has(error.message)
        ? error.message
        : "Client staging dormant check could not complete"
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
