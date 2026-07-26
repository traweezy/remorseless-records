# Tax control operations and incident runbook

Medusa owns every cart, tax line, payable total, payment session, order, and
refund. TaxRate.io and Stripe Tax are alternative calculation engines behind
that one authority. Never enable a second independent Stripe calculation or
manually edit an order total in Stripe.

## Admin workflow

Open **Tax control** in Medusa Admin. The page shows:

- the active provider and generation;
- readiness checks for both providers;
- TaxRate.io's most recently returned usage/quota;
- active carts, prepared checkouts, and payments finalizing;
- tracked tax-bound payments and refund counts;
- disputes or failed Stripe Tax associations; and
- the immutable provider-switch history.

Choosing a provider does not change state. A switch requires a provider that is
ready, a reason of at least ten characters, confirmation, the current
generation, and an authenticated Admin. The backend serializes the switch and
uses an idempotency key.

Open carts without a prepared payment adopt the new provider on their next tax
refresh. Prepared payments retain their original provider/generation/quote.
They must finish or be safely replaced through the normal Medusa payment-session
workflow. Completed orders are never repriced.

## Provider readiness

TaxRate.io is ready only with a configured API key and remaining provider
quota. The displayed numbers come from TaxRate.io; the application does not
invent a monthly reset or estimate remaining calls. **Use 1 lookup to refresh**
is enabled only with a reviewed monitoring ZIP and consumes one real lookup.

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

1. Confirm the refund was initiated and recorded through Medusa.
2. Check the evidence refund amount and Stripe Tax association attempts.
3. Allow the hourly job to reconcile a reversal that is still being committed.
4. If Stripe reports an errored attempt, investigate before more refunds.
5. Never manufacture a reversal without reconciling it to the Medusa refund.

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
