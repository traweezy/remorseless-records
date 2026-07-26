# ADR 0002: Make Stripe Tax a Medusa-owned tax provider

- Status: proposed; activation blocked on tax configuration and sandbox proof
- Date: 2026-07-25
- Scope: US storefront tax calculation, reporting, refunds, and payment linkage

## Decision summary

Medusa remains the sole cart, total, order, and refund authority. If the store
adopts Stripe Tax, Stripe Tax will replace Taxrate.io as the calculation engine
behind Medusa's Tax Module Provider. Stripe must not calculate an independent
second total after Medusa has prepared the order.

The same fresh Stripe Tax `Calculation` used to populate Medusa's tax lines must
be linked to the Medusa-created PaymentIntent. The PaymentIntent amount must
equal both the locked Medusa cart total and the Stripe Tax calculation's
`amount_total` before payment can proceed.

This is not active yet. The Stripe sandbox was inspected read-only on
2026-07-25 and reported:

- `livemode: false`;
- Tax settings status `pending`;
- no head-office address;
- no default product tax code or tax behavior; and
- no tax registrations.

Stripe documents that Tax only calculates tax in sandbox jurisdictions with a
test registration. Enabling it in the current state could therefore produce
zero-tax results that look technically successful but are commercially wrong.

## Why one tax engine

The current checkout already enforces Medusa as the payment and order
authority. Running Taxrate.io in Medusa while separately enabling Stripe Tax on
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

## Current implementation and its limits

`backend/src/modules/tax-rate-provider/service.ts` currently calls Taxrate.io by
US postal code, caches one percentage for five minutes, and applies that same
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

Implement a new `ITaxProvider` adapter under `backend/src/modules`, selected by
the US tax region. It will:

- validate the complete shipping address, currency, positive finite amounts,
  quantities, references, and mapped tax codes;
- send line amounts after Medusa discounts, plus the selected shipping amount,
  to Stripe Tax with `address_source=shipping`;
- use stable non-PII references based on Medusa line IDs;
- use bounded timeouts and safe retry/backoff only for retryable failures;
- store the calculation ID, expiry, cart revision/fingerprint, per-line tax,
  shipping tax, and jurisdiction breakdown in provider data;
- map the returned result into Medusa item and shipping tax lines; and
- fail closed with a customer-safe retry message when an exact result cannot be
  produced. It must never silently fall back to zero tax.

Medusa's provider contract expresses percentage tax lines, while Stripe returns
exact per-line tax amounts. Before rollout, a compatibility test must prove
that reconstructing the Stripe result through Medusa's rates produces the exact
same cent-rounded totals for all supported cases. If it cannot, extend the
Medusa tax workflow to persist the Stripe amounts directly; do not hide a
rounding difference with an adjustment line.

### 3. Calculation lifecycle

Stripe states that it does not recalculate tax or update the PaymentIntent
amount when a linked calculation changes. A calculation must therefore be
invalidated whenever any of these change:

- line, quantity, unit price, product tax code, or discount;
- delivery address;
- shipping option or amount;
- currency or tax behavior; or
- the calculation expires.

The final payment-session preparation runs a forced tax refresh under the same
cart lock used by checkout validation. The resulting calculation ID is linked
to the official Medusa Stripe PaymentIntent using Stripe's tax calculation
hook. Payment preparation stops unless all three totals match exactly:

```text
Medusa locked cart total
  == Stripe PaymentIntent amount
  == Stripe Tax Calculation amount_total
```

No browser code handles tax IDs or recomputes tax.

### 4. Payment, order, refund, and dispute records

On successful payment, persist only non-PII reconciliation references:

- Medusa cart and order IDs/numbers;
- Stripe PaymentIntent ID;
- Stripe Tax calculation and transaction IDs; and
- tax engine/version and cart revision.

Stripe documents automatic tax-transaction creation for a successfully linked
PaymentIntent and automatic flat-amount reversals for refunds. Medusa must
initiate refunds, record the refund result, and reconcile the Stripe reversal.
Disputes require a separate operations path because Stripe does not
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
- Preserve the current provider behind an explicit rollback flag during the
  sandbox rollout. A single cart must never mix providers.

## Rollout gates

1. Obtain business approval for Stripe Tax pricing and professional confirmation
   of collection registrations and tax-code choices.
2. Configure Stripe Tax in the sandbox until settings are `active`; add at least
   one test registration.
3. Build catalog and shipping tax-code mappings with an explicit fallback.
4. Implement the provider and PaymentIntent calculation link behind a disabled
   feature flag.
5. Run a golden matrix across taxable, non-taxable, mixed, discounted, shipping,
   bundle, refund, failed-payment, expired-calculation, and rounding-boundary
   cases.
6. Prove the three-way amount invariant and tax transaction/reversal linkage in
   Stripe sandbox.
7. Compare shadow Stripe results with current checkout results without charging
   customers.
8. Enable only in staging, monitor, and request separate production approval.

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
- **Switch Stripe Tax on immediately:** the sandbox is pending and has no
  registrations or tax defaults.
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
