import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  evaluateSchedulerHealthResponse,
  renderSchedulerObservationMarkdown,
} from "./lib/scheduler-observation.mjs";

const heartbeat = {
  schema_version: 1,
  status: "completed",
  event: "job.checkout_reconciliation.completed",
  recorded_at: "2026-08-29T20:59:00.000Z",
  commit_sha: "a".repeat(40),
};
const payload = (overrides = {}) => ({
  schema_version: 1,
  status: "healthy",
  checked_at: "2026-08-29T21:00:00.000Z",
  heartbeat,
  heartbeat_age_seconds: 60,
  incident: null,
  observation_window_seconds: 86_400,
  reasons: [],
  redis: "ok",
  redis_latency_ms: 12.345,
  ...overrides,
});
const evaluate = (overrides = {}) =>
  evaluateSchedulerHealthResponse({
    body: JSON.stringify(payload()),
    httpStatus: 200,
    now: new Date("2026-08-29T21:00:01.000Z"),
    ...overrides,
  });

describe("external scheduler observation", () => {
  it("accepts a bounded healthy endpoint response", () => {
    const report = evaluate();

    assert.equal(report.status, "healthy");
    assert.equal(report.endpoint?.heartbeatAgeSeconds, 60);
    assert.equal(report.endpoint?.redisLatencyMs, 12.345);
    assert.deepEqual(report.reasons, []);
  });

  it("retains a degraded incident without copying unknown payload data", () => {
    const incident = {
      ...heartbeat,
      status: "attention",
      event: "job.checkout_reconciliation.attention",
      private_detail: "private@example.com",
    };
    const report = evaluate({
      body: JSON.stringify(
        payload({
          status: "degraded",
          incident,
          reasons: ["scheduler_incident_latched"],
        }),
      ),
      httpStatus: 503,
    });
    const serialized = JSON.stringify(report);

    assert.equal(report.status, "alert");
    assert.ok(report.reasons.includes("scheduler_incident_latched"));
    assert.ok(report.reasons.includes("health_endpoint_unhealthy"));
    assert.doesNotMatch(serialized, /private@example/u);
  });

  it("fails closed on unreachable or malformed responses", () => {
    const unreachable = evaluate({
      body: "",
      httpStatus: 0,
      sourceErrors: ["health_endpoint_unreachable"],
    });
    const malformed = evaluate({
      body: '{"private":"secret@example.com"}',
      httpStatus: 200,
    });

    assert.equal(unreachable.status, "alert");
    assert.ok(
      unreachable.reasons.includes("source_error:health_endpoint_unreachable"),
    );
    assert.ok(malformed.reasons.includes("health_payload_invalid"));
    assert.doesNotMatch(JSON.stringify(malformed), /secret@example/u);
  });

  it("independently rejects replayed or inconsistent health ages", () => {
    const replayedHeartbeat = {
      ...heartbeat,
      recorded_at: "2026-08-29T20:49:00.000Z",
    };
    const replayed = evaluate({
      body: JSON.stringify(
        payload({
          checked_at: "2026-08-29T20:50:00.000Z",
          heartbeat: replayedHeartbeat,
        }),
      ),
    });
    const inconsistent = evaluate({
      body: JSON.stringify(payload({ heartbeat_age_seconds: 1 })),
    });

    assert.ok(replayed.reasons.includes("health_response_stale"));
    assert.ok(replayed.reasons.includes("scheduler_heartbeat_stale"));
    assert.ok(
      inconsistent.reasons.includes("scheduler_heartbeat_age_mismatch"),
    );
  });

  it("independently alerts on elevated or missing Redis latency", () => {
    const elevated = evaluate({
      body: JSON.stringify(payload({ redis_latency_ms: 250 })),
    });
    const missing = evaluate({
      body: JSON.stringify(payload({ redis_latency_ms: null })),
    });

    assert.ok(elevated.reasons.includes("redis_latency_high"));
    assert.ok(missing.reasons.includes("redis_latency_missing"));
  });

  it("exercises a forced alert using the same sanitized report", () => {
    const report = evaluate({ forceAlert: true });
    const markdown = renderSchedulerObservationMarkdown(report);

    assert.equal(report.status, "alert");
    assert.match(markdown, /`forced_acceptance_alert`/u);
    assert.doesNotMatch(markdown, /message|run_id/iu);
  });

  it("pins a public staging endpoint and external issue workflow", async () => {
    const workflow = await readFile(
      new URL(
        "../.github/workflows/staging-scheduler-monitor.yml",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(workflow, /cron: "3,13,23,33,43,53 \* \* \* \*"/u);
    assert.match(workflow, /cron: "17 4 \* \* \*"/u);
    assert.match(
      workflow,
      /https:\/\/remorseless-records-admin-staging\.up\.railway\.app\/health\/scheduler/u,
    );
    assert.match(workflow, /issues: write/u);
    assert.match(workflow, /--max-time 10/u);
    assert.doesNotMatch(workflow, /RAILWAY_(?:API_)?TOKEN/u);
    assert.doesNotMatch(workflow, /production/u);
  });
});
