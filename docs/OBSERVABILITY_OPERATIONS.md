# Observability and alert operations

This runbook defines the production signals, service objectives, alert owners,
and safe first responses for the Backend and Storefront. It is the operational
contract for `/live`, `/ready`, `/health/scheduler`, `/health/retention`, and
`/health/operations`, plus the standard Product list, Product-handle,
merchandising-shelf, and discography projections required to render the
Storefront catalog.

The system records aggregate state and machine codes only. Health payloads,
metrics, retained monitor artifacts, and incident latches must never contain
customer identifiers, addresses, cart/order/payment IDs, request URLs, query
strings, browser identifiers, provider payloads, secrets, or raw exception
text.

## Signal architecture

- `/live` proves only that a process can answer HTTP. It includes the immutable
  accepted Git SHA when Railway or `COMMIT_SHA` supplies one.
- `/ready` performs bounded dependency probes. Backend production readiness
  also checks payment, tax, notification, payment-lifecycle, search, object
  storage, and Admin RBAC configuration without making provider mutations or
  exposing configuration values.
- `/health/scheduler` reports the checkout-reconciliation heartbeat, incident
  latch, Redis availability, and measured Redis round-trip latency.
- `/health/retention` reports daily anonymous-cart and abandoned-checkout job
  state plus aggregate scanned/deleted/protected counts. It never reports a
  record identifier.
- `/health/operations` aggregates readiness, scheduler, retention, payment/tax
  mismatch, and webhook-processing state. A component reason or dependency
  error makes the endpoint fail closed with `503`.
- The staging scheduler monitor runs every ten minutes. The staging operations
  monitor runs on the alternate ten-minute boundary and again at `05:03 UTC`,
  after both retention jobs. The operations monitor also authenticates a
  bounded standard Product read, one-record Product-handle read, public shelf
  projection, and one-record discography read. It alerts on non-200, malformed,
  empty-catalog, or empty-membership responses and retains only response
  statuses and aggregate counts. Each monitor opens or updates one GitHub issue
  on failure, closes it after recovery, and retains sanitized daily/manual/alert
  evidence for 30 days.
- Backend and Storefront request completion events are fixed-schema JSON with
  request, trace, span, service, environment, and commit identity. Paths,
  queries, IP addresses, user agents, headers, bodies, and raw errors are
  deliberately absent.
- Browser telemetry posts same-origin without credentials. The accepted schema
  contains only the Web Vital name/rating/rounded value or an already-normalized
  framework error digest and boundary scope.

An alert observation is expected to make the monitor job fail after the issue
is reconciled. It must still upload and deliver the real sanitized
`observation.md`; `steps.evaluate.outputs.artifact_path` is a directory, not a
file. The issue step appends the fixed report filename before reading it. The
`observation_evaluation_failed` fallback is reserved for a genuinely missing
report and must be investigated as a monitor defect, not presented as the
underlying service alert.

OpenTelemetry initializes from the generated server preload before Medusa
loads. Automatic instrumentation is deliberately limited to PostgreSQL/Knex,
Redis/ioredis, and Node runtime signals. The Backend framework seam creates the
HTTP server spans without attaching a URL, route parameter, query, header, or
body. Project boundaries create search, storage, Stripe, tax, email, queue, and
scheduled-job spans plus the `rr.operation.calls` and
`rr.operation.duration` RED metrics using fixed operation and result values.
Redis query text retains only the validated command name. Automatic HTTP,
Undici, and AWS instrumentation is disabled because provider URLs can contain
postal codes or credentials and object-storage attributes can contain private
keys.

Production exports over OTLP to a collector or compatible backend when
configured. Railway preserves `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_PROTOCOL`,
`OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, and `OTEL_SDK_DISABLED` for
both applications. When the Backend has neither an OTLP endpoint nor explicit
trace/metric exporter, it selects `none`; local startup therefore never probes
an implicit localhost collector. Never place OTLP headers in a public
environment variable or print them during acceptance. The OpenTelemetry
project recommends a collector for production and describes OTLP as the
lossless, broadly supported transport:
<https://opentelemetry.io/docs/languages/js/exporters/>.

The Backend emits `rr.http.server.requests` and `rr.http.server.duration` by
method and status class. Storefront emits the same HTTP pair, bounded provider
read duration/count, and accepted browser-event count. A collector may derive
span metrics for PostgreSQL/Knex and Redis, but alerts must continue to use only
low-cardinality operation names and must not enable query parameters or full
SQL/Redis arguments.

## Service objectives

Objectives are evaluated over a rolling 30-day window unless an alert below
uses a shorter safety window.

| Surface                              | Objective                                                                                 | Measurement                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Storefront document/API availability | 99.9% non-5xx                                                                             | Server RED request counter, excluding `/live` and synthetic acceptance routes |
| Backend Store/Admin API availability | 99.9% non-5xx                                                                             | Server RED request counter, excluding health probes                           |
| Public catalog projection integrity  | 100% successful synthetic probes across Products, handles, shelves, and discography; at least one Product and one shelf membership | Staging operations monitor                                                    |
| Storefront API latency               | p95 under 500 ms, p99 under 1.5 s                                                         | Server request-duration histogram by bounded route family and status class    |
| Backend read latency                 | p95 under 750 ms, p99 under 2 s                                                           | Server request-duration histogram by bounded route family and status class    |
| Checkout mutation latency            | p95 under 2 s, p99 under 5 s                                                              | Checkout operation-duration histogram; payment-provider wait is included      |
| Dependency readiness                 | 99.95% successful probes                                                                  | `/ready` and operations dependency checks                                     |
| Checkout reconciliation              | Successful heartbeat within 10 minutes; zero unresolved incident latches                  | `/health/scheduler`                                                           |
| Retention execution                  | Each scheduled job reports within 36 hours                                                | `/health/retention` and daily retained artifact                               |
| Webhook processing                   | 99.9% accepted valid lifecycle deliveries; zero 24-hour processing latches                | Lifecycle response metrics and incident health                                |
| Payment/tax consistency              | Zero accepted mismatches                                                                  | Checkout validation incident latch                                            |
| Core Web Vitals                      | p75 LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1, split mobile/desktop only in the telemetry backend | Privacy-bounded browser events                                                |

The Core Web Vitals targets follow the current public thresholds and percentile
method documented by web.dev:
<https://web.dev/articles/vitals>.

## Severity and ownership

- `P0`: confirmed paid-order corruption, double charge, or active disclosure.
  Page the engineering owner immediately; notify the business owner and payment
  operations without waiting for a second sample. Do not mutate records until
  evidence is preserved.
- `P1`: checkout safety boundary, payment/tax mismatch, webhook processing,
  readiness, database, Redis, storage, or sustained 5xx availability risk.
  The on-call engineering owner acknowledges within 15 minutes and escalates to
  the provider/platform owner after the first safe triage pass.
- `P2`: degraded latency, stale retention evidence, elevated Web Vitals, or
  non-critical capacity risk. The engineering owner acknowledges within four
  business hours and schedules corrective work before the next release.
- `P3`: trend or maintenance warning without current user impact. Review in the
  weekly operations pass.

The default owner is the on-call engineering role. Payment/tax and refund
incidents add the business/finance owner. Email adds the customer-support owner.
Railway/Redis/PostgreSQL/object-storage incidents add the infrastructure owner.

## Alert catalog

| Alert                             | Trigger                                                                                                | Severity                                       | Owner and escalation                                  | First-response runbook                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Redis unavailable or reconnecting | Any production connection error/reconnect event, readiness error, or operations `redis_unavailable`    | P1                                             | Engineering → infrastructure/Redis provider           | [Redis](#redis-unavailable-reconnecting-or-slow)        |
| Redis latency high                | Scheduler round trip ≥250 ms once or p95 ≥100 ms for 10 minutes                                        | P2; P1 with checkout impact                    | Engineering → infrastructure                          | [Redis](#redis-unavailable-reconnecting-or-slow)        |
| BullMQ/reconciliation stalled     | Missing/stale (>10 min), future, skipped, failed, or latched scheduler heartbeat                       | P1                                             | Engineering → infrastructure                          | [Scheduler](#scheduler-stall-or-reconciliation-backlog) |
| Reconciliation backlog            | Failed/held-for-review/capped/scan-window/time-cap result                                              | P1                                             | Engineering + payment operations                      | [Scheduler](#scheduler-stall-or-reconciliation-backlog) |
| Payment/tax mismatch              | Any `payment_tax_mismatch` latch                                                                       | P1; P0 if charge/order divergence is confirmed | Engineering + finance/payment operations              | [Payment/tax](#payment-or-tax-mismatch)                 |
| Webhook processing failure        | Any valid-delivery 503 latch; invalid-signature 400s are security-rate telemetry, not this alert       | P1                                             | Engineering → Stripe/platform                         | [Webhooks](#payment-lifecycle-webhook-failure)          |
| Readiness failure                 | Two consecutive external probes or any Railway rollout health failure                                  | P1                                             | Engineering → failing dependency owner                | [Readiness](#readiness-or-capability-failure)           |
| Capability incomplete             | Any production `capability_*` readiness error                                                          | P1 during rollout; P2 before release           | Engineering → relevant provider owner                 | [Readiness](#readiness-or-capability-failure)           |
| Public catalog projection failure  | Products, handles, shelves, or discography are non-200, malformed, empty, or contain no visible shelf memberships | P1                                              | Engineering → Backend/catalog owner                   | [Catalog](#public-catalog-projection-failure)           |
| Database saturation/unavailable   | Probe error, probe ≥1 s, connection wait p95 ≥250 ms, or pool ≥85% busy for 10 min                     | P1                                             | Engineering → PostgreSQL provider                     | [Database](#database-saturation-or-failure)             |
| Object storage unavailable        | HeadBucket error or ≥3.5 s                                                                             | P1                                             | Engineering → object-storage provider                 | [Storage](#storage-availability-or-capacity)            |
| Object storage capacity           | Platform volume/object store ≥80% warning; ≥90% critical                                               | P2/P1                                          | Infrastructure → business owner if uploads must pause | [Storage](#storage-availability-or-capacity)            |
| Elevated server errors            | 5xx ≥2% for 5 min and ≥20 requests; immediate P1 for checkout 5xx ≥1% and ≥5 requests                  | P1                                             | Engineering → implicated provider                     | [Errors](#elevated-error-or-latency-rate)               |
| Elevated server latency           | p95 above the relevant SLO for 10 min and ≥100 requests                                                | P2; P1 with checkout/readiness impact          | Engineering → implicated provider                     | [Errors](#elevated-error-or-latency-rate)               |
| Email failures                    | ≥5% failures and ≥5 sends over 10 min, or any required transactional notification exhausts retries     | P1                                             | Engineering + support → email provider                | [Notifications](#notification-failure)                  |
| Tax provider failures             | ≥2% failures and ≥5 calls over 10 min, quota exhausted, or readiness false while collection is enabled | P1                                             | Engineering + finance → tax provider                  | [Tax provider](#tax-provider-failure)                   |
| Retention stale/failed            | Missing, failed, future, or older than 36 hours                                                        | P2                                             | Engineering + privacy owner                           | [Retention](#retention-job-stale-or-failed)             |
| Poor Core Web Vitals              | Seven-day p75 exceeds LCP 2.5 s, INP 200 ms, or CLS 0.1 with ≥200 samples                              | P2                                             | Storefront engineering                                | [Web Vitals](#web-vitals-regression)                    |

Every alert notification must include environment, service, accepted commit,
alert code, first/last observed time, and a link to this runbook. It must not
include a request URL, customer or order data, or raw provider error.

## Runbooks

### Public catalog projection failure

1. Compare Backend and Storefront accepted SHAs, then probe the standard
   `/store/products?limit=1`, bounded `/store/products/handles?limit=1`,
   `/store/catalog/shelves`, and `/store/discography?limit=1&offset=0` reads
   with the staging publishable key.
2. If the standard Product route is healthy but a projection fails, inspect
   the custom Store-route error code and the Backend logs for the correlated
   fixed-schema error. Do not copy response bodies, keys, or Product records
   into the incident.
3. Review recent catalog model, query-graph, visibility, serializer, and shelf
   changes. Reproduce against production-shaped data without mutating the
   catalog.
4. Roll back or correct the exact failing commit. Do not bypass publishable-key
   sales-channel visibility or replace the projection with an unscoped Product
   query.
5. Resolve only after all four reads are 200 with nonempty validated
   projections, the Storefront homepage/catalog render products, and the next
   external observation is healthy.

### Redis unavailable, reconnecting, or slow

1. Confirm `/ready`, `/health/scheduler`, and `/health/operations`; compare the
   accepted SHA before correlating logs.
2. Check Railway Redis service state, memory, connections, evictions,
   persistence, and network latency. Do not flush keys or change eviction policy
   during triage.
3. Confirm rate limits, idempotency, locks, workflows, and scheduler health are
   failing closed where required.
4. If the outage persists, keep checkout mutations unavailable rather than
   bypassing distributed safety. Escalate to the Redis/platform owner.
5. Resolve only after readiness is healthy and the next reconciliation
   heartbeat completes without an incident latch.

### Scheduler stall or reconciliation backlog

1. Inspect the sanitized scheduler snapshot and retained observation artifact.
2. Check worker process health, Redis/BullMQ connectivity, lock wait/release,
   schedule delay, scan cap, and held-for-review count.
3. Reconcile Medusa order/payment/refund state with Stripe before any manual
   action. Never rerun completion blindly and never delete the health latch.
4. Follow `CHECKOUT_OPERATIONS.md` for approved recovery.
5. Resolve after a healthy completion and the full 24-hour incident observation
   window, or document the explicit risk acceptance.

### Payment or tax mismatch

1. Stop treating the affected checkout as safely complete. Preserve the
   correlated request/trace and accepted commit without copying customer data
   into the incident system.
2. Compare the immutable Medusa quote/evidence, payable cart total, payment
   amount/currency, tax provider/generation, and Stripe calculation identity.
3. Do not edit order totals, rebind evidence, issue a refund, or replay payment
   without finance/payment-operations approval.
4. Follow `TAX_CONTROL_OPERATIONS.md`, `TAX_RECORDS_AND_FILING.md`, and
   `CHECKOUT_OPERATIONS.md`.
5. Escalate to P0 if a charge/order divergence or double charge is confirmed.

### Payment lifecycle webhook failure

1. Distinguish an invalid-signature 400 from a valid delivery that could not be
   stored or queued. Only the latter opens the operational latch.
2. Check lifecycle capability readiness, event-bus/Redis state, database
   readiness, and the bounded lifecycle record status.
3. Allow Stripe's signed retry to recover the valid event. Do not fabricate or
   edit a provider event ID.
4. Resolve after the event is durably processed and the dependent payment/order
   state is reconciled.

### Readiness or capability failure

1. Identify the exact failed dependency/capability name; do not print its
   configuration value.
2. Compare the health version with the deployment SHA and stop the rollout if
   they differ.
3. For configuration failure, rotate/fix the secret or URL through Railway's
   secret boundary. Do not commit it or paste it into an issue.
4. For provider failure, confirm the provider status and timeout before retrying
   a release.
5. Resolve after two external healthy probes and a successful Railway health
   transition.

### Database saturation or failure

1. Check pool busy/wait duration, active connections, locks, slow statements,
   storage, and provider health.
2. Correlate traces to bounded operation names; do not enable query-value
   logging.
3. Cancel only a proven runaway query through an approved provider procedure.
   Do not restart or resize blindly.
4. Capture `EXPLAIN (ANALYZE, BUFFERS)` only on safe, representative staging
   data before an index/query change.
5. Resolve after readiness and pool/latency signals remain below threshold for
   15 minutes.

### Storage availability or capacity

1. Check the object-storage readiness probe, provider status, bucket policy,
   credentials, and Railway volume/object-store capacity.
2. Do not make the bucket public, rotate credentials without coordination, or
   delete media during incident response.
3. At 80% capacity, schedule reviewed cleanup/expansion. At 90%, pause optional
   uploads and escalate immediately.
4. Use the Admin Media Cleanup dry-run/review flow for any deletion.

### Elevated error or latency rate

1. Split by service, low-cardinality operation, status/result class, and
   accepted commit. Never group by raw URL, ID, email, or exception text.
2. Compare the release boundary and dependency/provider duration spans.
3. Roll back only through the documented Railway release path when the new SHA
   is causal and rollback does not cross an unsafe migration.
4. Escalate checkout or payment failures immediately; ordinary read degradation
   follows the sustained-window threshold.

### Notification failure

1. Confirm notification capability readiness and provider availability.
2. Check aggregate send/failure/retry counts by template class, never recipient.
3. Preserve idempotency keys and allow bounded retry; do not send duplicate
   order/refund messages manually.
4. Notify support if customer-facing delivery is delayed.

### Tax provider failure

1. Confirm the active collection mode and provider generation.
2. Check provider readiness, quota, bounded retry/result metrics, and Redis tax
   cache state.
3. Never silently switch providers, delete tax regions, zero rates, or disable
   tax collection to clear an alert. Follow `TAX_CONTROL_OPERATIONS.md` and ADR
   0007 for an explicit audited mode transition.
4. Escalate filing/evidence uncertainty to the finance/business owner.

### Retention job stale or failed

1. Inspect `/health/retention` and the daily sanitized artifact for status and
   aggregate counts.
2. Confirm the environment's explicit enablement decision and job worker state.
3. Run a read-only candidate count before enabling or manually invoking a job.
4. If heartbeat persistence was deployed after the current day's scheduled
   run, verify the prior aggregate completion log and keep the incident open
   until the next normal schedule writes a real heartbeat. Never synthesize or
   backdate retention evidence.
5. Do not lower the 37-day minimum, bypass payment/order protections, or delete
   carts directly.
6. Resolve after a successful scheduled run reports within the 36-hour window.

### Web Vitals regression

1. Confirm sample size and p75 over seven days; do not act on one browser event.
2. Compare by coarse device class only in the telemetry backend. Do not add URL,
   user, session, or navigation identifiers to the client schema.
3. Reproduce the affected surface with Lighthouse/Playwright and a real browser
   screenshot where layout is involved.
4. Check server latency, image/font loading, client bundle changes, long tasks,
   and layout reservation before optimizing.

## Release verification

Before declaring this section complete locally:

```sh
pnpm run qa:lint
pnpm run qa:observability-bootstrap
pnpm --filter backend run test
pnpm run qa:storefront:coverage
pnpm --filter backend run build
pnpm --filter remorseless-records-storefront run build
```

After the section's single push, require Root, Backend, and Storefront CI to pass
on the exact SHA. Then verify both Railway services expose the same SHA on
`/live` and `/ready`; the bounded Product-handle and merchandising-shelf probes
are 200 and nonempty; both external monitors are healthy; a manual forced-alert
exercise creates/updates the intended issue; and the next healthy run closes
it. Never exercise a provider mutation, payment, refund, tax-mode transition,
or production environment as part of alert acceptance.
