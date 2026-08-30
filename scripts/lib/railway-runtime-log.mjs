const EXPECTED_STRING_FIELDS = [
  "commit_sha",
  "environment",
  "event",
  "level",
  "problem_code",
  "request_id",
  "service",
  "trace_id",
]

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parseNestedMessage = (message) => {
  if (typeof message !== "string" || !message.trimStart().startsWith("{")) {
    return null
  }

  try {
    const parsed = JSON.parse(message)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const parseRailwayLogJsonLines = (input) => {
  if (typeof input !== "string") {
    throw new TypeError("Railway log input must be a string")
  }

  return input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const parsed = JSON.parse(line)
        if (!isRecord(parsed)) {
          throw new TypeError("record required")
        }
        return parsed
      } catch {
        throw new Error(`Railway log line ${index + 1} is not a JSON object`)
      }
    })
}

export const normalizeRailwayRuntimeLog = (record) => {
  if (!isRecord(record)) {
    throw new TypeError("Railway log record must be an object")
  }

  const nested = parseNestedMessage(record.message)
  if (!nested) {
    return { ...record }
  }

  return {
    ...record,
    ...nested,
    level: record.level ?? nested.level,
    railway_timestamp: record.timestamp,
  }
}

const validateExpectations = (expectations) => {
  if (!isRecord(expectations)) {
    throw new TypeError("Runtime-log expectations must be an object")
  }

  for (const field of EXPECTED_STRING_FIELDS) {
    const value = expectations[field]
    if (typeof value !== "string" || value.length === 0 || value.length > 128) {
      throw new TypeError(
        `Expected ${field} must be a non-empty bounded string`
      )
    }
  }

  if (!Number.isInteger(expectations.status)) {
    throw new TypeError("Expected status must be an integer")
  }
}

export const verifyRailwayRuntimeLog = (records, expectations) => {
  if (!Array.isArray(records)) {
    throw new TypeError("Railway log records must be an array")
  }
  validateExpectations(expectations)

  const normalized = records.map(normalizeRailwayRuntimeLog)
  const requestRecords = normalized.filter(
    (record) => record.request_id === expectations.request_id
  )

  if (requestRecords.length === 0) {
    throw new Error("Exact request ID was absent from Railway runtime logs")
  }

  const expectedFields = [...EXPECTED_STRING_FIELDS, "status"]
  const mismatchSets = requestRecords.map((record) =>
    expectedFields.filter((field) => record[field] !== expectations[field])
  )
  const matchingIndex = mismatchSets.findIndex((fields) => fields.length === 0)

  if (matchingIndex === -1) {
    const mismatchedFields = mismatchSets.toSorted(
      (left, right) => left.length - right.length
    )[0]
    throw new Error(
      `Exact-request Railway event mismatched fields: ${mismatchedFields.join(", ")}`
    )
  }

  return requestRecords[matchingIndex]
}
