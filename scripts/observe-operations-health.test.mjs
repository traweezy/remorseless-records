import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  evaluateOperationsHealthResponse,
  renderOperationsObservationMarkdown,
} from "./lib/operations-observation.mjs";

const retentionJob = (status = "completed") => ({
  capped: false,
  commit_sha: "a".repeat(40),
  deleted: 3,
  recorded_at: "2026-08-30T11:00:00.000Z",
  scanned: 10,
  schema_version: 1,
  status,
});
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
});
const evaluate = (overrides = {}) =>
  evaluateOperationsHealthResponse({
    body: JSON.stringify(payload()),
    httpStatus: 200,
    now: new Date("2026-08-30T12:00:01.000Z"),
    readyHttpStatus: 200,
    ...overrides,
  });

describe("external operations observation", () => {
  it("accepts and sanitizes a healthy operations response", () => {
    const report = evaluate();

    assert.equal(report.status, "healthy");
    assert.equal(report.endpoint?.components.scheduler.redisLatencyMs, 12.345);
    assert.equal(
      report.endpoint?.components.retention.abandonedCheckout?.deleted,
      3,
    );
  });

  it("alerts on component reasons and independent readiness failure", () => {
    const report = evaluate({
      body: JSON.stringify(
        payload({
          reasons: ["incidents:incident_webhook_failure"],
          status: "degraded",
        }),
      ),
      httpStatus: 503,
      readyHttpStatus: 503,
    });

    assert.equal(report.status, "alert");
    assert.ok(report.reasons.includes("incidents:incident_webhook_failure"));
    assert.ok(report.reasons.includes("readiness_endpoint_unhealthy"));
  });

  it("drops unknown response fields from retained evidence", () => {
    const report = evaluate({
      body: JSON.stringify(payload({ private_email: "private@example.com" })),
    });
    const markdown = renderOperationsObservationMarkdown(report);

    assert.doesNotMatch(JSON.stringify(report), /private@example/u);
    assert.doesNotMatch(markdown, /private@example/u);
  });

  it("pins the public operations and readiness monitor", async () => {
    const workflow = await readFile(
      new URL(
        "../.github/workflows/staging-operations-monitor.yml",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(workflow, /\/health\/operations/u);
    assert.match(workflow, /\/ready/u);
    assert.match(workflow, /cron: "3 5 \* \* \*"/u);
    assert.match(workflow, /issues: write/u);
    assert.doesNotMatch(workflow, /RAILWAY_(?:API_)?TOKEN/u);
    assert.doesNotMatch(workflow, /production/u);
  });
});
