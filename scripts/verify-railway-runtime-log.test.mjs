import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  normalizeRailwayRuntimeLog,
  parseRailwayLogJsonLines,
  verifyRailwayRuntimeLog,
} from "./lib/railway-runtime-log.mjs"

const expectations = {
  commit_sha: "a".repeat(40),
  environment: "staging",
  event: "api.problem",
  level: "info",
  problem_code: "invalid_request",
  request_id: "acceptance_runtime_log_01",
  service: "storefront",
  status: 400,
  trace_id: "b".repeat(32),
}

const structuredEvent = {
  ...expectations,
  message: "",
  method: "POST",
  span_id: "c".repeat(16),
  timestamp: "2026-08-27T06:00:00.000Z",
}

describe("Railway runtime-log acceptance", () => {
  it("verifies Storefront fields parsed into the Railway record", () => {
    assert.equal(
      verifyRailwayRuntimeLog([structuredEvent], expectations).request_id,
      expectations.request_id
    )
  })

  it("normalizes Backend structured events nested in message", () => {
    const backendExpectations = {
      ...expectations,
      event: "api.request.completed",
      level: "warning",
      problem_code: "contact_unauthorized",
      service: "backend",
      status: 401,
    }
    const outerTimestamp = "2026-08-27T06:01:00.000Z"
    const normalized = normalizeRailwayRuntimeLog({
      level: "warning",
      message: JSON.stringify({
        ...backendExpectations,
        message: "API request completed",
      }),
      timestamp: outerTimestamp,
    })

    assert.equal(normalized.event, backendExpectations.event)
    assert.equal(normalized.railway_timestamp, outerTimestamp)
    assert.equal(
      verifyRailwayRuntimeLog(
        [
          {
            level: "warning",
            message: JSON.stringify(backendExpectations),
            timestamp: outerTimestamp,
          },
        ],
        backendExpectations
      ).service,
      "backend"
    )
  })

  it("parses JSON lines and rejects malformed records without echoing data", () => {
    assert.deepEqual(
      parseRailwayLogJsonLines(
        `${JSON.stringify(structuredEvent)}\n${JSON.stringify({ message: "ready" })}\n`
      ),
      [structuredEvent, { message: "ready" }]
    )
    assert.throws(
      () => parseRailwayLogJsonLines('{"request_id":"sensitive"'),
      (error) =>
        error instanceof Error &&
        error.message === "Railway log line 1 is not a JSON object" &&
        !error.message.includes("sensitive")
    )
  })

  it("fails closed when the exact request event is absent or mismatched", () => {
    assert.throws(
      () =>
        verifyRailwayRuntimeLog(
          [{ ...structuredEvent, request_id: "different_request" }],
          expectations
        ),
      /Exact request ID was absent/
    )
    assert.throws(
      () =>
        verifyRailwayRuntimeLog(
          [{ ...structuredEvent, commit_sha: "d".repeat(40), status: 500 }],
          expectations
        ),
      /commit_sha, status/
    )
  })
})
