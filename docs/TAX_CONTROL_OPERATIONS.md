# Tax control operations and incident runbook

Medusa owns every cart, tax line, payable total, payment session, order, and
refund. TaxRate.io and Stripe Tax are alternative calculation engines behind
that one authority. Never enable a second independent Stripe calculation or
manually edit an order total in Stripe.

Tax collection is a durable operating decision separate from the selected
provider. Never simulate disabled collection by deleting tax regions, entering
a zero rate, selecting an unready provider, removing registrations, clearing
credentials, or changing Stripe settings. Use the audited **Do not collect
tax** choice so every new quote, payment, order, refund, and workpaper retains
one coherent decision.

Tax collection initializes **off**. A new control stores an explicit disabled
decision before any provider is used; the migration from the earlier implicit
collecting default records one audited system transition only when the control
is still generation one and has no operator history. The Admin never treats a
provider name as proof that the integration exists:
TaxRate.io is unavailable without `TAX_RATE_LOOKUP_API_KEY`, and Stripe Tax is
unavailable without `STRIPE_API_KEY`. A provider remains unselectable until all
of its runtime and account readiness checks pass.

## Admin workflow

Open **Settings → Tax control** in Medusa Admin. The page shows:

- the current collection decision before provider details, including last
  change and reason;
- three plain choices: **Do not collect tax**, **Collect using TaxRate.io**,
  and **Collect using Stripe Tax**;
- an environment-level configuration banner when no provider is available or
  the currently selected provider cannot run;
- provider status using **Ready**, **Needs setup**, or **Unavailable**, plus
  readiness rows using plain **Ready** or **Missing** labels;
- TaxRate.io's most recently returned usage/quota inside its provider card;
- decision-locked checkouts split between collecting and not collecting, plus
  payments completing, with the exact definition beside each number;
- tracked tax-bound payments and refund counts;
- pending refund reversals, Medusa/Stripe refund-ledger mismatches, disputes,
  or failed Stripe Tax associations; and
- the immutable mode/provider transition history and acknowledgement version.

The role needs `tax_control:read` to open this workspace. Provider switching
and the deliberate metered quota refresh additionally require
`tax_control:update`; a read-only operator sees status and evidence without
those controls. Direct API requests are checked by the same backend policies.

The current collection choice has a neutral **Current** label. An unconfigured
provider is labeled **Unavailable** and cannot be selected; a configured but
incomplete provider is labeled **Needs setup** and also remains disabled. The
backend repeats the same configuration and readiness checks under the
distributed transition lock, so a stale or modified browser cannot bypass the
guard. Every change opens one confirmation
dialog containing the frozen-decision impact and an audit reason; no backend
state changes before confirmation. A change requires a reason of at least ten
characters, the current generation, a UUID idempotency key, and an
authenticated Admin. Turning collection off additionally requires this exact
typed acknowledgement:

```text
I understand tax will be $0.00 on new eligible checkouts.
```

The acknowledgement version, not customer or provider data, is retained with
the audit. The backend serializes all mode/provider transitions under the same
distributed lock.

Provider-locked checkout and payment-completion counts are calculated across
every unfinished cart updated in the last 30 days. The query paginates the
entire matching set; it is not a 500-row sample. Abandoned browsing carts that
never reached a processable Stripe payment session are not included.

Open carts without a prepared payment adopt the new mode/provider generation on
their next tax refresh. Prepared payments retain their original mode,
provider, generation, fingerprint, and tax decision. They must finish or be
safely replaced through the normal Medusa payment-session workflow. Completed
orders are never repriced.

Every tax-control workflow boundary validates the complete Medusa graph row
before deriving a calculation subject. Item and shipping amounts must be
finite numeric values, quantities and counts must be non-negative safe
integers, tax codes must be non-empty strings, and relationship arrays must
contain only records. Per-item amounts, tax-code maps, preserved rates, and a
frozen provider quote are accepted as one coherent context or rejected as a
whole; invalid entries are never silently removed. Queries for one cart reject
missing or additional rows. Missing or duplicate taxable and shipping entity
IDs also fail closed so totals cannot overwrite or double-count a relationship
and an order edit cannot inherit an ambiguous historical rate. A boundary
failure stops tax calculation and payment preparation without logging
provider, customer, or address payloads.

## Turn collection off

1. Confirm the decision with the store owner and tax professional. The Admin
   control does not determine registration, nexus, or filing obligations.
2. Review the decision-locked and payment-completing counts. Do not expect
   those checkouts to be repriced.
3. Choose **Review turning off tax collection**.
4. Enter a concrete reason, type the acknowledgement exactly, and confirm.
5. Refresh the page and verify **Tax not collected** is current, the generation
   advanced once, and one audit row records the transition.
6. In a new, unprepared test cart, verify every item and shipping subject has
   an `rr_tax:disabled:g<generation>:decision` zero line, checkout says **Tax
   not collected**, and the PaymentIntent has no Stripe Tax hook.
7. Verify Tax Records places the sale under **Sales pending tax review** and
   does not classify it as exempt or nontaxable.

The disabled checkout calculator makes no TaxRate.io, Stripe Tax, quota, Redis
tax-cache, Tax Calculation, or Tax Transaction request. Admin readiness views
may still inspect configured providers; that is operational status and is not a
customer tax calculation.

## Re-enable collection

1. Confirm which provider should collect tax and complete every readiness row.
2. Review frozen checkout impact and current payment incidents.
3. Choose **Collect using TaxRate.io** or **Collect using Stripe Tax**, enter the
   reason, and confirm.
4. Verify **Collect tax** is current, the generation advanced once, and the
   audit shows both the prior and next mode/provider.
5. Create a new, unprepared test cart and prove the selected provider identity,
   tax amount, PaymentIntent metadata, and—when Stripe Tax is selected—the
   calculation hook and committed transaction.
6. Confirm a prepared disabled checkout still completes with its historical
   $0.00 decision instead of being repriced.

## Provider readiness

| Provider | Minimum environment configuration | Selectable when |
| --- | --- | --- |
| TaxRate.io | `TAX_RATE_LOOKUP_API_KEY` | The key exists and the latest provider quota is not exhausted. |
| Stripe Tax | `STRIPE_API_KEY` and reviewed `STRIPE_TAX_SHIPPING_TAX_CODE` | The key/account mode, settings, head office, provider, exclusive behavior, product/shipping tax codes, and an active registration all pass. |

Adding a secret does not turn collection on. Restart the Backend so it loads
the new environment, refresh Tax Control, confirm the provider says **Ready**,
and then use the audited re-enable workflow. Removing or invalidating a secret
does not silently select another provider; an active unavailable provider is a
fail-closed incident and the Admin tells the operator to restore configuration
or deliberately turn collection off.

TaxRate.io is ready only with a configured API key and remaining provider
quota. The displayed numbers come from TaxRate.io; the application does not
invent a monthly reset or estimate remaining calls. **Use 1 lookup to refresh**
is enabled only with a reviewed monitoring ZIP and consumes one real lookup.
The safe GET boundary can make one additional attempt after a transport, 408,
425, or 5xx failure, so a transient failure can consume two metered lookups.
Quota rejection and other 4xx responses are never retried.

TaxRate.io's response fields use two different units: `rate` and
`rate_state`/`rate_county`/`rate_city`/`rate_special` are percentages, while
`rate_pct` is a decimal fraction. The backend converts only `rate_pct`, checks
the two total fields agree when both are present, and rejects malformed or
contradictory totals. This prevents an exact 1% result or a fractional local
component from being multiplied by 100 accidentally. TaxRate.io's
[published response example](https://www.taxrate.io/) documents the same unit
distinction with `rate: 9.5`, `rate_pct: 0.095`, and percentage-valued
jurisdiction components.

Stripe Tax quote creation and retrieval use one shared eight-second deadline
across the calculation and any required line-item read. Nested SDK retries are
disabled; the client schedules at most one transient retry and reuses the cart
fingerprint idempotency key for a calculation POST. Rate limits and other
non-retryable 4xx responses remain single-attempt. Requests and provider
responses are capped at 100 unique positive lines. More pagination, missing or
duplicate references, unsafe
numeric fields, inconsistent exclusive-tax totals, and malformed calculation
metadata fail closed with a coded error that does not copy Stripe or customer
details. These retry and validation rules apply to quote calculation; the
payment-binding invariant below still decides whether a quote may be attached.

The Admin readiness snapshot and provider-switch check retrieve Stripe Tax
settings and active registrations concurrently under one shared eight-second
deadline. Nested SDK retries are disabled; each safe GET can make one bounded
transient retry, while rate limits and other non-retryable 4xx responses stay
single-attempt. The response boundary accepts at most one complete
100-registration page and validates the settings discriminator, key/account
mode, provider, status, tax behavior, tax code, bounded missing-field names,
and active unique registrations. Any malformed or additional page fails
closed. Retry warnings contain only operation, reason class, and attempt count;
provider text and registration details are never logged or returned.

Stripe Tax is ready only when all checks pass:

- a configured Stripe secret key;
- Stripe Tax settings are active;
- the key and settings agree on test/live mode;
- at least one active registration exists;
- account tax behavior and default product tax code are configured; and
- `STRIPE_TAX_SHIPPING_TAX_CODE` is a reviewed `txcd_...` code.

Sandbox readiness does not authorize a production registration or live
provider switch. Production tax registrations and classifications require the
store owner's explicit approval and, when needed, professional tax advice.

## Cache boundaries

Medusa validates every tax-cache duration and capacity while loading its
runtime configuration. `TAX_RATE_LOOKUP_CACHE_TTL_MS` accepts integer values
from 1 second through 1 hour and defaults to 5 minutes;
`STRIPE_TAX_QUOTE_TTL_MS` accepts 1 second through 30 minutes and defaults to
30 minutes. The per-process entry ceilings default to 2,048 TaxRate.io rates
and 256 Stripe Tax quotes, with hard configuration maxima of 10,000 and 1,000
respectively. Empty, fractional, unsafe, or out-of-range settings stop startup
before the provider serves a request.

Both local caches purge all expired entries before a write and evict the
least-recently-used entry when capacity is reached. Redis remains the shared
cross-process cache and applies the matching TTL. A process emits the resolved
safe numeric configuration at startup and rate-limits capacity warnings to one
per cache per minute. Those records never contain postal codes, fingerprints,
cache keys, provider messages, or payloads. A capacity warning means the cache
is still bounded and serving, but repeated warnings should trigger a review of
traffic cardinality and the configured ceiling before any increase.

Redis is treated as an untrusted persistence boundary. A cached TaxRate.io
result must contain a 0–100 rate and either no jurisdiction or a complete,
bounded jurisdiction projection. A cached Stripe quote must retain a future
cache and provider expiry, canonical calculation ID and currency, boolean
mode, no more than 100 safe line amounts, and an exact item-plus-shipping tax
total. Invalid Stripe entries are deleted before a fresh quote is requested;
invalid rate entries are ignored before a fresh lookup. Quota snapshots are
accepted only when timestamp, source, integer usage, quota, remaining, and
0–100 usage percentage are coherent. The same projection validates the
database row before readiness or Admin display, so corrupt evidence cannot
silently make a provider appear ready.

## Payment binding invariant

Before the browser receives a Stripe client secret, and again immediately
before cart completion, the backend requires:

```text
Medusa cart total in cents
  == Medusa payment collection/session amount in cents
  == Stripe PaymentIntent amount
  == Stripe Tax Calculation amount_total (Stripe Tax only)
```

Provider, generation, cart fingerprint, currency, calculation ID, and TaxRate.io
rate must also agree. One Stripe Tax calculation can bind to one PaymentIntent.
The purpose-bound HMAC proof for `/store/checkout/tax-link` cannot be replayed
against the checkout status endpoint.

The binding boundary retrieves the PaymentIntent and optional Stripe Tax
calculation concurrently, then performs any required hook update within one
shared eight-second deadline. The Stripe SDK's nested retries are disabled;
each read or update can make one bounded transient retry, while 429 and other
non-retryable 4xx responses remain single-attempt. Both update attempts carry
the same fingerprint-derived idempotency key. Before evidence is recorded, the
boundary validates the response discriminators and IDs, integer amounts,
currency, test/live mode, status, exact provider metadata, calculation expiry,
existing hook, and final update acknowledgement. Only
`requires_payment_method` and `requires_confirmation` can receive a first-time
hook. An exact existing hook is re-verified as an idempotent replay; a different
hook, late status, malformed response, or changed mode fails closed.

Cart fingerprints validate every item, shipping method, adjustment, quantity,
and monetary value before hashing; malformed rows cannot disappear into the
same fingerprint as an absent row. Quote extraction likewise accepts only
complete record arrays, explicit finite rates from 0% through 100%, and one
consistent provider generation. Payment binding requires one complete pending
Stripe session, at most one result from each evidence identity query, and a
validated evidence-persistence acknowledgement before returning success. Each
identity lookup requests two rows so a broken uniqueness assumption is visible
instead of hidden by `take: 1`. Evidence creation, replay verification,
lifecycle updates, quota synchronization, and collection-mode transitions
accept only one complete write acknowledgement and exact final state. Quote,
control, and transition paths re-read the committed record before returning;
any missing row, extra row, malformed timestamp or identifier, immutable-field
drift, metadata corruption, or mismatched readback fails the transaction.
For an already-prepared checkout only, the backend validates the complete
current subject first and then accepts either its hardened fingerprint or the
exact prior projection. This compatibility path cannot create a new legacy
fingerprint and prevents a safe rollout from repricing a frozen checkout.

Retry warnings contain only the operation, reason class, and attempt count.
Provider messages, request details, customer data, payment metadata, and
transport payloads are never copied into terminal errors or logs. Do not use a
shared staging cart or PaymentIntent to smoke-test this mutating route. Use the
deterministic boundary suite plus read-only exact-deployment health and runtime
evidence unless a disposable checkout fixture has been explicitly approved.

## Evidence and scheduled reconciliation

The `tax_quote_evidences` table contains opaque IDs and operational status, not
customer addresses, email, phone, card data, secrets, or client secrets.
Subscribers reconcile evidence after:

- `order.placed`;
- `payment.captured`; and
- `payment.refunded`.

The `reconcile-tax-evidence` job runs hourly at minute 23, oldest evidence
first, with a 100-record cap and a per-PaymentIntent distributed lock. It
rechecks prepared/successful/refunded/disputed records so delayed refund
reversals and missed dispute signals remain visible. Aggregate warnings report
failures, incidents, or a reached cap.

All Stripe evidence GETs run through one validated safe-read boundary with a
shared eight-second deadline. Standalone reconciliation reads the expanded
PaymentIntent, the optional Tax association, and one 100-refund page
concurrently. Refund/dispute lifecycle processing retrieves the current
provider object first and caches the expanded PaymentIntent for the subsequent
reconciliation, preventing a duplicate read on tracked evidence. SDK retries
are disabled; transport failures and HTTP 408, 409, 425, or 5xx responses can
receive one bounded retry, while 429 and other non-retryable 4xx responses stay
single-attempt. The reader rejects malformed identities, discriminators,
amounts, currencies, modes, statuses, metadata, expanded charge state, refund
records, and association attempts before durable evidence is updated. Retry
telemetry contains only the operation, reason class, and attempt count;
provider messages and payloads are never logged. This boundary issues no Stripe
mutation.

The lifecycle receipt is itself a validated evidence boundary. Signed events
must have exact Stripe object/reference prefixes, a boolean test/live mode, a
safe USD minor-unit amount, and a valid timestamp. Persisted receipt rows and
all processing, terminal, and retry write acknowledgements are revalidated
before reconciliation continues. Only fixed tax-evidence metadata keys are
accepted. Conflicting replays or terminal outcomes fail closed; malformed
scheduled rows are omitted from provider reads and increment the aggregate
`invalid` attention count.

Refund reconciliation is per refund, not merely per PaymentIntent. It verifies
that every successful Stripe refund has its own committed Stripe Tax reversal,
surfaces failed/canceled refunds, and fails closed when Stripe reports more
than the 100-refund audit window. Admin also compares the sum of Medusa refund
records with Stripe's observed refunded amount. A direct Stripe Dashboard/API
refund therefore remains visible as a ledger mismatch even though Stripe's
simplified Tax integration creates its reversal automatically.

The Admin ledger comparison validates every Medusa payment, collection, refund,
PaymentIntent identity, and Stripe evidence amount before summing. Unrelated
valid providers and PaymentIntents remain outside the comparison. A primitive
row, duplicate PaymentIntent, invalid monetary value, malformed evidence
amount, or a short impact page makes the comparison unavailable instead of
reporting a falsely clean ledger. The operator sees a fixed availability state;
the bounded warning never includes provider or customer payloads.

Service objectives:

- zero accepted checkouts with mismatched or expired tax evidence;
- 100% of Stripe-taxed successful payments associated with a tax transaction;
- 100% of Stripe Tax refunds associated with the expected reversal; and
- disputes and association errors visible to an operator within the hourly
  reconciliation window.

## Incident: association failed

1. Stop switching new carts to Stripe Tax if failures are systemic.
2. Keep checkout recovery, Medusa's official Stripe webhook, and evidence
   reconciliation running for in-flight payments.
3. In **Payment tax evidence**, note the opaque PaymentIntent/order references
   and association reason without copying customer data.
4. Verify the PaymentIntent amount/currency and calculation amount/currency in
   Stripe test mode or the explicitly approved live environment.
5. Do not attach another calculation or create another PaymentIntent.
6. Escalate calculation expiry, duplicate association, or currency mismatch as
   a stop-ship defect.

## Incident: refund reversal pending or failed

1. Confirm the refund was initiated and recorded through Medusa Admin.
2. Compare the exact Medusa refund total with the Stripe-observed total.
3. Check every refund ID for its own committed Stripe Tax reversal.
4. Allow the hourly job to reconcile a reversal that is still being committed.
5. If Stripe reports a failed/canceled refund or errored reversal, stop further
   refunds on the affected payment and investigate the original payment method.
6. If Stripe has a refund Medusa does not, record a direct-Stripe incident and
   reconcile Medusa before continuing order operations.
7. Never manufacture a reversal or issue a second refund without reconciling it
   to the Medusa refund ledger.

## Order edits, returns, and exchanges

Existing Stripe-taxed order items and shipping methods keep the exact effective
rates recorded at purchase. Return shipping may reuse the original reviewed
shipping rate when that rate is unambiguous. This prevents an old order from
changing merely because a provider was switched or a jurisdiction rate changed.

Do not add or reprice taxable items on a Stripe-taxed order. Medusa can require
an additional payment for an order edit, while Stripe requires that payment's
Tax calculation to be bound to that PaymentIntent. The current storefront has
no customer-facing, tax-bound additional-payment flow, so the tax hook rejects
that edit instead of producing unreported or mismatched tax. Create a separate
new order for the added items.

TaxRate.io orders keep their historical frozen percentage for subsequent order
tax-line operations. This preserves history but does not turn TaxRate.io into a
transaction-reporting system.

## Incident: dispute

Stripe does not automatically reverse Tax solely because a payment is disputed.
Do not infer a tax decision from the card dispute outcome.

1. Review the Medusa order and Stripe dispute using only opaque references.
2. Confirm whether goods were fulfilled, returned, or refunded.
3. Ask the store owner's tax professional whether a tax reversal is required.
4. Perform any approved reversal using Stripe's documented Tax transaction
   reversal flow, then record the incident and verify evidence.

## Safe provider rollback

1. Fix or verify the target provider until Admin marks it ready.
2. Review prepared/finalizing cart impact.
3. Enter a concrete reason and switch through Tax control.
4. Do not rewrite prepared payment metadata or completed tax lines.
5. Watch tax calculation errors and payment evidence for at least one checkout
   cycle.

Switching back changes only the generation used for new/unprepared quotes. It
does not undo tax transactions, refunds, or provider history.

## Safe collection-mode rollback

If disabled mode itself is unsafe, stop new checkout traffic through the normal
release/incident control and deploy the last accepted application artifact.
Do not reverse `Migration20260830150000`, delete audit rows, set every row back
to `collect`, or rewrite tax/payment metadata. The expand-only schema and
historical disabled evidence must remain readable.

If the currently deployed runtime cannot honor the persisted mode, readiness
must fail rather than silently collecting. Restore a compatible artifact,
review all checkouts created during the incident window, and re-enable
collection only through the audited Admin transition after provider readiness
and owner approval.

## Required validation before production

- Migrations apply cleanly and are backed up/rollback-reviewed.
- Backend/storefront lint, strict typecheck, tests, and production builds pass.
- Taxable, non-taxable, discounted, shipping, bundle, mixed-cart, rounding,
  expired-calculation, decline, refund, and dispute cases pass in sandbox.
- A successful Stripe Tax checkout proves the three-way amount invariant and
  committed Tax transaction.
- Partial and full refunds prove the expected reversal association.
- Multiple partial refunds prove a distinct committed reversal for each refund.
- A direct Stripe refund produces a visible Medusa-ledger mismatch.
- A failed refund and a truncated refund audit remain operator incidents.
- Existing-line returns preserve historical rates, and new taxable items on a
  Stripe-taxed order fail closed.
- Malformed graph rows, numeric coercions, partial context maps, duplicate
  taxable entities, and malformed frozen quotes fail before provider access.
- Tax control is checked with keyboard, focus, narrow viewport, and reduced
  motion.
- A separate owner approval exists for live registrations, classifications,
  Stripe Tax pricing, and the production provider switch.

Official references:

- [Stripe PaymentIntent Tax integration](https://docs.stripe.com/tax/payment-intent)
- [Stripe Tax sandbox testing](https://docs.stripe.com/tax/testing)
- [Stripe Tax registrations](https://docs.stripe.com/tax/registering)
- [Stripe Tax transaction reversals](https://docs.stripe.com/tax/custom#reverse-transaction)
- [Medusa custom Tax Module providers](https://docs.medusajs.com/resources/commerce-modules/tax/tax-provider)
- [Medusa order edits and outstanding payments](https://docs.medusajs.com/resources/commerce-modules/order/edit)
- [Medusa order payment and refund operations](https://docs.medusajs.com/user-guide/orders/payments)
