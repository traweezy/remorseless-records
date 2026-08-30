# Tax control operations and incident runbook

Medusa owns every cart, tax line, payable total, payment session, order, and
refund. TaxRate.io and Stripe Tax are alternative calculation engines behind
that one authority. Never enable a second independent Stripe calculation or
manually edit an order total in Stripe.

## Admin workflow

Open **Settings → Tax control** in Medusa Admin. The page shows:

- a neutral current-setup summary with its calculation method, connection,
  last change, and reason;
- readiness rows for both providers, using plain **Ready** or **Missing**
  labels;
- TaxRate.io's most recently returned usage/quota inside its provider card;
- provider-locked checkouts and payments completing, with the exact definition
  shown beside each number;
- tracked tax-bound payments and refund counts;
- pending refund reversals, Medusa/Stripe refund-ledger mismatches, disputes,
  or failed Stripe Tax associations; and
- the immutable provider-switch history.

The role needs `tax_control:read` to open this workspace. Provider switching
and the deliberate metered quota refresh additionally require
`tax_control:update`; a read-only operator sees status and evidence without
those controls. Direct API requests are checked by the same backend policies.

The current provider has a neutral **Current** label. Each inactive provider has
an explicit switch button, which stays disabled until its setup is ready. The
button opens one confirmation dialog containing the impact summary and audit
reason; no backend state changes before confirmation. A switch requires a
reason of at least ten characters, the current internal configuration version,
and an authenticated Admin. The backend serializes the switch and uses an
idempotency key.

Provider-locked checkout and payment-completion counts are calculated across
every unfinished cart updated in the last 30 days. The query paginates the
entire matching set; it is not a 500-row sample. Abandoned browsing carts that
never reached a processable Stripe payment session are not included.

Open carts without a prepared payment adopt the new provider on their next tax
refresh. Prepared payments retain their original provider/generation/quote.
They must finish or be safely replaced through the normal Medusa payment-session
workflow. Completed orders are never repriced.

## Provider readiness

TaxRate.io is ready only with a configured API key and remaining provider
quota. The displayed numbers come from TaxRate.io; the application does not
invent a monthly reset or estimate remaining calls. **Use 1 lookup to refresh**
is enabled only with a reviewed monitoring ZIP and consumes one real lookup.
The safe GET boundary can make one additional attempt after a transport, 408,
425, or 5xx failure, so a transient failure can consume two metered lookups.
Quota rejection and other 4xx responses are never retried.

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

Refund reconciliation is per refund, not merely per PaymentIntent. It verifies
that every successful Stripe refund has its own committed Stripe Tax reversal,
surfaces failed/canceled refunds, and fails closed when Stripe reports more
than the 100-refund audit window. Admin also compares the sum of Medusa refund
records with Stripe's observed refunded amount. A direct Stripe Dashboard/API
refund therefore remains visible as a ledger mismatch even though Stripe's
simplified Tax integration creates its reversal automatically.

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
