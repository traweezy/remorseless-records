# ADR 0002: Medusa-owned switchable tax providers

- Status: accepted and implemented for provider collection; ADR 0007 adds the
  accepted tax-disabled operating mode, whose implementation is pending
- Date: 2026-07-25
- Scope: US storefront tax calculation, reporting, refunds, and payment linkage

## Decision summary

Medusa remains the sole cart, total, order, and refund authority. TaxRate.io and
Stripe Tax are installed behind one Medusa Tax Module Provider, while a durable
Admin control selects exactly one engine for each new quote generation. Stripe
must not calculate an independent second total after Medusa has prepared the
order.

ADR 0007 separates the decision to collect tax from this provider selection.
When its implementation is complete, an explicit audited disabled mode will
produce controlled zero-tax evidence without calling either provider. Provider
failure must still never silently fall back to that mode.

The same fresh Stripe Tax `Calculation` used to populate Medusa's tax lines must
be linked to the Medusa-created PaymentIntent. The PaymentIntent amount must
equal both the locked Medusa cart total and the Stripe Tax calculation's
`amount_total` before payment can proceed.

Stripe Tax is not selected for new quotes until an Admin explicitly switches
to it. On 2026-07-25 the Stripe sandbox—not live mode—was configured and
verified with:

- `livemode: false`;
- Tax settings status `active`;
- a configured head-office address;
- exclusive prices and General Tangible Goods as the account default; and
- one active New York sandbox registration.

The address and secret key are environment/account data and are not stored in
the repository. The readiness gate also requires the reviewed shipping tax
code and refuses a live/test key-mode mismatch.

## Why one tax engine

The checkout already enforces Medusa as the payment and order authority.
Running TaxRate.io in Medusa while separately enabling Stripe Tax on
the PaymentIntent would create two answers for the same order. The results can
differ because product taxability, shipping treatment, discounts, address
quality, jurisdiction breakdowns, and rounding are not identical.

The intended flow is:

```text
delivery address + cart lines + discount + shipping
                         |
                         v
              Medusa tax workflow
                         |
                         v
          Stripe Tax Calculation API
                         |
             +-----------+-----------+
             |                       |
             v                       v
       Medusa tax lines       calculation ID
             |                       |
             +-----------+-----------+
                         v
              locked cart revision
                         |
                         v
       Medusa-created Stripe PaymentIntent
       amount == cart total == amount_total
```

Stripe then creates the tax transaction when the linked PaymentIntent succeeds
and creates the documented flat-amount reversals for refunds. Medusa still owns
the order and refund workflow; Stripe holds the tax reporting transaction and
payment evidence.

## Implemented provider control

The `tax_control` module persists:

- the active provider and monotonically increasing generation;
- an authenticated switch audit with actor, reason, and idempotency key;
- TaxRate.io's last provider-returned quota result; and
- immutable PaymentIntent-to-tax-quote evidence.

Switches are serialized with the distributed Locking Module. A cart without a
prepared payment adopts the active generation on its next tax refresh. A cart
with a processable payment remains frozen to its original provider, generation,
fingerprint, and Stripe calculation or TaxRate.io rate. Completed orders are
never repriced.

The Medusa Admin extension shows both providers' readiness checks, provider
quota, active/prepared/finalizing cart impact, switch history, tracked payment
evidence, and disputes or failed tax associations needing attention.

## TaxRate.io limits

The provider can call TaxRate.io by US postal code, caches one percentage for
five minutes, and applies that same
rate to every line item and the shipping line. It does not model:

- full destination address precision;
- separate product and shipping tax codes;
- exempt or differently taxed product classes;
- jurisdiction-level breakdowns;
- discount allocation; or
- a tax transaction linked to the payment and refund lifecycle.

It is a useful rate lookup, but it is not equivalent to transaction-level tax
calculation and reporting.

## Integration design

### 1. Configuration and catalog mapping

Before code activation, the store owner or tax professional must confirm:

- the legal head-office/ship-from address;
- every jurisdiction where the business is registered to collect;
- exclusive versus inclusive price behavior;
- the fallback product and shipping tax codes; and
- explicit tax-code mappings for music media, apparel, accessories, bundles,
  mystery products, and any digital goods.

Store the Stripe tax code in Medusa product metadata or a dedicated controlled
mapping keyed by product type. Never infer a legal tax classification from
display copy at runtime. Fixed bundles need a documented allocation policy;
mystery products need a conservative, approved code rather than the selected
contents' eventual identities.

### 2. Medusa provider boundary

The `ITaxProvider` adapter under `backend/src/modules` is selected by the
durable control generation. It:

- validates the complete shipping address, currency, positive finite amounts,
  quantities, references, and mapped tax codes;
- sends line amounts after Medusa discounts, plus the selected shipping amount,
  to Stripe Tax with `address_source=shipping`;
- uses stable non-PII references based on Medusa line IDs;
- uses bounded timeouts and safe retry/backoff only for retryable failures;
- stores the calculation ID, expiry, cart fingerprint, per-line tax, and
  shipping tax in provider data;
- maps the returned result into Medusa item and shipping tax lines; and
- fails closed with a customer-safe retry message when an exact result cannot be
  produced. It must never silently fall back to zero tax.

Medusa's provider contract expresses percentage tax lines, while Stripe returns
exact per-line tax amounts. The adapter derives high-precision effective rates
from Stripe's exact line amounts. The final three-way amount invariant is still
the stop-ship proof; a cent mismatch is never hidden with an adjustment.

### 3. Calculation lifecycle

Stripe states that it does not recalculate tax or update the PaymentIntent
amount when a linked calculation changes. A calculation must therefore be
invalidated whenever any of these change:

- line, quantity, unit price, product tax code, or discount;
- delivery address;
- shipping option or amount;
- currency or tax behavior; or
- the calculation expires.

Payment-session preparation runs under the cart mutation lock. A signed,
purpose-bound server-to-server endpoint re-verifies the resulting calculation
and links it to the official Medusa Stripe PaymentIntent using Stripe's tax
calculation hook. It runs before the browser receives a client secret and again
before completion. Payment preparation stops unless all three totals match:

```text
Medusa locked cart total
  == Stripe PaymentIntent amount
  == Stripe Tax Calculation amount_total
```

No browser code handles tax IDs or recomputes tax.

### 4. Payment, order, refund, and dispute records

On payment preparation and success, persist only non-PII reconciliation
references:

- Medusa cart and order IDs/numbers;
- Stripe PaymentIntent ID;
- Stripe Tax calculation and transaction IDs; and
- tax engine/version and cart revision.

Stripe documents automatic tax-transaction creation for a successfully linked
PaymentIntent and automatic flat-amount reversals for refunds. Medusa initiates
refunds and event subscribers reconcile the Stripe reversal. An hourly bounded
job rechecks old evidence for missed events and delayed associations. Disputes
are surfaced in Admin for a separate operations path because Stripe does not
automatically create a Tax reversal for them.

### 5. Idempotency, caching, and failure behavior

- Use an idempotency key derived from cart ID plus immutable tax fingerprint
  when creating a calculation for final payment preparation.
- Deduplicate concurrent recalculations in Redis for a short period, but never
  reuse a calculation after its fingerprint differs or its Stripe expiry.
- Do not call Stripe Tax for every keystroke. Calculate after a valid address is
  saved, after shipping selection, and once more inside final payment
  preparation.
- Never log full addresses, emails, Stripe secrets, client secrets, or raw
  provider payloads.
- Keep both providers installed behind the audited Admin control for safe
  rollback. A single cart must never mix providers.

## Rollout gates

1. [ ] Obtain business approval for Stripe Tax pricing and professional
       confirmation of live registrations and catalog tax-code choices.
2. [x] Configure Stripe Tax in the sandbox until settings are `active`; add one
       test registration.
3. [x] Add an explicit shipping mapping and a controlled product fallback.
4. [x] Implement provider control, quote freezing, exact PaymentIntent binding,
       evidence, and Admin readiness gates.
5. [ ] Run the sandbox golden matrix across taxable, non-taxable, mixed,
       discounted, shipping, bundle, refund, failed-payment,
       expired-calculation, and rounding-boundary cases.
6. [ ] Prove the three-way amount invariant and tax transaction/reversal
       linkage in Stripe sandbox.
7. [ ] Compare representative Stripe results with TaxRate.io without charging
       a live customer.
8. [ ] Switch only in staging, monitor, and request separate production
       approval before any live registration or provider change.

## SLO and observability

- Tax calculation p95 under 1.5 seconds and hard upstream timeout at 8 seconds.
- Zero accepted checkout totals with an expired/mismatched calculation.
- 100% of successful Stripe-taxed orders linked to one calculation and one tax
  transaction.
- 100% of Medusa refunds reconciled to the expected Stripe tax reversal.

Emit structured, PII-free metrics for request latency, provider/result status,
cache result, mismatch count, calculation expiry, transaction linkage, and
refund-reversal reconciliation. Alert on any amount mismatch or missing tax
transaction after the payment-success grace window.

## Rejected alternatives

- **Keep Taxrate.io and separately enable Stripe Tax:** two competing totals and
  inconsistent reporting.
- **Let Stripe own the checkout total:** conflicts with Medusa's cart, promotion,
  shipping, inventory, order, and payment-session authority.
- **Switch Stripe Tax on merely because readiness is green:** configuration
  readiness does not replace the sandbox golden matrix or owner approval.
- **Trust an effective percentage without exact-total proof:** line rounding and
  mixed-tax carts can diverge by cents.

## References

- [Stripe: calculate tax in custom PaymentIntent flows](https://docs.stripe.com/tax/payment-intent)
- [Stripe: set up Tax](https://docs.stripe.com/tax/set-up)
- [Stripe: test Tax in a sandbox](https://docs.stripe.com/tax/testing)
- [Stripe: product tax codes and shipping treatment](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior)
- [Stripe: Tax Calculation object](https://docs.stripe.com/api/tax/calculations/object)
- [Medusa: Tax Module Provider](https://docs.medusajs.com/resources/commerce-modules/tax/tax-provider)
- [Medusa: cart tax lines and recalculation](https://docs.medusajs.com/resources/commerce-modules/cart/tax-lines)
- [Medusa: provider tax-line calculation](https://docs.medusajs.com/resources/commerce-modules/tax/tax-calculation-with-provider)
