import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
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

  it("verifies native completion without inventing a problem-code field", () => {
    const { problem_code: _unused, ...completion } = {
      ...expectations,
      service: "backend",
      event: "http.request.completed",
      level: "warn",
    }
    const native = { level: "warn", message: JSON.stringify(completion) }
    assert.equal(
      verifyRailwayRuntimeLog([native], completion, { profile: "completion" })
        .request_id,
      completion.request_id
    )
    assert.throws(() => verifyRailwayRuntimeLog([native], completion))
    assert.throws(() =>
      verifyRailwayRuntimeLog(
        [native],
        { ...completion, problem_code: "not_allowed" },
        { profile: "completion" }
      )
    )
    assert.throws(() =>
      verifyRailwayRuntimeLog([native], expectations, { profile: "completion" })
    )
    assert.throws(() =>
      verifyRailwayRuntimeLog([native], completion, { profile: "other" })
    )
    for (const field of [
      "commit_sha",
      "environment",
      "event",
      "level",
      "request_id",
      "service",
      "trace_id",
      "status",
    ]) {
      const altered = {
        ...completion,
        [field]: field === "status" ? 500 : "different",
      }
      assert.throws(() =>
        verifyRailwayRuntimeLog([altered], completion, {
          profile: "completion",
        })
      )
    }
  })

  it("rejects conflicting copies of the exact event but permits its distinct completion event", () => {
    assert.throws(
      () =>
        verifyRailwayRuntimeLog(
          [structuredEvent, { ...structuredEvent, commit_sha: "e".repeat(40) }],
          expectations
        ),
      /conflicting identities/u
    )
    assert.equal(
      verifyRailwayRuntimeLog(
        [
          structuredEvent,
          { ...structuredEvent, event: "http.request.completed" },
        ],
        expectations
      ).event,
      "api.problem"
    )
  })

  it("CLI supports completion and cannot silently waive problem evidence", () => {
    const { problem_code: _unused, ...completion } = {
      ...expectations,
      service: "backend",
      event: "http.request.completed",
      level: "warn",
    }
    const args = Object.entries(completion).flatMap(([key, value]) => [
      `--${key.replaceAll("_", "-")}`,
      String(value),
    ])
    const run = (options, input = JSON.stringify(completion)) =>
      spawnSync(
        process.execPath,
        [
          new URL("./verify-railway-runtime-log.mjs", import.meta.url).pathname,
          ...options,
        ],
        { encoding: "utf8", input, timeout: 10000 }
      )
    assert.equal(run([...args, "--profile", "completion"]).status, 0)
    assert.equal(run(args).status, 1)
    assert.equal(
      run([...args, "--profile", "completion", "--problem-code", "invented"])
        .status,
      1
    )
    assert.equal(
      run([...args, "--profile", "completion", "--profile", "completion"])
        .status,
      1
    )
    const invalid = run(
      [...args, "--profile", "completion"],
      "private-invalid-log"
    )
    assert.equal(invalid.status, 1)
    assert.ok(!invalid.stderr.includes("private-invalid-log"))
  })
})
