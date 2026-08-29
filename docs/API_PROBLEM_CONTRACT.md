# API problem and request-correlation contract

## Scope

Custom Storefront and Backend APIs use the shared contract in
`docs/openapi/api-problems.yaml`. The deterministic
`docs/openapi/custom-endpoints.generated.json` inventory references those
components for every repository-owned route. Native Medusa endpoints retain
Medusa's versioned error envelope because the Admin SDK and Dashboard consume
it. Do not replace the native envelope without a Medusa compatibility test and
a separate reviewed migration.

The corrected August 29, 2026 inventory finds 30 Storefront and 55 Backend
route files. They export 112 operations: 80 Backend and 32 Storefront. The
generated document contains 110 unique path/method pairs because `/live` and
`/ready` are deliberately implemented by both services. It records source
ownership, path parameters, error-envelope ownership, generic success and
error references, and the bounded Storefront provider matrix. CI reruns the
source inventory and fails when the checked-in artifact is stale.

The detailed component document retains exact schemas and response sets for
eight security-sensitive paths: legacy key exchange, Stripe lifecycle, public
search, the two public form BFFs, their two internal Backend targets, and the
channel-scoped product-handle feed. The generated document complements those
detailed paths; it does not invent endpoint-specific payload schemas that the
source does not declare.

## Error ownership matrix

| Boundary | Failure class | Status | Envelope owner |
| --- | --- | ---: | --- |
| Project custom route | validation or malformed provider input | 400 | `ApiProblem` |
| Project custom route | proof/authentication failure | 401 | `ApiProblem` |
| Project custom guard | origin/authorization rejection | 403 | `ApiProblem` |
| Project custom route | conflict | 409 | `ApiProblem` |
| Project custom route | upstream/provider failure | 502, 503, or timeout 504 | `ApiProblem` |
| Project custom route | unexpected internal failure | 500 or retryable 503 | redacted `ApiProblem` |
| Native Medusa auth | unauthenticated | 401 | `NativeMedusaError` |
| Native Medusa Admin/RBAC | forbidden | 403 | `NativeMedusaError` |
| Native Medusa route | validation, conflict, or not found | mapped 4xx | `NativeMedusaError` |
| Native Medusa route | unexpected failure | 500 | redacted `NativeMedusaError` |

The Backend regression suite invokes Medusa's installed error handler for
native unauthenticated, forbidden, invalid-data, and unexpected failures and
also proves the project has not registered a replacement global error handler.
This guards Dashboard/Admin SDK compatibility while custom handlers migrate
independently.

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
- Apply an eight-second default deadline to every Medusa SDK request that does
  not declare a route-specific deadline. Correlated Medusa requests combine
  caller cancellation with that deadline. Cart completion and other explicitly
  longer operations retain their reviewed route-specific deadlines.
- Apply the same bounded provider signal to Meilisearch, news, shelves, and
  discography reads. Discography additionally stops after 25 pages instead of
  trusting an unbounded provider pagination sequence.

Never use a customer email, cart ID, order ID, session ID, credential, request
body, URL query, or provider payload as a request or trace identifier.
Never put per-request correlation headers into a shared-cache key. A correlated
API fetch must be explicitly uncached or use a cache layer whose identity omits
the request and trace headers.

## Public form BFF proof rules

- `PUBLIC_FORM_BFF_SECRET` is a distinct, server-only 32+ byte secret shared by
  Backend and Storefront. It must not use a `NEXT_PUBLIC_*` name or reuse a
  checkout, receipt, cookie, JWT, or webhook key.
- The Storefront signs `v1`, the endpoint purpose, Unix timestamp, and a SHA-256
  digest of the exact serialized request body. Contact and privacy use different
  purpose strings, so a proof cannot cross endpoints.
- Backend requires the preserved raw body and accepts a proof only within a
  30-second clock-skew window using constant-time signature comparison.
- The publishable Store API key remains necessary for Medusa routing but is not
  authorization for email delivery. Missing, stale, malformed, body-mismatched,
  or cross-purpose proofs fail closed before validation or provider access.
- Both Backend routes share a rate-limit bucket and a 16 KiB body ceiling. The
  Storefront keeps its endpoint-specific origin and abuse guards.
- Storefront-to-Backend fetches abort after eight seconds. Backend-to-Resend
  fetches abort after five seconds and carry an idempotency key. A provider
  response with an error object is a failure even when the SDK call resolves.

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
Storefront-to-Backend contact or privacy request is mapped to a safe 502
problem, or a 504 when the deadline expires, even when the Backend returns a
more detailed message. Backend configuration, proof, validation, timeout, and
provider failures use correlated safe problems and never include form values.

## Structured logs

Backend completion events contain only:

- `event`, `service`, `environment`, and `commit_sha`;
- `method`, `status`, and `duration_ms`;
- `request_id`, `trace_id`, and `span_id`;
- `problem_code` when a shared problem helper handled the failure.

Storefront problem events use the same deployment and correlation fields plus
the status and problem code, with a fixed non-sensitive `message` so Railway's
human-readable log view is not blank after it promotes JSON fields into the
record. They intentionally omit paths, query strings, headers, bodies,
exception messages, and provider data. Backend completion events log 5xx at
error, 4xx at warning, and successful requests at info. Storefront problem
events log 5xx at error and expected 4xx at stdout/info because Railway
classifies `console.warn` output as an error-level record.

Railway may expose application JSON fields directly on the log record or retain
a Backend logger event as JSON inside `message`. Do not accept a deployment by
searching only the display message. Pipe the bounded exact-deployment JSONL
through the checked verifier, supplying values from the response and deployment:

```bash
railway logs --service Storefront --environment staging --json --lines 200 \
  | node scripts/verify-railway-runtime-log.mjs \
      --commit-sha "$STAGING_COMMIT_SHA" \
      --environment staging \
      --event api.problem \
      --level info \
      --problem-code invalid_request \
      --request-id "$ACCEPTANCE_REQUEST_ID" \
      --service storefront \
      --status 400 \
      --trace-id "$ACCEPTANCE_TRACE_ID"
```

The verifier normalizes both record shapes and fails closed when the exact
request ID is absent or any expected event, severity, service, environment,
problem, status, correlation, or commit field differs. Its parser is bounded to
10 MiB and never echoes rejected log contents.

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

- Verify whether any external consumer still calls the legacy `/key-exchange`
  route, then retire it if the validated Storefront environment key is the sole
  consumer path.
- Export the structured events and W3C spans to the selected production
  telemetry backend after retention, sampling, and cost are approved.

Regenerate and verify the route inventory from the repository root:

```bash
pnpm run api:contract:generate
pnpm run qa:api-contract
```
