const HEALTH_REASONS = new Set([
  "redis_unavailable",
  "redis_latency_high",
  "redis_latency_missing",
  "scheduler_heartbeat_from_future",
  "scheduler_heartbeat_missing",
  "scheduler_heartbeat_stale",
  "scheduler_incident_latched",
  "scheduler_latest_unhealthy",
  "scheduler_state_invalid",
]);
const SCHEDULER_EVENTS = new Set([
  "job.checkout_reconciliation.attention",
  "job.checkout_reconciliation.completed",
  "job.checkout_reconciliation.failed",
  "job.checkout_reconciliation.skipped",
]);
const SCHEDULER_STATUSES = new Set([
  "attention",
  "completed",
  "failed",
  "skipped",
]);
const SHA_PATTERN = /^(?:[0-9a-f]{40}|unknown)$/u;
const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_HEALTH_RESPONSE_AGE_SECONDS = 2 * 60;
const MAX_HEARTBEAT_AGE_SECONDS = 10 * 60;
const MAX_REPORTED_AGE_DRIFT_SECONDS = 5;
const MAX_REDIS_LATENCY_MS = 250;

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validTimestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const sanitizeSnapshot = (value) => {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    typeof value.status !== "string" ||
    !SCHEDULER_STATUSES.has(value.status) ||
    typeof value.event !== "string" ||
    !SCHEDULER_EVENTS.has(value.event) ||
    !validTimestamp(value.recorded_at) ||
    typeof value.commit_sha !== "string" ||
    !SHA_PATTERN.test(value.commit_sha)
  ) {
    return null;
  }

  return {
    commitSha: value.commit_sha,
    event: value.event,
    recordedAt: value.recorded_at,
    status: value.status,
  };
};

const parsePayload = (body) => {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    (value.status !== "healthy" && value.status !== "degraded") ||
    (value.redis !== "ok" && value.redis !== "error") ||
    (value.redis_latency_ms !== null &&
      (typeof value.redis_latency_ms !== "number" ||
        !Number.isFinite(value.redis_latency_ms) ||
        value.redis_latency_ms < 0)) ||
    !validTimestamp(value.checked_at) ||
    typeof value.observation_window_seconds !== "number" ||
    !Number.isInteger(value.observation_window_seconds) ||
    value.observation_window_seconds <= 0 ||
    !Array.isArray(value.reasons) ||
    value.reasons.some(
      (reason) => typeof reason !== "string" || !HEALTH_REASONS.has(reason),
    ) ||
    (value.heartbeat_age_seconds !== null &&
      (typeof value.heartbeat_age_seconds !== "number" ||
        !Number.isFinite(value.heartbeat_age_seconds) ||
        value.heartbeat_age_seconds < 0))
  ) {
    return null;
  }

  const heartbeat =
    value.heartbeat === null ? null : sanitizeSnapshot(value.heartbeat);
  const incident =
    value.incident === null ? null : sanitizeSnapshot(value.incident);
  if (
    (value.heartbeat !== null && heartbeat === null) ||
    (value.incident !== null && incident === null)
  ) {
    return null;
  }

  return {
    checkedAt: value.checked_at,
    heartbeat,
    heartbeatAgeSeconds: value.heartbeat_age_seconds,
    incident,
    observationWindowSeconds: value.observation_window_seconds,
    reasons: value.reasons,
    redis: value.redis,
    redisLatencyMs: value.redis_latency_ms,
    status: value.status,
  };
};

export const evaluateSchedulerHealthResponse = ({
  body,
  forceAlert = false,
  httpStatus,
  now = new Date(),
  sourceErrors = [],
}) => {
  if (typeof body !== "string") {
    throw new TypeError("Scheduler health body must be a string");
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 0 || httpStatus > 599) {
    throw new TypeError("Scheduler health HTTP status must be bounded");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Scheduler observation time must be valid");
  }
  if (!Array.isArray(sourceErrors)) {
    throw new TypeError("Scheduler source errors must be an array");
  }
  for (const error of sourceErrors) {
    if (typeof error !== "string" || !/^[a-z0-9_:-]{1,64}$/u.test(error)) {
      throw new TypeError("Scheduler source errors must be machine codes");
    }
  }

  const reasons = new Set(sourceErrors.map((error) => `source_error:${error}`));
  const payload = parsePayload(body);
  if (!payload) {
    reasons.add("health_payload_invalid");
  } else {
    for (const reason of payload.reasons) {
      reasons.add(reason);
    }
    const checkedAtMilliseconds = Date.parse(payload.checkedAt);
    const responseAgeSeconds =
      (now.getTime() - checkedAtMilliseconds) / 1_000;
    if (responseAgeSeconds > MAX_HEALTH_RESPONSE_AGE_SECONDS) {
      reasons.add("health_response_stale");
    }
    if (responseAgeSeconds < -MAX_CLOCK_SKEW_SECONDS) {
      reasons.add("health_response_from_future");
    }
    if (payload.heartbeat) {
      const heartbeatRecordedAtMilliseconds = Date.parse(
        payload.heartbeat.recordedAt,
      );
      const observedHeartbeatAgeSeconds =
        (now.getTime() - heartbeatRecordedAtMilliseconds) / 1_000;
      const reportedAtCheckSeconds =
        (checkedAtMilliseconds - heartbeatRecordedAtMilliseconds) / 1_000;
      if (observedHeartbeatAgeSeconds > MAX_HEARTBEAT_AGE_SECONDS) {
        reasons.add("scheduler_heartbeat_stale");
      }
      if (observedHeartbeatAgeSeconds < -MAX_CLOCK_SKEW_SECONDS) {
        reasons.add("scheduler_heartbeat_from_future");
      }
      if (
        payload.heartbeatAgeSeconds === null ||
        Math.abs(payload.heartbeatAgeSeconds - reportedAtCheckSeconds) >
          MAX_REPORTED_AGE_DRIFT_SECONDS
      ) {
        reasons.add("scheduler_heartbeat_age_mismatch");
      }
    }
    if (payload.redis === "ok" && payload.redisLatencyMs === null) {
      reasons.add("redis_latency_missing");
    }
    if (
      payload.redisLatencyMs !== null &&
      payload.redisLatencyMs >= MAX_REDIS_LATENCY_MS
    ) {
      reasons.add("redis_latency_high");
    }
    if (
      httpStatus !== 200 ||
      payload.status !== "healthy" ||
      payload.redis !== "ok" ||
      payload.heartbeat === null ||
      payload.heartbeat.status !== "completed" ||
      payload.incident !== null ||
      payload.reasons.length > 0
    ) {
      reasons.add("health_endpoint_unhealthy");
    }
  }
  if (forceAlert) {
    reasons.add("forced_acceptance_alert");
  }

  const reasonList = [...reasons].toSorted();
  return {
    schemaVersion: 1,
    status: reasonList.length === 0 ? "healthy" : "alert",
    environment: "staging",
    evaluatedAt: now.toISOString(),
    httpStatus,
    endpoint: payload
      ? {
          checkedAt: payload.checkedAt,
          heartbeat: payload.heartbeat,
          heartbeatAgeSeconds: payload.heartbeatAgeSeconds,
          incident: payload.incident,
          observationWindowSeconds: payload.observationWindowSeconds,
          redis: payload.redis,
          redisLatencyMs: payload.redisLatencyMs,
          status: payload.status,
        }
      : null,
    reasons: reasonList,
  };
};

export const renderSchedulerObservationMarkdown = (report) => {
  if (!isRecord(report) || typeof report.status !== "string") {
    throw new TypeError("Scheduler observation report is required");
  }

  const lines = [
    "# Staging scheduler observation",
    "",
    `- Status: \`${report.status}\``,
    `- Evaluated: \`${report.evaluatedAt}\``,
    `- HTTP status: \`${report.httpStatus}\``,
    `- Endpoint status: \`${report.endpoint?.status ?? "invalid"}\``,
    `- Redis: \`${report.endpoint?.redis ?? "unknown"}\``,
    `- Redis latency ms: \`${report.endpoint?.redisLatencyMs ?? "n/a"}\``,
    `- Heartbeat age seconds: \`${report.endpoint?.heartbeatAgeSeconds ?? "n/a"}\``,
    `- Heartbeat event: \`${report.endpoint?.heartbeat?.event ?? "n/a"}\``,
    `- Heartbeat commit: \`${report.endpoint?.heartbeat?.commitSha ?? "n/a"}\``,
    `- Incident event: \`${report.endpoint?.incident?.event ?? "none"}\``,
    `- Observation window seconds: \`${report.endpoint?.observationWindowSeconds ?? "n/a"}\``,
    "",
    "## Alert reasons",
    "",
  ];
  lines.push(
    ...(report.reasons.length === 0
      ? ["- None"]
      : report.reasons.map((reason) => `- \`${reason}\``)),
  );
  lines.push("");
  return lines.join("\n");
};
