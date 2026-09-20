# Scheduled jobs

Medusa loads each default export in this directory and schedules it from the
file's exported `config`. The Redis workflow job worker uses a five-minute
BullMQ lock with a 30-second renewal setting. Checkout payment reconciliation
also acquires a unique-owner, five-minute application lock so a stalled retry
cannot overlap or release another run's lock. Before its sole money-moving
workflow call, it durably writes a non-PII attempt marker to the cart. A cart
with any existing marker is held for operator review instead of being completed
again after an ambiguous response or process crash.

Medusa 2.18's Redis scheduler is pinned with a pnpm patch so `scheduledFor`
uses BullMQ's repeat-job `prevMillis` execution time, with enqueue time plus
delay as the non-repeat fallback. The
root `qa:workflow-scheduler-timestamps` gate verifies that the installed root
dependency retains this correction; the production Backend build applies
the same pinned patch to its standalone dependency tree.

The same pinned worker patch validates a bounded BullMQ scheduled-job ID and
hashes it with SHA-256 before passing it into the Medusa workflow. Only the
digest enters workflow input and the scheduled handler context. If the ID is
absent or malformed, the job still runs under the existing retry behavior and
logs `bull_job_identity_verified:false` with a null digest. The executable
`qa:workflow-scheduler-timestamps` contract exercises both paths without a
Redis connection. This evidence is forward-looking: historical failed jobs
cannot be joined to a payment or cart from these new logs alone.

Checkout and TaxRate.io quota scheduled runs emit a generated `run_id`, a UTC
start/end window, optional BullMQ ID digest, and a fixed failure stage. A
checkout completion reports `carts_examined` and `carts_completed` from its
bounded reconciliation result; disabled runs and runs skipped by the lock
report zero,
while failures report null counts with `counts_available:false`. Tax quota
reports `redis_snapshots_validated`,
`quota_rows_returned`, and `quota_writes_confirmed`. Rows returned are the
validated results of bounded list calls, not database rows scanned. Confirmed
writes count verified create/update responses, including an equal-snapshot
update, not semantic value changes. None of these tax quota counters describes
payment or order impact. Logs contain neither raw BullMQ IDs nor cart,
payment, or provider identifiers. On failure, the tax job emits null counts
and `counts_available:false` because a partially completed run cannot supply
a complete set of counters.

| Job                                | Schedule (UTC)    | Default  | Purpose                                                                                                          |
| ---------------------------------- | ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `reconcile-checkout-payments`      | Every two minutes | Disabled | Complete an old incomplete cart with exactly one authorized/captured official Stripe session and no linked order |
| `reconcile-stripe-lifecycle-events` | Every five minutes | Enabled | Retry received, failed, or stale refund/dispute receipts under a distributed event lock                              |
| `reconcile-tax-evidence`           | Hourly at `:23`   | Enabled  | Recheck tax-bound Stripe payments, refund reversals, disputes, and failed Stripe Tax associations                |
| `remove-expired-anonymous-carts`   | `04:17` daily     | Disabled | Soft-delete old incomplete carts with no customer or email                                                       |
| `remove-abandoned-guest-checkouts` | `04:37` daily     | Disabled | Cancel only safe unused sessions, then soft-delete old guest checkouts containing PII                            |
| `sync-taxrate-io-quota`             | Every five minutes | Enabled | Reconcile the bounded TaxRate.io quota snapshot between Redis and the tax-control module                         |

Every job is bounded, rechecks mutable state, and emits only aggregate results.
Payment reconciliation has explicit scan, attempt, and run-time caps; warns on
scheduler, event-loop, lock, backlog, or `heldForReview` pressure; and never
creates or confirms a payment. The installed Medusa boundary keeps its per-cart
lock, order-link recheck, authorization guard, and stable provider idempotency
keys for capture and refund. Stripe lifecycle and tax reconciliation retrieve
provider state but cannot create, capture, cancel, or refund a payment.
Retention never deletes completed, order-linked, customer-owned, recently
updated, or unresolved/successful-payment carts; it removes only unused
pending, canceled, or error sessions through Medusa's workflow.

Each checkout reconciliation record refreshes an allowlisted Redis heartbeat
with a 15-minute TTL. Attention, skipped, and failed records also create a
24-hour incident latch that a later healthy run cannot erase. The public
`GET /health/scheduler` route returns 200 only when Redis responds, the latest
completed heartbeat is at most 10 minutes old, and no incident is latched; all
other states return a bounded 503 response. The external staging workflow polls
that route every 10 minutes and reconciles a deduplicated GitHub issue without
requiring Redis or Railway credentials.

Configuration and incident procedures are documented in
[`../../../docs/CHECKOUT_OPERATIONS.md`](../../../docs/CHECKOUT_OPERATIONS.md).
