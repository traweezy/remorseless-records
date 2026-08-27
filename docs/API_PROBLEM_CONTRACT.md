# API problem and request-correlation contract

## Scope

Custom Storefront and Backend APIs use the shared contract in
`docs/openapi/api-problems.yaml`. Native Medusa endpoints retain Medusa's
versioned error envelope because the Admin SDK and Dashboard consume it. Do not
replace the native envelope without a Medusa compatibility test and a separate
reviewed migration.

The August 26, 2026 inventory found 25 Storefront and 55 Backend custom route
handlers. The repository had no OpenAPI document and only eight files emitted
`application/problem+json`. This slice introduces the reusable OpenAPI 3.1
components and converts the shared Storefront guards, Storefront BFF errors,
Backend security/rate-limit guards, checkout-status errors, and tax-reporting
errors. Remaining handler-specific Backend envelopes are tracked in
`docs/PRODUCTION_HARDENING_PLAN.md`.

## Correlation rules

- Accept `X-Request-Id` only when it is 1–128 characters and matches
  `[A-Za-z0-9][A-Za-z0-9._:-]*`; otherwise generate a UUID.
- Accept only a structurally valid W3C `traceparent` with non-zero trace and
  parent IDs. Preserve the trace ID and sampling flags, but create a new span ID
  for every service or upstream hop.
- Return `X-Request-Id` and `traceparent` on every Backend response traversing
  project API middleware and every Storefront response traversing
  `src/proxy.ts`.
- Include `request_id` and `trace_id` in every project-owned problem body.
- Propagate request and trace context from Storefront API routes to Medusa cart,
  checkout, product, bundle, news, contact, privacy, region, receipt, status,
  and tax-link calls.

Never use a customer email, cart ID, order ID, session ID, credential, request
body, URL query, or provider payload as a request or trace identifier.
Never put per-request correlation headers into a shared-cache key. A correlated
API fetch must be explicitly uncached or use a cache layer whose identity omits
the request and trace headers.

## Problem response rules

Problem responses use `Content-Type: application/problem+json`, `Cache-Control:
no-store`, and the required fields in the OpenAPI component. `detail` is safe
customer-facing text. `code` is a stable machine-readable identifier. Validation
failures may add `errors[]` entries containing only a field path and safe
validation message.

Problem diagnostics must not add stack traces, caught exception messages,
provider response bodies, credentials, or PII. Purpose-bound semantic
extensions, such as the signed-cart checkout projection, may retain fields
required by the existing client contract; those responses remain `no-store`
and the extension data is never copied into problem logs. A failed
Storefront-to-Backend contact or privacy request is mapped to a safe 502 problem
even when the Backend returns a more detailed message.

## Structured logs

Backend completion events contain only:

- `event`, `service`, `environment`, and `commit_sha`;
- `method`, `status`, and `duration_ms`;
- `request_id`, `trace_id`, and `span_id`;
- `problem_code` when a shared problem helper handled the failure.

Storefront problem events use the same deployment and correlation fields plus
the status and problem code. They intentionally omit paths, query strings,
headers, bodies, exception messages, and provider data. HTTP 5xx events log at
error, 4xx at warning, and successful Backend requests at info.

## SLO-ish acceptance targets

- 100% of staged custom responses expose a bounded request ID and valid
  `traceparent`.
- 100% of project-owned problem responses use the documented media type and
  required correlation fields.
- 0 secrets, credentials, PII fields, request bodies, or provider payloads in
  correlation/problem logs.
- Correlation generation and response decoration remain local and non-blocking;
  no database, Redis, or network dependency is introduced at ingress.

Verify these targets in unit/contract tests and with exact-SHA staging probes.
When investigating an incident, search by `request_id` first, then use
`trace_id` to follow Storefront-to-Backend hops.

## Remaining work

- Enumerate custom endpoints and their response references in a complete
  generated or contract-first OpenAPI document.
- Convert remaining explicit custom Backend route errors without changing
  native Medusa response compatibility.
- Add a supported Storefront request-completion timing hook; the current proxy
  can correlate responses but cannot observe the final route status/duration.
- Add dynamic correlation at Medusa's early Express loader so framework-owned
  Admin static responses and built-in pre-router failures are covered without
  weakening the static security-header patch.
- Export the structured events and W3C spans to the selected production
  telemetry backend after retention, sampling, and cost are approved.
