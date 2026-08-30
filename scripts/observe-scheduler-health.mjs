import { lstat, readFile } from "node:fs/promises"
import process from "node:process"

import {
  evaluateSchedulerHealthResponse,
  renderSchedulerObservationMarkdown,
} from "./lib/scheduler-observation.mjs"

const MAX_INPUT_BYTES = 64 * 1024
const VALUE_OPTIONS = new Set([
  "--body-file",
  "--format",
  "--http-status",
  "--now",
  "--source-error",
])
const usage =
  "Usage: node scripts/observe-scheduler-health.mjs --body-file FILE " +
  "--http-status CODE [--format json|markdown] [--now ISO] " +
  "[--source-error CODE] [--force-alert]"

const parseArguments = (arguments_) => {
  const values = new Map()
  const sourceErrors = []
  let forceAlert = false

  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index]
    if (option === "--force-alert") {
      if (forceAlert) {
        throw new Error("Duplicate option: --force-alert")
      }
      forceAlert = true
      continue
    }
    if (!VALUE_OPTIONS.has(option)) {
      throw new Error(usage)
    }
    const value = arguments_[index + 1]
    if (typeof value !== "string" || value.startsWith("--")) {
      throw new Error(usage)
    }
    index += 1
    if (option === "--source-error") {
      sourceErrors.push(value)
    } else {
      if (values.has(option)) {
        throw new Error(`Duplicate option: ${option}`)
      }
      values.set(option, value)
    }
  }

  const bodyFile = values.get("--body-file")
  const httpStatus = Number(values.get("--http-status"))
  if (!bodyFile || !Number.isInteger(httpStatus)) {
    throw new Error(usage)
  }
  const format = values.get("--format") ?? "json"
  if (format !== "json" && format !== "markdown") {
    throw new Error("--format must be json or markdown")
  }
  const nowValue = values.get("--now")
  const now = nowValue ? new Date(nowValue) : new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new Error("--now must be a valid ISO timestamp")
  }
  return { bodyFile, forceAlert, format, httpStatus, now, sourceErrors }
}

const readBoundedFile = async (path) => {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Scheduler health input must be a regular file")
  }
  if (metadata.size > MAX_INPUT_BYTES) {
    throw new Error("Scheduler health input exceeded 64 KiB")
  }
  return readFile(path, "utf8")
}

const fatalReport = (format) => {
  const report = evaluateSchedulerHealthResponse({
    body: "",
    httpStatus: 0,
    sourceErrors: ["observation_evaluation_failed"],
  })
  return format === "markdown"
    ? renderSchedulerObservationMarkdown(report)
    : `${JSON.stringify(report, null, 2)}\n`
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  const report = evaluateSchedulerHealthResponse({
    body: await readBoundedFile(options.bodyFile),
    forceAlert: options.forceAlert,
    httpStatus: options.httpStatus,
    now: options.now,
    sourceErrors: options.sourceErrors,
  })
  process.stdout.write(
    options.format === "markdown"
      ? renderSchedulerObservationMarkdown(report)
      : `${JSON.stringify(report, null, 2)}\n`
  )
  if (report.status === "alert") {
    process.exitCode = 1
  }
}

let format = "json"
try {
  const formatIndex = process.argv.indexOf("--format")
  if (formatIndex >= 0 && process.argv[formatIndex + 1] === "markdown") {
    format = "markdown"
  }
  await main()
} catch {
  process.stdout.write(fatalReport(format))
  process.stderr.write(
    "Staging scheduler observation failed before a safe report was completed.\n"
  )
  process.exitCode = 1
}
