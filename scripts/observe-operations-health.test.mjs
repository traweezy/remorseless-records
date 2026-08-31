import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"

import {
  evaluateOperationsHealthResponse,
  renderOperationsObservationMarkdown,
} from "./lib/operations-observation.mjs"

const retentionJob = (status = "completed") => ({
  capped: false,
  commit_sha: "a".repeat(40),
  deleted: 3,
  recorded_at: "2026-08-30T11:00:00.000Z",
  scanned: 10,
  schema_version: 1,
  status,
})
const payload = (overrides = {}) => ({
  checked_at: "2026-08-30T12:00:00.000Z",
  components: {
    incidents: { incidents: [], reasons: [], status: "healthy" },
    retention: {
      jobs: {
        abandoned_checkout: retentionJob(),
        anonymous_cart: retentionJob("disabled"),
      },
      reasons: [],
      status: "healthy",
    },
    scheduler: {
      reasons: [],
      redis_latency_ms: 12.345,
      status: "healthy",
    },
  },
  dependencies: [
    { duration_ms: 10, name: "database", status: "ok" },
    { duration_ms: 20, name: "object_storage", status: "ok" },
  ],
  reasons: [],
  schema_version: 1,
  status: "healthy",
  version: "a".repeat(40),
  ...overrides,
})
const evaluate = (overrides = {}) =>
  evaluateOperationsHealthResponse({
    body: JSON.stringify(payload()),
    handlesBody: JSON.stringify({
      handles: [
        {
          created_at: "2026-08-01T00:00:00.000Z",
          handle: "first-release",
          id: "prod_1",
          updated_at: "2026-08-30T00:00:00.000Z",
        },
      ],
      next_cursor: null,
    }),
    handlesHttpStatus: 200,
    httpStatus: 200,
    now: new Date("2026-08-30T12:00:01.000Z"),
    readyHttpStatus: 200,
    shelvesBody: JSON.stringify({
      shelves: [
        {
          productIds: ["prod_1"],
          shelf: {
            handle: "featured",
            id: "cshelf_1",
            title: "Featured releases",
          },
        },
      ],
    }),
    shelvesHttpStatus: 200,
    ...overrides,
  })

describe("external operations observation", () => {
  it("accepts and sanitizes a healthy operations response", () => {
    const report = evaluate()

    assert.equal(report.status, "healthy")
    assert.equal(report.endpoint?.components.scheduler.redisLatencyMs, 12.345)
    assert.equal(report.catalog.handles.count, 1)
    assert.equal(report.catalog.shelves.productCount, 1)
    assert.equal(
      report.endpoint?.components.retention.abandonedCheckout?.deleted,
      3
    )
  })

  it("alerts on component reasons and independent readiness failure", () => {
    const report = evaluate({
      body: JSON.stringify(
        payload({
          reasons: ["incidents:incident_webhook_failure"],
          status: "degraded",
        })
      ),
      httpStatus: 503,
      readyHttpStatus: 503,
    })

    assert.equal(report.status, "alert")
    assert.ok(report.reasons.includes("incidents:incident_webhook_failure"))
    assert.ok(report.reasons.includes("readiness_endpoint_unhealthy"))
  })

  it("drops unknown response fields from retained evidence", () => {
    const report = evaluate({
      body: JSON.stringify(payload({ private_email: "private@example.com" })),
    })
    const markdown = renderOperationsObservationMarkdown(report)

    assert.doesNotMatch(JSON.stringify(report), /private@example/u)
    assert.doesNotMatch(markdown, /private@example/u)
  })

  it("alerts on unavailable or empty public catalog projections", () => {
    const report = evaluate({
      handlesBody: JSON.stringify({ handles: [], next_cursor: null }),
      handlesHttpStatus: 500,
      shelvesBody: JSON.stringify({ shelves: [] }),
      shelvesHttpStatus: 200,
    })

    assert.ok(report.reasons.includes("catalog_handles_endpoint_unhealthy"))
    assert.ok(report.reasons.includes("catalog_handles_empty"))
    assert.ok(report.reasons.includes("catalog_shelves_empty"))
    assert.ok(report.reasons.includes("catalog_shelf_products_empty"))
  })

  it("rejects malformed catalog bodies without retaining their contents", () => {
    const report = evaluate({
      handlesBody: JSON.stringify({
        handles: [{ handle: "release", id: " invalid" }],
        private_email: "private@example.com",
      }),
      shelvesBody: "not-json",
    })
    const retained = JSON.stringify(report)

    assert.ok(report.reasons.includes("catalog_handles_payload_invalid"))
    assert.ok(report.reasons.includes("catalog_shelves_payload_invalid"))
    assert.doesNotMatch(retained, /private@example/u)
  })

  it("pins the public operations and readiness monitor", async () => {
    const workflow = await readFile(
      new URL(
        "../.github/workflows/staging-operations-monitor.yml",
        import.meta.url
      ),
      "utf8"
    )

    assert.match(workflow, /\/health\/operations/u)
    assert.match(workflow, /\/ready/u)
    assert.match(workflow, /\/store\/products\/handles\?limit=1/u)
    assert.match(workflow, /\/store\/catalog\/shelves/u)
    assert.match(workflow, /NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY/u)
    assert.match(workflow, /cron: "3 5 \* \* \*"/u)
    assert.match(workflow, /issues: write/u)
    assert.doesNotMatch(workflow, /RAILWAY_(?:API_)?TOKEN/u)
    assert.doesNotMatch(workflow, /production/u)
  })
})
