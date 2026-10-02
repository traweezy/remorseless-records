import process from "node:process"

import {
  parseRailwayLogJsonLines,
  verifyRailwayRuntimeLog,
} from "./lib/railway-runtime-log.mjs"

const MAX_INPUT_BYTES = 10 * 1024 * 1024
const OPTION_FIELDS = new Map([
  ["--commit-sha", "commit_sha"],
  ["--environment", "environment"],
  ["--event", "event"],
  ["--level", "level"],
  ["--problem-code", "problem_code"],
  ["--request-id", "request_id"],
  ["--service", "service"],
  ["--status", "status"],
  ["--trace-id", "trace_id"],
])

const usage =
  "Usage: railway logs --json ... | node scripts/verify-railway-runtime-log.mjs " +
  "--commit-sha SHA --environment NAME --event NAME --level LEVEL " +
  "--problem-code CODE --request-id ID --service NAME --status CODE " +
  "--trace-id ID [--profile problem|completion] (completion omits --problem-code)"

const parseArguments = (arguments_) => {
  const expectations = Object.create(null)
  let profile

  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index]
    const value = arguments_[index + 1]
    if (option === "--profile") {
      if (profile !== undefined || !["problem", "completion"].includes(value))
        throw new Error(usage)
      profile = value
      continue
    }
    const field = OPTION_FIELDS.get(option)
    if (!field || typeof value !== "string" || value.startsWith("--")) {
      throw new Error(usage)
    }
    if (Object.hasOwn(expectations, field)) {
      throw new Error(`Duplicate option: ${option}`)
    }
    expectations[field] = field === "status" ? Number(value) : value
  }

  profile ??= "problem"
  if (
    Object.keys(expectations).length !==
    OPTION_FIELDS.size - (profile === "completion" ? 1 : 0)
  ) {
    throw new Error(usage)
  }

  return { expectations, profile }
}

const readStandardInput = async () => {
  process.stdin.setEncoding("utf8")
  let input = ""
  let bytes = 0

  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk)
    if (bytes > MAX_INPUT_BYTES) {
      throw new Error("Railway log input exceeded 10 MiB")
    }
    input += chunk
  }

  return input
}

const main = async () => {
  const { expectations, profile } = parseArguments(process.argv.slice(2))
  const records = parseRailwayLogJsonLines(await readStandardInput())
  verifyRailwayRuntimeLog(records, expectations, { profile })
  console.log(
    `Verified ${expectations.service} ${expectations.event} for exact request ID and commit SHA.`
  )
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown failure"
  console.error(`Railway runtime-log verification failed: ${message}`)
  process.exitCode = 1
})
