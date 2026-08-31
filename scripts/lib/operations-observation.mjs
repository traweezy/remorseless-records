const SHA_PATTERN = /^(?:[0-9a-f]{40}|unknown)$/u
const REASON_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,191}$/u
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u
const MAX_CLOCK_SKEW_SECONDS = 60
const MAX_RESPONSE_AGE_SECONDS = 2 * 60
const CATALOG_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const validTimestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
const validReasons = (value) =>
  Array.isArray(value) &&
  value.every(
    (reason) => typeof reason === "string" && REASON_PATTERN.test(reason)
  )
const validCatalogIdentifier = (value) =>
  typeof value === "string" && CATALOG_IDENTIFIER_PATTERN.test(value)
const validCatalogText = (value, maximumLength) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(value)

const parseCatalogHandles = (body) => {
  let value
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.handles) ||
    value.handles.length > 1 ||
    !(value.next_cursor === null || validCatalogText(value.next_cursor, 256))
  ) {
    return null
  }
  const ids = new Set()
  for (const handle of value.handles) {
    if (
      !isRecord(handle) ||
      !validCatalogIdentifier(handle.id) ||
      !validCatalogText(handle.handle, 200) ||
      ids.has(handle.id)
    ) {
      return null
    }
    ids.add(handle.id)
  }
  return { count: value.handles.length }
}

const parseCatalogShelves = (body) => {
  let value
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.shelves) ||
    value.shelves.length > 50
  ) {
    return null
  }
  const shelfIds = new Set()
  let productCount = 0
  for (const entry of value.shelves) {
    if (
      !isRecord(entry) ||
      !isRecord(entry.shelf) ||
      !validCatalogIdentifier(entry.shelf.id) ||
      !validCatalogText(entry.shelf.handle, 200) ||
      !validCatalogText(entry.shelf.title, 500) ||
      shelfIds.has(entry.shelf.id) ||
      !Array.isArray(entry.productIds) ||
      entry.productIds.length > 3_000
    ) {
      return null
    }
    const productIds = new Set()
    for (const productId of entry.productIds) {
      if (!validCatalogIdentifier(productId) || productIds.has(productId)) {
        return null
      }
      productIds.add(productId)
    }
    shelfIds.add(entry.shelf.id)
    productCount += productIds.size
  }
  return { count: value.shelves.length, productCount }
}

const sanitizeRetentionJob = (value) => {
  if (value === null) {
    return null
  }
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    !["completed", "disabled", "failed"].includes(value.status) ||
    !validTimestamp(value.recorded_at) ||
    typeof value.commit_sha !== "string" ||
    !SHA_PATTERN.test(value.commit_sha)
  ) {
    return undefined
  }
  const count = (field) =>
    Number.isInteger(value[field]) && value[field] >= 0
      ? value[field]
      : undefined
  return {
    capped: typeof value.capped === "boolean" ? value.capped : null,
    commitSha: value.commit_sha,
    deleted: count("deleted") ?? null,
    recordedAt: value.recorded_at,
    scanned: count("scanned") ?? null,
    status: value.status,
  }
}

const sanitizeDependencies = (value) => {
  if (!Array.isArray(value)) {
    return null
  }
  const dependencies = []
  for (const dependency of value) {
    if (
      !isRecord(dependency) ||
      typeof dependency.name !== "string" ||
      !NAME_PATTERN.test(dependency.name) ||
      (dependency.status !== "ok" && dependency.status !== "error") ||
      typeof dependency.duration_ms !== "number" ||
      !Number.isFinite(dependency.duration_ms) ||
      dependency.duration_ms < 0
    ) {
      return null
    }
    dependencies.push({
      durationMs: dependency.duration_ms,
      name: dependency.name,
      status: dependency.status,
    })
  }
  return dependencies
}

const parsePayload = (body) => {
  let value
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    (value.status !== "healthy" && value.status !== "degraded") ||
    !validTimestamp(value.checked_at) ||
    !validReasons(value.reasons) ||
    !isRecord(value.components)
  ) {
    return null
  }
  const { incidents, retention, scheduler } = value.components
  if (
    !isRecord(incidents) ||
    !isRecord(retention) ||
    !isRecord(scheduler) ||
    !["healthy", "degraded"].includes(incidents.status) ||
    !["healthy", "degraded"].includes(retention.status) ||
    !["healthy", "degraded"].includes(scheduler.status) ||
    !validReasons(incidents.reasons) ||
    !validReasons(retention.reasons) ||
    !validReasons(scheduler.reasons) ||
    !isRecord(retention.jobs) ||
    !Array.isArray(incidents.incidents)
  ) {
    return null
  }
  const anonymousCart = sanitizeRetentionJob(retention.jobs.anonymous_cart)
  const abandonedCheckout = sanitizeRetentionJob(
    retention.jobs.abandoned_checkout
  )
  if (anonymousCart === undefined || abandonedCheckout === undefined) {
    return null
  }
  const incidentTypes = []
  for (const incident of incidents.incidents) {
    if (
      !isRecord(incident) ||
      !["payment_tax_mismatch", "webhook_failure"].includes(
        incident.incident_type
      ) ||
      !validTimestamp(incident.recorded_at)
    ) {
      return null
    }
    incidentTypes.push(incident.incident_type)
  }
  const dependencies = sanitizeDependencies(value.dependencies)
  if (dependencies === null) {
    return null
  }
  const redisLatencyMs = scheduler.redis_latency_ms
  if (
    redisLatencyMs !== null &&
    (typeof redisLatencyMs !== "number" ||
      !Number.isFinite(redisLatencyMs) ||
      redisLatencyMs < 0)
  ) {
    return null
  }
  return {
    checkedAt: value.checked_at,
    components: {
      incidents: { status: incidents.status, incidentTypes },
      retention: {
        status: retention.status,
        abandonedCheckout,
        anonymousCart,
      },
      scheduler: {
        status: scheduler.status,
        redisLatencyMs,
      },
    },
    dependencies,
    reasons: value.reasons,
    status: value.status,
    version:
      typeof value.version === "string" && SHA_PATTERN.test(value.version)
        ? value.version
        : "unknown",
  }
}

export const evaluateOperationsHealthResponse = ({
  body,
  forceAlert = false,
  handlesBody,
  handlesHttpStatus,
  httpStatus,
  now = new Date(),
  readyHttpStatus,
  shelvesBody,
  shelvesHttpStatus,
  sourceErrors = [],
}) => {
  if (
    typeof body !== "string" ||
    typeof handlesBody !== "string" ||
    typeof shelvesBody !== "string"
  ) {
    throw new TypeError("Operations observation bodies must be strings")
  }
  if (
    !Number.isInteger(httpStatus) ||
    httpStatus < 0 ||
    httpStatus > 599 ||
    !Number.isInteger(handlesHttpStatus) ||
    handlesHttpStatus < 0 ||
    handlesHttpStatus > 599 ||
    !Number.isInteger(readyHttpStatus) ||
    readyHttpStatus < 0 ||
    readyHttpStatus > 599 ||
    !Number.isInteger(shelvesHttpStatus) ||
    shelvesHttpStatus < 0 ||
    shelvesHttpStatus > 599
  ) {
    throw new TypeError("Operations HTTP statuses must be bounded")
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Operations observation time must be valid")
  }
  if (
    !Array.isArray(sourceErrors) ||
    sourceErrors.some(
      (error) => typeof error !== "string" || !REASON_PATTERN.test(error)
    )
  ) {
    throw new TypeError("Operations source errors must be machine codes")
  }

  const reasons = new Set(sourceErrors.map((error) => `source_error:${error}`))
  const payload = parsePayload(body)
  const handles = parseCatalogHandles(handlesBody)
  const shelves = parseCatalogShelves(shelvesBody)
  if (!payload) {
    reasons.add("health_payload_invalid")
  } else {
    for (const reason of payload.reasons) {
      reasons.add(reason)
    }
    const responseAgeSeconds =
      (now.getTime() - Date.parse(payload.checkedAt)) / 1_000
    if (responseAgeSeconds > MAX_RESPONSE_AGE_SECONDS) {
      reasons.add("health_response_stale")
    }
    if (responseAgeSeconds < -MAX_CLOCK_SKEW_SECONDS) {
      reasons.add("health_response_from_future")
    }
    if (httpStatus !== 200 || payload.status !== "healthy") {
      reasons.add("operations_endpoint_unhealthy")
    }
  }
  if (readyHttpStatus !== 200) {
    reasons.add("readiness_endpoint_unhealthy")
  }
  if (handlesHttpStatus !== 200) {
    reasons.add("catalog_handles_endpoint_unhealthy")
  }
  if (!handles) {
    reasons.add("catalog_handles_payload_invalid")
  } else if (handles.count === 0) {
    reasons.add("catalog_handles_empty")
  }
  if (shelvesHttpStatus !== 200) {
    reasons.add("catalog_shelves_endpoint_unhealthy")
  }
  if (!shelves) {
    reasons.add("catalog_shelves_payload_invalid")
  } else {
    if (shelves.count === 0) {
      reasons.add("catalog_shelves_empty")
    }
    if (shelves.productCount === 0) {
      reasons.add("catalog_shelf_products_empty")
    }
  }
  if (forceAlert) {
    reasons.add("forced_acceptance_alert")
  }

  const reasonList = [...reasons].toSorted()
  return {
    schemaVersion: 1,
    status: reasonList.length === 0 ? "healthy" : "alert",
    environment: "staging",
    evaluatedAt: now.toISOString(),
    catalog: {
      handles: { count: handles?.count ?? null, httpStatus: handlesHttpStatus },
      shelves: {
        count: shelves?.count ?? null,
        httpStatus: shelvesHttpStatus,
        productCount: shelves?.productCount ?? null,
      },
    },
    httpStatus,
    readyHttpStatus,
    endpoint: payload,
    reasons: reasonList,
  }
}

export const renderOperationsObservationMarkdown = (report) => {
  if (!isRecord(report) || typeof report.status !== "string") {
    throw new TypeError("Operations observation report is required")
  }
  const endpoint = report.endpoint
  const lines = [
    "# Staging operations observation",
    "",
    `- Status: \`${report.status}\``,
    `- Evaluated: \`${report.evaluatedAt}\``,
    `- Operations HTTP status: \`${report.httpStatus}\``,
    `- Readiness HTTP status: \`${report.readyHttpStatus}\``,
    `- Catalog handles: HTTP \`${report.catalog?.handles.httpStatus ?? "invalid"}\`, count \`${report.catalog?.handles.count ?? "invalid"}\``,
    `- Catalog shelves: HTTP \`${report.catalog?.shelves.httpStatus ?? "invalid"}\`, shelves \`${report.catalog?.shelves.count ?? "invalid"}\`, memberships \`${report.catalog?.shelves.productCount ?? "invalid"}\``,
    `- Commit: \`${endpoint?.version ?? "unknown"}\``,
    `- Scheduler: \`${endpoint?.components.scheduler.status ?? "invalid"}\``,
    `- Redis latency ms: \`${endpoint?.components.scheduler.redisLatencyMs ?? "n/a"}\``,
    `- Retention: \`${endpoint?.components.retention.status ?? "invalid"}\``,
    `- Anonymous carts: \`${endpoint?.components.retention.anonymousCart?.status ?? "missing"}\`, scanned \`${endpoint?.components.retention.anonymousCart?.scanned ?? "n/a"}\`, deleted \`${endpoint?.components.retention.anonymousCart?.deleted ?? "n/a"}\``,
    `- Abandoned checkouts: \`${endpoint?.components.retention.abandonedCheckout?.status ?? "missing"}\`, scanned \`${endpoint?.components.retention.abandonedCheckout?.scanned ?? "n/a"}\`, deleted \`${endpoint?.components.retention.abandonedCheckout?.deleted ?? "n/a"}\``,
    `- Incident latches: \`${endpoint?.components.incidents.incidentTypes.join(", ") || "none"}\``,
    "",
    "## Dependencies",
    "",
  ]
  lines.push(
    ...(endpoint?.dependencies.length
      ? endpoint.dependencies.map(
          (dependency) =>
            `- \`${dependency.name}\`: \`${dependency.status}\` (${dependency.durationMs} ms)`
        )
      : ["- None reported"])
  )
  lines.push("", "## Alert reasons", "")
  lines.push(
    ...(report.reasons.length
      ? report.reasons.map((reason) => `- \`${reason}\``)
      : ["- None"])
  )
  lines.push("")
  return lines.join("\n")
}
