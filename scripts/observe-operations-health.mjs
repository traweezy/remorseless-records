import { lstat, readFile } from "node:fs/promises"
import process from "node:process"

import {
  evaluateOperationsHealthResponse,
  renderOperationsObservationMarkdown,
} from "./lib/operations-observation.mjs"

const MAX_INPUT_BYTES = 128 * 1024
const VALUE_OPTIONS = new Set([
  "--body-file",
  "--handles-body-file",
  "--handles-http-status",
  "--format",
  "--http-status",
  "--now",
  "--ready-http-status",
  "--shelves-body-file",
  "--shelves-http-status",
  "--source-error",
])

const parseArguments = (arguments_) => {
  const values = new Map()
  const sourceErrors = []
  let forceAlert = false
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index]
    if (option === "--force-alert") {
      forceAlert = true
      continue
    }
    if (!VALUE_OPTIONS.has(option)) {
      throw new Error("Invalid operations observation option")
    }
    const value = arguments_[index + 1]
    if (typeof value !== "string" || value.startsWith("--")) {
      throw new Error("Operations observation option value is required")
    }
    index += 1
    if (option === "--source-error") {
      sourceErrors.push(value)
    } else if (values.has(option)) {
      throw new Error(`Duplicate option: ${option}`)
    } else {
      values.set(option, value)
    }
  }
  const bodyFile = values.get("--body-file")
  const handlesBodyFile = values.get("--handles-body-file")
  const handlesHttpStatus = Number(values.get("--handles-http-status"))
  const httpStatus = Number(values.get("--http-status"))
  const readyHttpStatus = Number(values.get("--ready-http-status"))
  const shelvesBodyFile = values.get("--shelves-body-file")
  const shelvesHttpStatus = Number(values.get("--shelves-http-status"))
  const format = values.get("--format") ?? "json"
  const now = values.has("--now") ? new Date(values.get("--now")) : new Date()
  if (
    !bodyFile ||
    !handlesBodyFile ||
    !shelvesBodyFile ||
    !Number.isInteger(handlesHttpStatus) ||
    !Number.isInteger(httpStatus) ||
    !Number.isInteger(readyHttpStatus) ||
    !Number.isInteger(shelvesHttpStatus) ||
    !["json", "markdown"].includes(format) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new Error("Invalid operations observation arguments")
  }
  return {
    bodyFile,
    forceAlert,
    format,
    handlesBodyFile,
    handlesHttpStatus,
    httpStatus,
    now,
    readyHttpStatus,
    shelvesBodyFile,
    shelvesHttpStatus,
    sourceErrors,
  }
}

const readBoundedFile = async (path) => {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Operations health input must be a regular file")
  }
  if (metadata.size > MAX_INPUT_BYTES) {
    throw new Error("Operations health input exceeded 128 KiB")
  }
  return readFile(path, "utf8")
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  const report = evaluateOperationsHealthResponse({
    body: await readBoundedFile(options.bodyFile),
    forceAlert: options.forceAlert,
    handlesBody: await readBoundedFile(options.handlesBodyFile),
    handlesHttpStatus: options.handlesHttpStatus,
    httpStatus: options.httpStatus,
    now: options.now,
    readyHttpStatus: options.readyHttpStatus,
    shelvesBody: await readBoundedFile(options.shelvesBodyFile),
    shelvesHttpStatus: options.shelvesHttpStatus,
    sourceErrors: options.sourceErrors,
  })
  process.stdout.write(
    options.format === "markdown"
      ? renderOperationsObservationMarkdown(report)
      : `${JSON.stringify(report, null, 2)}\n`
  )
  if (report.status === "alert") {
    process.exitCode = 1
  }
}

try {
  await main()
} catch {
  process.stderr.write("Staging operations observation failed safely.\n")
  process.exitCode = 1
}
