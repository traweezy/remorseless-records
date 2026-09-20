import process from "node:process"

import { readBoundedObservationFile } from "./lib/bounded-observation-file.mjs"
import {
  evaluateOperationsHealthResponse,
  renderOperationsObservationMarkdown,
} from "./lib/operations-observation.mjs"

const MAX_INPUT_BYTES = 128 * 1024
const VALUE_OPTIONS = new Set([
  "--body-file",
  "--discography-body-file",
  "--discography-http-status",
  "--handles-body-file",
  "--handles-http-status",
  "--format",
  "--http-status",
  "--now",
  "--products-body-file",
  "--products-http-status",
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
  const discographyBodyFile = values.get("--discography-body-file")
  const discographyHttpStatus = Number(values.get("--discography-http-status"))
  const handlesBodyFile = values.get("--handles-body-file")
  const handlesHttpStatus = Number(values.get("--handles-http-status"))
  const httpStatus = Number(values.get("--http-status"))
  const readyHttpStatus = Number(values.get("--ready-http-status"))
  const shelvesBodyFile = values.get("--shelves-body-file")
  const shelvesHttpStatus = Number(values.get("--shelves-http-status"))
  const format = values.get("--format") ?? "json"
  const now = values.has("--now") ? new Date(values.get("--now")) : new Date()
  const productsBodyFile = values.get("--products-body-file")
  const productsHttpStatus = Number(values.get("--products-http-status"))
  if (
    !bodyFile ||
    !discographyBodyFile ||
    !handlesBodyFile ||
    !shelvesBodyFile ||
    !Number.isInteger(handlesHttpStatus) ||
    !Number.isInteger(discographyHttpStatus) ||
    !Number.isInteger(httpStatus) ||
    !Number.isInteger(readyHttpStatus) ||
    !productsBodyFile ||
    !Number.isInteger(productsHttpStatus) ||
    !Number.isInteger(shelvesHttpStatus) ||
    !["json", "markdown"].includes(format) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new Error("Invalid operations observation arguments")
  }
  return {
    bodyFile,
    discographyBodyFile,
    discographyHttpStatus,
    forceAlert,
    format,
    handlesBodyFile,
    handlesHttpStatus,
    httpStatus,
    now,
    productsBodyFile,
    productsHttpStatus,
    readyHttpStatus,
    shelvesBodyFile,
    shelvesHttpStatus,
    sourceErrors,
  }
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  const report = evaluateOperationsHealthResponse({
    body: await readBoundedObservationFile(options.bodyFile, MAX_INPUT_BYTES),
    discographyBody: await readBoundedObservationFile(
      options.discographyBodyFile,
      MAX_INPUT_BYTES
    ),
    discographyHttpStatus: options.discographyHttpStatus,
    forceAlert: options.forceAlert,
    handlesBody: await readBoundedObservationFile(
      options.handlesBodyFile,
      MAX_INPUT_BYTES
    ),
    handlesHttpStatus: options.handlesHttpStatus,
    httpStatus: options.httpStatus,
    now: options.now,
    productsBody: await readBoundedObservationFile(
      options.productsBodyFile,
      MAX_INPUT_BYTES
    ),
    productsHttpStatus: options.productsHttpStatus,
    readyHttpStatus: options.readyHttpStatus,
    shelvesBody: await readBoundedObservationFile(
      options.shelvesBodyFile,
      MAX_INPUT_BYTES
    ),
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
