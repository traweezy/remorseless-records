# Checkout operations and incident runbook

This runbook covers the Medusa Payment Module + official Stripe provider
checkout. It is intentionally limited to local development and Railway
staging/test mode until a separate production change is approved.

Never paste secret keys, webhook secrets, client secrets, card data, customer
email, delivery addresses, or full Stripe/Medusa objects into logs, tickets, or
chat. Use aggregate counts, status values, and opaque identifiers only when an
identifier is necessary for an incident.

## Service objectives and alerts

Initial staging objectives:

- 99% of semantic checkout API requests finish within 2 seconds, excluding
  Stripe-hosted authentication.
- Payment preparation and completion have explicit 12-second and 25-second
  browser timeouts.
- A payment confirmed without an order reaches a durable order or an
  actionable alert within 10 minutes.
- No duplicate charge or order is acceptable.
- Any checkout reconciliation `failed > 0`, `heldForReview > 0`, safety cap,
  webhook failure, or amount-validation failure requires investigation.

Useful aggregate log events:

- `job.checkout_reconciliation.completed`
- `job.checkout_reconciliation.attention`
- `job.checkout_reconciliation.skipped`
- `job.checkout_reconciliation.failed`
- `job.retention.anonymous_cart.completed`
- `job.retention.abandoned_checkout.completed`
- `job.retention.<job>.disabled` or `job.retention.<job>.failed`
- `checkout_payment_*` validation errors from the complete-cart hook
- `[stripe-order-sync] synchronized <count> payment reference(s)`

## Tax collection decisions at checkout

Every prepared checkout has one explicit tax collection mode:

- `collect` uses the selected TaxRate.io or Stripe Tax provider and fails
  closed if an exact coherent quote cannot be produced;
- `disabled` creates a controlled $0.00 line for every item and shipping
  subject, calls no tax provider or quota path, and displays **Tax not
  collected**; and
- legacy or incomplete lines are `unknown` and must never be presented as a
  deliberate disabled decision.

The mode, generation, fingerprint, provider when applicable, and Stripe Tax
calculation when applicable are frozen into the prepared payment. A later
Admin disable, re-enable, or provider change applies only to new/unprepared
quotes. Do not rewrite a prepared PaymentIntent or tax line to make it match the
new setting.

For disabled mode, Stripe still processes the customer payment. The binding
path verifies amount, currency, cart, generation, fingerprint, and metadata but
requires no Tax calculation and rejects any attached Tax hook. The resulting
payment evidence has null provider/calculation/transaction identities and is
not missing evidence.

If checkout says **Tax not collected**, verify the exact disabled tax-line code
and mode metadata before treating the presentation as authoritative. Never
infer disabled mode from a provider returning a legitimate zero rate.

## Customer submission disclosure and deferred payment loading

The paid and free checkout paths render the same disclosure immediately before
their submit control. It states the exact amount that action will charge,
current shipping and tax presentation (including controlled **Tax not
collected**), the fulfillment processing window, and direct Terms, Privacy,
Shipping, and Returns links. The submit button references the disclosure with
accessible description semantics. Treat a missing, stale, duplicated, or
non-associated disclosure as a release-blocking checkout defect.

An empty or otherwise non-payable checkout must not load Stripe.js. The
Payment Element imports Stripe's pure loader only when a prepared payable
checkout requires it. Both the default and pure loader distributions are
repository-patched to permit only the pinned Stripe script URLs through the
`remorseless-stripe-js` Trusted Types policy, and the production bundle verifier
checks the emitted loader chunk. If Stripe appears on an empty checkout, stop
the release and inspect the payment-section boundary; do not make the script
global to hide a timing issue.

## Fail-closed checkout data boundary

Storefront payment preparation, checkout projection/revision, tax identity,
Stripe-session metadata, and order-receipt rendering share explicit provider
data readers. Backend cart completion applies the same rules before Medusa may
complete a payable cart. Arrays are never accepted as object records, primitive
members are never filtered out of relationship arrays, and JavaScript boolean
or object coercion is never accepted as money, quantity, generation, rate, or
Stripe minor-unit data.

Monetary fields accept only an explicit finite numeric literal, canonical
decimal string, or Medusa `{ value }` wrapper. Integer identities accept only a
safe integer or canonical integer string. The boundary also validates complete
item, shipping, tax-line, adjustment, payment-session, PaymentIntent, inventory,
client-secret, and receipt shapes before deriving a checkout state, revision,
payment reuse decision, completion decision, or customer receipt. A malformed
optional row invalidates the complete snapshot; it is not treated as absent.

If this boundary fails, retrieve the authoritative cart once and inspect the
aggregate coded error. Do not cast, stringify, filter, or replace the malformed
provider value to make checkout continue. A repeat failure is a provider or
stored-data incident: keep the cart uncompleted, retain Stripe test mode, and
use the reconciliation and exact-amount procedures below. Logs and tickets must
not include the cart object, PaymentIntent metadata, client secret, customer
email, or delivery address.

## Cart and fulfillment amount boundary

The Storefront validates every Medusa cart envelope before it reaches the
browser cache or a cart mutation response. A usable cart is a bounded USD
snapshot with unique structured line items, canonical quantities from 1 to
100, complete product/variant identities, explicit non-negative amounts, and
valid inventory policy. The shipping-option boundary likewise requires a
bounded, internally consistent list with unique option IDs, safe names,
recognized price types, and exact calculated-response identity. An invalid
calculated option is omitted; a malformed list invalidates the complete
delivery-method response.

Cart mutation JSON accepts numbers only. Numeric strings, booleans, nulls,
fractions, negative values, and quantities over 100 return the normal bounded
problem response without calling Medusa. The browser client independently
revalidates the response and reports `cart_response_invalid` without copying an
upstream payload into customer-visible text.

Backend per-item fulfillment uses the same fail-closed contract. It accepts at
most 100 structured cart rows, quantities from 1 to 100, non-negative shipping
configuration below the checkout maximum, and USD on both the cart and
provider configuration. It rejects primitive rows, missing identities,
coercive amounts or quantities, excessive aggregate work, currency mismatch,
and a calculated total outside the supported range. It never falls back from a
present malformed option value to a default price. An omitted provider
currency uses the documented USD default; an explicit non-USD value fails
closed.

Treat repeated `cart_response_invalid`, `shipping_unavailable`, or per-item
shipping validation failures as a provider/stored-data incident. Do not edit a
browser response, inject a fallback delivery price, or bypass the calculation.
Retrieve one authoritative cart and shipping-option response in the protected
environment, compare only allowlisted identities/counts/amounts, and keep
payment preparation blocked until the source record is corrected.

Checkout reconciliation records contain the fixed safe `message`, exact
deployment identity, `run_id`, `scheduled_for`, `started_at`,
`schedule_delay_ms`, `duration_ms`, `event_loop_delay_max_ms`, `lock_wait_ms`,
`lock_released`, and aggregate result fields, including `heldForReview`. They
intentionally omit cart, payment, order, customer, address, email, request
payload, provider-error, and stack values. Alert on `.attention`, `.skipped`,
or `.failed`; a healthy idle run emits `.completed` at info level.

### External scheduler and Redis monitor

Every reconciliation result also writes a bounded, allowlisted snapshot to
Redis. The latest snapshot expires after 15 minutes. Any `.attention`,
`.skipped`, or `.failed` result additionally writes a 24-hour incident latch;
later successful runs refresh the heartbeat but do not erase that evidence.
Persistence failures never suppress the original structured job record. They
instead make the health endpoint fail closed when its heartbeat expires.

`GET /health/scheduler` returns only aggregate scheduler fields and one of two
states:

- HTTP 200 with `status: healthy` requires Redis `PONG`, a completed heartbeat
  no older than 10 minutes, valid stored state, and no incident latch.
- HTTP 503 with `status: degraded` reports machine reason codes for unavailable
  Redis, missing/stale/future heartbeat, invalid state, an unhealthy latest
  result, or a latched incident.

The endpoint is intentionally public and `Cache-Control: no-store` so an
observer outside Railway can detect a shared Redis, BullMQ, worker, or Backend
failure. Its schema excludes run IDs, cart/payment/order/customer identifiers,
messages, request data, provider errors, and stacks.

The `Staging Scheduler Monitor` GitHub workflow polls this endpoint every 10
minutes. It fails closed on network errors, non-200 responses, or an invalid
schema. It also checks endpoint and heartbeat time independently, rejecting
replayed, future, or internally inconsistent ages. It stores only a sanitized
JSON/Markdown projection and creates or updates the exact
`Staging scheduler/Redis monitor alert` issue. A later healthy run comments on
and closes that issue. Manual, daily, and alert runs retain sanitized artifacts
for 30 days. Use the manual `force_alert` input to prove issue creation, then
run it normally to prove recovery closure; do not modify Redis keys to exercise
the alert path.

## Verify that an environment is safe to test

Do this before every staging payment session:

1. Confirm the Railway environment and service names show `staging`.
2. Confirm the storefront publishable key starts with `pk_test_`.
3. Confirm the backend secret key starts with `sk_test_` or is a restricted
   test key.
4. Retrieve the Payment Method Configuration with the Stripe CLI and verify
   `livemode` is `false`.
5. Retrieve the webhook endpoint and verify `livemode` is `false` and the URL is
   the staging backend's `/hooks/payment/stripe_stripe`.
6. Stop immediately if any object reports live mode.

Commands must be run with the staging/test key already supplied securely by
the environment. Do not print the key:

```bash
stripe payment_method_configurations retrieve pmc_...
stripe webhook_endpoints list --limit 20
```

The browser checkout is the canonical confirmation path and always supplies
`https://<staging-storefront>/checkout/return` to Stripe. If an isolated API
confirmation is explicitly needed for diagnostics, include the same return URL:

```bash
stripe payment_intents confirm pi_... \
  --payment-method pm_card_visa \
  --return-url https://<staging-storefront>/checkout/return
```

Omitting it from a direct API or CLI confirmation can trigger Stripe integration
error alerts and does not exercise the storefront's Payment Element return and
recovery lifecycle.

The approved payment methods are card, Link, Apple Pay, and Google Pay.
Delayed methods and BNPL must remain disabled for this release.

## Official webhook configuration

Endpoint:

```text
POST https://<staging-backend>/hooks/payment/stripe_stripe
```

Subscribed events:

- `payment_intent.amount_capturable_updated`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.partially_funded`

The backend must use the signing secret belonging to this exact endpoint.
Stripe signs the raw body; do not insert a custom JSON parser or proxy that
rewrites the body.

Local test forwarding:

```bash
stripe listen \
  --events payment_intent.amount_capturable_updated,payment_intent.succeeded,payment_intent.payment_failed,payment_intent.partially_funded \
  --forward-to localhost:9000/hooks/payment/stripe_stripe
```

Use the temporary `whsec_...` printed by `stripe listen` only for that local
process. In another terminal, a plumbing-only signature check can be generated
with:

```bash
stripe trigger payment_intent.succeeded
stripe trigger payment_intent.payment_failed
```

A generic CLI fixture proves delivery and signature handling, not the complete
cart/order relationship. The real checkout matrix below proves the lifecycle.

## Staging payment matrix

Use a future expiry such as `12/34`, any three-digit CVC, and a valid test
billing ZIP. These numbers are entered only in Stripe's Payment Element.

| Scenario           | Stripe test card      | Expected result                                           |
| ------------------ | --------------------- | --------------------------------------------------------- |
| Success            | `4242 4242 4242 4242` | One PaymentIntent, one Medusa order, confirmation receipt |
| 3DS authentication | `4000 0025 0000 3155` | Authentication UI, clean return/recovery, then one order  |
| Generic decline    | `4000 0000 0000 0002` | Safe decline copy; no order; retry remains possible       |
| Insufficient funds | `4000 0000 0000 9995` | Specific safe copy; no order                              |
| Expired card       | `4000 0000 0000 0069` | Expired-card copy; no order                               |
| Incorrect CVC      | `4000 0000 0000 0127` | CVC copy; no order                                        |
| Processing error   | `4000 0000 0000 0119` | Recoverable error or reconciliation; never duplicate      |
| Invalid number     | `4242 4242 4242 4241` | Inline validation before payment                          |

For every paid attempt, compare Medusa's exact raw major-unit amounts across
the cart, payment collection, payment session, and order. Tax calculation may
legitimately produce sub-cent precision. The customer-facing summary, receipt,
and email must show the cent-rounded payable amount, while Stripe must contain
the corresponding exact integer-cent amount produced once at the official
provider boundary. Do not infer correctness from formatted strings alone.

Repeat success with:

- one music release;
- merchandise;
- a fixed bundle;
- a mystery bundle;
- mixed product types;
- quantity greater than one;
- low-stock quantity;
- the only available shipping option;
- multiple shipping options.

Also edit quantity and remove a line directly in the checkout summary. The URL
must remain `/checkout`, completed steps must remain present, and the Stripe
frame must stay mounted under an updating overlay until the new revision is
prepared.

Inventory-blocked and zero-shipping-option carts must stop before payment. A
zero-total order must complete without a Stripe PaymentIntent.

## Customer-journey recovery matrix

Each case must yield one order/charge at most:

1. Double-click or press Enter twice on Place order.
2. Submit from two tabs sharing the same cart.
3. Refresh while Payment Element is ready.
4. Refresh immediately after Stripe confirmation.
5. Close the browser after confirmation but before the confirmation page.
6. Lose the `/api/checkout/complete` response.
7. Delay webhook delivery.
8. Deliver the same webhook more than once.
9. Return from 3DS with arbitrary Stripe query parameters.
10. Revisit `/checkout/confirmation` within the 30-minute receipt lifetime.
11. Revisit after the grant expires.
12. Change cart/address/shipping in another tab before payment.
13. Switch away from and back to the browser after Payment Element is ready.
14. Edit each completed step and then return to Payment.

Expected safety behavior:

- Once Stripe confirmation begins, an unknown result goes to
  `/checkout/recover`; it never displays an invitation to pay again.
- Recovery returns to checkout only for a definite active/failed state.
- Confirmation requires a completed cart plus order-cart link.
- The return handler strips third-party query parameters before rendering.
- The cart cookie clears only after authoritative order confirmation.
- The receipt cookie is HttpOnly, signed, 30 minutes, and scoped to
  `/api/checkout/confirmation`.
- A same-revision focus/reconnect refresh does not remount Payment Element.
- A changed revision disables payment and preserves the old frame only while
  Medusa prepares the replacement session.

## Stripe/Medusa reference synchronization

The `order.placed` subscriber copies only operational references:

- Medusa cart ID and item count at PaymentIntent creation;
- Medusa order ID and display number after order placement; and
- a readable order description on the PaymentIntent and existing Charge.

It uses idempotency keys scoped to the Medusa order and PaymentIntent. It does
not copy customer email, addresses, phone, product titles, or card data. The
subscriber validates the exact order graph row, Stripe payment projection,
PaymentIntent identity, idempotency-key length, and both Stripe update
acknowledgements before it reports success. A malformed or ambiguous boundary
fails closed so Medusa can retry the event; it is never treated as a completed
annotation.

To investigate:

1. Open the Medusa order detail.
2. In **Stripe payments**, confirm the amount, status, and test/live indicator.
3. Use **Open in Stripe** and verify the Dashboard URL stays in `/test/` for
   staging.
4. Search Stripe metadata by `medusa_order_id`,
   `medusa_order_number`, or `medusa_cart_id`.
5. If the widget says **Mode unavailable**, do not construct or guess a test
   or live Dashboard URL. Open the PaymentIntent from independently verified
   event evidence after its mode is reconciled.
6. If the widget says **Stripe payment data unavailable**, open the linked
   refund audit and compare the order, payment, lifecycle, and provider
   evidence before any payment action.
7. If final order metadata is absent, inspect subscriber/event-bus retries and
   backend availability. Do not create a second PaymentIntent or manually
   rewrite commerce state in Stripe.

An order may be complete even if this annotation call is temporarily delayed;
Medusa order/payment state is authoritative. Conversely, Stripe success alone
still does not prove that a Medusa order exists.

## Incident: refund/dispute lifecycle state is invalid

The separate lifecycle webhook and five-minute recovery job are read-only with
respect to money movement. They validate signed Stripe event projections,
persisted receipt rows, bounded retry counters, allowlisted terminal metadata,
and exact database write acknowledgements. A duplicate provider event must
match its immutable receipt; an existing terminal outcome must match the same
status, order, provider status, and submitted metadata.

If reconciliation reports `invalid > 0`, or a request fails with a lifecycle
state error:

1. Keep the official Medusa Stripe webhook and checkout recovery enabled; do
   not replay a refund, create a dispute, or move money as a repair.
2. Identify the opaque lifecycle receipt and compare its event type, Stripe
   object/reference prefixes, USD minor-unit amount, mode, timestamps, status,
   attempt count, and fixed metadata keys with independently verified Stripe
   test-mode evidence.
3. Check whether the database acknowledgement changed the requested status,
   counter, timestamp, error code, order, provider status, or metadata. Treat a
   mismatch as stored-state corruption, not a retryable provider response.
4. For a duplicate provider event, verify every immutable receipt field. For a
   terminal receipt, verify the exact prior result before allowing an
   idempotent replay.
5. Preserve the malformed row and scheduler attention record for audit. Repair
   or quarantine it only through an approved, reversible data procedure with a
   before/after record; never delete it to clear the counter.
6. Resume ordinary reconciliation only after a valid row passes the same
   boundary. The job will retry a failed non-terminal row on its bounded
   schedule and will not process malformed rows.

## Incident: payment succeeded but no order appears

1. Tell the shopper not to submit payment again.
2. Check aggregate webhook delivery state in Stripe Workbench.
3. Check the Medusa payment session status and whether an `order_cart` link
   exists. Do not expose the client secret.
4. Check the `reconcile-checkout-payments` job result.
5. If the session is authorized/captured, no link exists, and no
   `rr_checkout_reconciliation` marker exists, leave the official webhook and
   reconciliation job enabled for the first safe completion attempt.
6. If any `rr_checkout_reconciliation` marker exists, or the job reports
   `heldForReview > 0`, do not clear the marker or retry blindly. Inspect the
   Medusa order link, payment, capture, refund, inventory, and Stripe state to
   resolve the ambiguous attempt before an approved operator action.
7. Investigate shipping, tax, and `checkout_payment_*` validation failures.
8. If Medusa's workflow compensated by refunding/canceling, verify that through
   Medusa and Stripe before asking the shopper to try again.
9. Do not manually create an order or directly capture/refund in Stripe unless
   a separately approved incident procedure establishes the Medusa state.

## Incident: checkout scheduler delay or missing BullMQ lock

1. Keep shoppers from submitting another payment for any affected paid cart.
2. Correlate the exact repeat-job timestamp with the nearest
   `job.checkout_reconciliation.*` record. Review `schedule_delay_ms`,
   `duration_ms`, `event_loop_delay_max_ms`, `lock_wait_ms`, and
   `lock_released`; do not search only the display message.
3. Check for a following `.skipped` record or a second aggregate completion.
   A stalled retry re-reads the cart and order before any action. A durable
   `started` or `review_required` marker without an order is held for review and
   cannot re-enter complete-cart automatically.
4. Review Redis latency, reconnects, AOF delayed-fsync growth, memory, evictions,
   rejected connections, and BullMQ stalled events for the same window.
5. Review PostgreSQL query latency and saturation. Do not add an index or raise
   a lock duration without a measured plan and retained timing evidence.
6. If the scan window is full, raise an incident: eligible carts may exist
   beyond the bounded result. Do not remove the bound.
7. Disable future reconciliation with
   `CHECKOUT_RECONCILIATION_ENABLED=false` only if the job is unsafe. Keep the
   official Stripe webhook and checkout recovery paths available.
8. Never delete BullMQ keys, complete a cart directly in PostgreSQL, create an
   order manually, or issue another Stripe payment/refund as a queue repair.

The GitHub alert issue and its linked workflow artifact are the first external
evidence to inspect. A healthy job after an anomalous result does not clear the
24-hour latch; investigate the original event and keep the issue open until the
endpoint is healthy after the complete observation window. Treat
`scheduler_heartbeat_stale` or `redis_unavailable` as a worker/Redis outage,
not as permission to retry money movement manually.

The scheduled-workflow worker lock is five minutes with a 30-second renewal
setting. The handler separately holds a uniquely owned five-minute lock. The
job warns at 30 seconds of scheduler delay or handler duration, at one second
of maximum event-loop delay, on a failed lock release, and on every scan,
attempt, held-for-review result, or 90-second run-time cap. Immediately before
complete-cart, the job rechecks the order link and payment session, then writes
the cart's non-PII `rr_checkout_reconciliation` marker. Failure or ambiguous
response after that durable write cannot cause a later stalled run to repeat
the completion call. Configuration is bounded by:

- `CHECKOUT_RECONCILIATION_MAX_SCAN` (default `2000`, range `500–5000`);
- `CHECKOUT_RECONCILIATION_MAX_ATTEMPTS` (default `50`, range `1–250`); and
- `CHECKOUT_RECONCILIATION_MAX_RUN_SECONDS` (default `90`, range `30–240`).

## August 27, 2026 scheduler-lock investigation

Scope was Railway `staging` only. Production was not queried or changed.

The retained Backend deployment
`e31dac4c-c590-4a77-beae-fd832b53a8b5` contained two exact BullMQ
`Missing lock ... moveToFinished` failures for the scheduled
`reconcile-checkout-payments` workflow:

- the August 24 `17:02 UTC` repeat job did not enter the handler until
  `17:06:01`, logged the missing lock at `17:06:05`, and ran again at
  `17:06:31`; and
- the August 25 `22:32 UTC` repeat job did not enter the handler until
  `22:32:35`, logged the missing lock at `22:32:44`, and ran again at
  `22:33:05`.

The handler timestamp is proven by its two-minute cutoff. Both first and retry
runs scanned 500 carts and reported zero eligible, attempted, completed, or
failed carts, so these incidents did not move money or create an order. The
retained window had no Redis reconnect/stalled diagnostic. Installed Medusa
2.18 routes scheduled workflows through its Redis workflow job worker; its
installed BullMQ 5.13 defaults were a 30-second lock, 15-second renewal setting,
30-second stalled check, and one stalled recovery. The timing and duplicate
execution therefore match an expired scheduler lock, not a long-running
checkout handler.

Current read-only staging baselines found:

- 20 in-container Redis PINGs at 0.81 ms p50, 2.40 ms p95, and 3.13 ms max;
- 6.92 MB Redis memory in use, 14.16 MB peak, zero evictions, zero rejected
  connections, AOF enabled/healthy, 940 cumulative delayed fsyncs over
  15,123,932 seconds of uptime, and no current latency events; and
- a PostgreSQL 16.11 reconciliation predicate plan returning the 500-row limit
  from 1,306 matching carts in 1.446 ms, with 56 shared-buffer hits, no reads,
  and no temp I/O.

The cart predicate has no matching partial index, but the measured plan is not
an index problem at current staging volume. The actual correctness issue was
the fixed 500-row scan window: it could repeatedly hide an eligible paid cart.
The bounded default is now 2,000 and a full window is an attention event. New
schedule-delay, duration, event-loop, lock-wait, release, scan, and cap fields
make another incident measurable before further tuning.

The first hardened staging run safely scanned all 1,306 matching carts in
127.629 ms, attempted no completion, released its owned lock, and reported no
failure. It also exposed a Medusa 2.18 Redis scheduler instrumentation defect:
the adapter passed BullMQ's enqueue timestamp as `scheduledFor` but omitted the
job's intended execution metadata, creating a false 91.296-second
schedule-delay warning. Adding `job.delay` alone still produced a false
48.474-second warning because BullMQ clears that value when a repeatable job
becomes active. The checked pnpm patch therefore uses repeat-job `prevMillis`,
falling back to `job.timestamp + job.delay` for non-repeat jobs.
`qa:workflow-scheduler-timestamps` and the standalone Backend artifact check
guard that correction until an accepted upstream version replaces it.

Final staging acceptance on `40b2cc06ecd981b61150002a009c327ac0c8679e`
produced an info-level `.completed` record for the exact `08:06:00.000Z` tick.
The worker started 79 ms later, completed in 159.645 ms, observed 21.660 ms
maximum event-loop delay and 2.136 ms lock wait, released the owned lock, and
scanned all 1,306 candidates below the 2,000 limit. Eligible, attempted,
completed, and failed counts were zero; no cap or full-window condition fired.
The exact deployment contained no missing-lock or stalled-job record. External
BullMQ/Redis alerts and a retained no-recurrence window remain required.

## Incident: amount or currency mismatch

An amount mismatch is a stop-ship invariant failure.

1. Stop new checkout entry in the affected environment.
2. Keep webhook, recovery, confirmation, and reconciliation available for
   in-flight attempts.
3. Compare the exact raw cart total, payment collection amount, payment session
   amount, and currencies from Medusa's major-unit records.
4. Confirm no browser code performs cents conversion.
5. Confirm the official provider is the only minor-unit boundary and its
   rounded integer amount exactly matches the Stripe PaymentIntent.
6. Run the monetary audit and review its manifest; do not run apply mode during
   incident diagnosis.
7. Re-enable checkout only after contract tests and a disposable sandbox order
   prove the exact mapping.

## Incident: webhook signature failures or backlog

For signature failures:

1. Confirm the endpoint URL is `/hooks/payment/stripe_stripe`.
2. Confirm the environment uses the secret for that exact endpoint.
3. Confirm no middleware parses or changes the raw body.
4. Confirm system time is correct.
5. Use a local Stripe CLI listener to isolate network versus secret problems.

For pending/failed deliveries:

1. Check backend availability, TLS, response status, and latency.
2. Keep reconciliation enabled so finalized sessions are not stranded.
3. Do not create a second custom webhook handler.
4. Retry failed test-mode deliveries from Stripe Workbench after the endpoint
   is healthy.
5. Alert if a finalized payment remains without an order for 10 minutes.

## Incident: Stripe or tax-provider outage

Stripe outage:

- Existing carts remain usable.
- Payment preparation shows a retryable unavailable state.
- Do not fall back to a system/no-payment provider for positive totals.
- Do not re-enable hosted Stripe Checkout or any retired authority.
- Preserve recovery for in-flight attempts.

Tax-provider outage:

- Do not silently use zero tax.
- Keep the last valid cart visible but block final payment preparation.
- Verify Redis cache health and upstream status.
- Resume after tax recalculation returns an authoritative total.

## Incident: compensation refund failure

1. Stop new checkout entry.
2. Identify the aggregate count and affected opaque payment/order references.
3. Verify whether Stripe captured funds and whether Medusa created an order.
4. Preserve webhook/reconciliation state and logs.
5. Escalate for an explicitly approved refund through Medusa's Payment Module.
6. Never decrement inventory or create an order directly from a Stripe event.
7. Confirm the refund in both Medusa and Stripe and document the reason without
   customer PII.

## Refund authority and reconciliation

Initiate customer refunds from the Medusa order Payment section. Medusa then
records the refund and invokes the configured Stripe provider. Do not use the
Stripe Dashboard as the ordinary refund UI.

The tax evidence job independently lists Stripe refunds and compares them with
Medusa's Payment Module refund records:

- every successful Stripe Tax refund must have its own committed tax reversal;
- failed/canceled refunds remain incidents even if another refund succeeded;
- multiple partial refunds are checked individually;
- a Stripe refund missing from Medusa is a ledger mismatch; and
- a Medusa refund not yet observed in Stripe remains a mismatch until
  reconciled.

If a direct Stripe refund is discovered, do not issue another refund. Record the
incident, reconcile the order through an approved Medusa operation, and verify
the aggregate amounts and tax reversal before further changes.

Stripe sends refund and dispute evidence to
`POST /webhooks/stripe/lifecycle`, using a separate
`STRIPE_LIFECYCLE_WEBHOOK_SECRET`. The route is additive to Medusa's official
payment webhook: it persists a minimal idempotent receipt, queues reconciliation
and returns promptly. Processing always retrieves current Stripe state, and a
five-minute bounded job retries queue failures or stale processing. Raw Stripe
payloads, signatures, customer data, and card data are never stored.

The lifecycle integration cannot move money or manufacture a Medusa refund. A
direct Stripe refund becomes an explicit Medusa/Stripe mismatch in **Refund
operations**. Correct the ledger only through an approved Medusa/accounting
procedure; never click refund again to make the totals match.

## Secret and webhook rotation

Cart signing supports `CART_COOKIE_SECRET_PREVIOUS`; keep the prior secret for
one 30-day cart lifetime during a planned rotation.

For `CHECKOUT_BFF_SECRET`, deploy Backend first with the new current key and
the old key in `CHECKOUT_BFF_SECRET_PREVIOUS`. Backend then accepts both while
Storefront still signs with the old key. Deploy Storefront with the new current
key, complete an in-flight recovery and tax-link smoke test, wait for old
instances plus the 30-second replay window to drain, then remove the Backend
previous key. Storefront never signs new requests with a previous key.

For `PUBLIC_FORM_BFF_SECRET`, use the same Backend-first sequence with
`PUBLIC_FORM_BFF_SECRET_PREVIOUS`, then smoke-test both contact and privacy
proofs before removing the old key.

`CHECKOUT_RECEIPT_SECRET` is Storefront-only. Put the old key in
`CHECKOUT_RECEIPT_SECRET_PREVIOUS`, deploy the new current key, retain the old
key for the 30-minute grant lifetime, then remove it. New grants are always
signed by the current key; email remains the durable receipt.

Production startup rejects missing, placeholder, shorter-than-32-byte, or
reused JWT, cookie, cart, checkout, receipt, public-form, and configured webhook
secrets. Medusa does not provide dual-key JWT/cookie verification in this
version, so rotating those two secrets is an explicit session-invalidating
maintenance event rather than a zero-downtime key overlap.

`STRIPE_LIFECYCLE_WEBHOOK_SECRET` belongs only to
`POST /webhooks/stripe/lifecycle` and must not reuse
`STRIPE_WEBHOOK_SECRET`. During rotation, deploy the new current key with the
old key in `STRIPE_LIFECYCLE_WEBHOOK_SECRET_PREVIOUS`, deliver one signed test
event with each key, wait for old instances and in-flight delivery to drain,
then remove the previous key. Startup rejects a previous key equal to any
current runtime secret.

For Stripe webhook-secret rotation:

1. Create/rotate the test endpoint in Stripe.
2. For the lifecycle endpoint, deploy current and previous keys together; for
   Medusa's official payment endpoint, use a coordinated single-key cutover.
3. Deliver signed test events for every accepted key and observe `2xx`.
4. Remove the former endpoint/previous key only after no in-flight delivery
   remains.
5. Never log either secret.

## Payment Method Configuration changes

Treat a Payment Method Configuration change as payment code:

1. Use a separate test-mode configuration.
2. Enable only methods supported by the UI and full failure matrix.
3. Retrieve it after mutation and confirm `livemode: false`.
4. Run the complete sandbox and device matrix.
5. Roll back to the prior `pmc_...` ID if any method creates an unsupported
   redirect, delayed state, or billing requirement.

## Retention operation

Before enabling either deletion job in a new environment:

1. Run a read-only PostgreSQL count using the exact age and eligibility rules.
2. Record aggregate counts for candidates, order links, payment collections,
   and protected payment states.
3. Confirm the count is expected.
4. Enable a conservative cap.
5. Observe the first aggregate job result.

Emergency stop:

```dotenv
ANONYMOUS_CART_RETENTION_ENABLED=false
ABANDONED_CHECKOUT_RETENTION_ENABLED=false
```

Disabling stops future runs; it does not restore soft-deleted data. A database
backup/restore is the recovery path for material accidental deletion.

## Safe rollback

Rollback must never restore two payment authorities.

1. Stop new checkout entry with a customer-safe maintenance state.
2. Leave the official Stripe webhook, recovery/status route, confirmation
   route, and reconciliation job running for in-flight payments.
3. Roll back presentation code only to a version that still uses Medusa Payment
   Sessions and the locked amount/currency hook.
4. Never restore the custom Checkout Session route or custom webhook.
5. Never delete in-flight payment collections or sessions.
6. Reconcile all authorized/captured states and verify aggregate zero before
   disabling the safety net.

## August 30, 2026 confirmation-message evidence

Scope: Railway `staging` only at exact source SHA
`68a0b40639219898f6c6f8588a1f61fe9f736984`. Production was not queried,
changed, deployed, emailed, or charged.

The earlier response-loss checkout used a diagnostic `example.com` recipient,
which Resend correctly rejected. This acceptance instead used Resend's
[documented delivered test address](https://resend.com/docs/dashboard/emails/send-test-emails)
with a tagged local part. It therefore exercised the provider's delivered path
without sending customer mail.

The template audit fixed two release-blocking presentation issues before the
acceptance: raw 6.5325 USD order totals now pass through the shared validated
currency formatter and render as `$6.53`, and the order subscriber no longer
sends a placeholder reply-to. Invalid totals or item prices fail closed before
provider submission. Focused rendering and formatting tests cover the exact
high-precision amount, the `$1.00` item price, and malformed values.

Release and deployment evidence:

- local Backend lint, strict typecheck, 191 suites / 1,028 tests, production
  Medusa/Admin build, repository QA, and the Storefront 119-file / 633-test
  pre-push suite passed;
- Root CI `33282614902`, Backend CI `33282614910`, and Storefront CI
  `33282614879` passed, including security, CodeQL, coverage, build,
  Playwright, accessibility, and Lighthouse gates;
- Railway Backend deployment `4a326c2f-2d09-43b5-8f9f-6599c9dfa4ff`
  reached `SUCCESS` with image digest
  `sha256:5f61681f3f241f201113c2bd578499c6e2fd5b060e9f5b843576c897d4859321`;
- Backend `/ready` returned HTTP 200 with PostgreSQL, Redis, search, and object
  storage healthy; and
- the unchanged Storefront deployment
  `c38fffbf-6399-4e15-85d4-220bbefcfbc1` was correctly skipped by watch paths.

Checkout and reconciliation evidence:

- cart `cart_01M180TWFHX4JZHNR9GQ5RBS8P`, test PaymentIntent
  `pi_3U9wXnIM4tTeFQ3W1kprrCFD`, and order
  `order_01M180V5BWYSRCFYMP672Y98F2` / display ID `7` were created once;
- Stripe reported `livemode: false`, 653 USD minor units, one PaymentIntent,
  and one charge, while the signed receipt matched the same order number,
  currency, cent-rounded total, and one item;
- PostgreSQL retained one order-cart link, payment collection, payment session,
  payment, capture, and successful idempotent `order-placed` notification;
- the order and notification payload retained the authoritative 6.5325 USD raw
  amount, while Resend's normalized rendered message contained
  `Total: $6.53` and `$1.00`, omitted `6.5325 usd`, and had no reply-to;
- Resend retained the provider external ID and reported terminal `delivered`;
- one 8.875% line and one generation-one `taxrate_io` evidence row matched 653
  minor units, USD, the cart, order, and PaymentIntent, with `succeeded`,
  linked, and verified state; and
- exact deployment logs showed HTTP 200 for both observed tax-link calls and
  the single cart-completion call, followed by one successful one-recipient
  Resend send.

The untracked one-shot harness was moved to the desktop trash after the checks.
Acceptance output exposed only opaque IDs, counts, status, currency, and amount
evidence; temporary input data and the harness were not retained locally.

## July 25, 2026 staging evidence

Scope: Railway `staging` only at checkout implementation commit `d71d87f`.
Production was not queried, changed, deployed, or charged.

Environment and infrastructure:

- backend and publishable Stripe keys were confirmed test-mode keys;
- the Payment Method Configuration was test mode and the official Medusa
  webhook was configured for the four supported PaymentIntent events;
- backend deployment `2b294d12-e1aa-4f7e-93e7-55cd14c6eded` and storefront
  deployment `d72e07ca-b7df-4b10-96d6-372db254bbc1` both reported `SUCCESS` for
  the exact commit;
- Root CI `30173393762`, Backend CI `30173393796`, and Storefront CI
  `30173393771` all passed for the same commit; and
- the storefront suite passed 89 files and 475 tests with 93.35% statement,
  85.35% branch, 94.18% function, and 93.32% line coverage. Lint, strict
  typecheck, and the production build also passed.

Payment and lifecycle results:

- official test PaymentMethods passed for success, required 3DS, generic
  decline, insufficient funds, expired card, incorrect CVC, and processing
  error;
- the successful PaymentIntent produced staging order `#2`; one of two
  concurrent complete requests returned the authoritative order while the
  duplicate failed closed, with no second order or charge;
- the receipt matched the payable cents, the cart cleared, and the 30-minute
  receipt grant was HttpOnly and scoped to `/api/checkout/confirmation`;
- the 3DS server-side scenario reached `requires_action` with Stripe's hosted
  next action and no order; every decline retained the cart and created no
  receipt or order;
- an invalid card number failed inline in the real Payment Element before any
  payment request; and
- the displayed example reconciled exactly as `$22.00 + $5.00 + $2.33 =
$29.33`, using pre-tax item/shipping subtotals beside aggregate tax.

Storefront and device results:

- music release at quantity two, merchandise, fixed bundle, and mystery bundle
  each added, appeared in the cart, and reached checkout;
- sold-out music-release and fixed-bundle detail controls were disabled;
- a Chrome Pixel 7 device profile reported a 412-pixel body, document, and
  viewport with no horizontal overflow or page errors; and
- the real headed browser was captured with Flameshot and visually inspected;
  Stripe fields, totals, app bar, and summary were rendered and contained.

Stripe blocks reliable scripted submission through its hosted browser Element.
The supported split is therefore browser validation for UI, inline errors,
and recovery, with official Stripe test PaymentMethods for payment outcomes.
See [Stripe automated testing](https://docs.stripe.com/automated-testing) and
[Stripe test PaymentMethods](https://docs.stripe.com/testing?testing-method=payment-methods).
An automation-blocked confirmation must not be recorded as an application
failure or bypassed with real card data.

Staging currently has one canonical calculated Standard Shipping option. A
fake second option was not created merely to satisfy a test. Zero-total
behavior remains contract-tested but was not exercised by mutating catalog
prices in staging.

## Release evidence checklist

- [ ] Environment is staging and every Stripe object is test mode.
- [ ] Lint, format, strict typecheck, unit/integration tests, and builds pass.
- [ ] Dependency audit, SBOM, secret scan, and header/CSP tests pass.
- [ ] Exact amount matrix passes.
- [ ] Success, 3DS, every decline, browser-close, response-loss, duplicate,
      webhook-delay, and two-tab cases pass.
- [ ] Official webhook returns `2xx` for signed events.
- [ ] Reconciliation completes a disposable eligible test cart and is bounded.
- [ ] Full, partial, repeated-partial, failed, and direct-Stripe refund evidence
      is reconciled per refund.
- [ ] Duplicate, out-of-order, queue-failed, and stale refund/dispute lifecycle
      receipts converge without duplicate money movement.
- [ ] Stripe-taxed order edits preserve existing rates and reject new taxable
      items until a tax-bound additional-payment flow exists.
- [ ] Desktop and Chrome Pixel/iPhone device-emulation screenshots are
      inspected with no horizontal overflow.
- [ ] Keyboard, focus/error summary, screen-reader status, reduced motion, and
      200% zoom/reflow pass.
- [x] Confirmation email and receipt match the Medusa order.
- [ ] GitHub CI and both Railway staging deployments report success.
- [ ] No production configuration or traffic changed.
