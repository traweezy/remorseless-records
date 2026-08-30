# ADR 0007: Model tax collection as an audited operating mode

- Status: accepted; implemented locally, staging acceptance pending
- Date: 2026-08-30
- Scope: tax calculation, checkout, payment binding, evidence, reporting, and
  merchant controls

## Context

The store owner needs to be able to stop collecting tax without deleting tax
regions, removing provider configuration, or changing catalog prices. The
existing control selects exactly one of TaxRate.io or Stripe Tax. That provider
assumption is carried through cart context, frozen quotes, Stripe metadata,
payment binding, evidence, reporting, and the Medusa Admin response schema.

Medusa assigns a tax provider to a tax region and asks that provider for cart
and order tax lines. Provider registration and enablement happen at application
startup, so removing or disabling a registered provider is not an appropriate
merchant-facing runtime control. Stripe similarly distinguishes disabling tax
collection from a calculation that legitimately returns zero tax. A zero result
from a provider must not be confused with a deliberate store-wide decision not
to calculate tax.

Tax collection is a compliance decision. Current Connecticut DRS guidance says
retailers required to register generally must collect applicable sales tax and
also restricts advertising that tax will not be added. This application can
provide the requested operational control, but it cannot decide whether using
that control is legally appropriate.

## Decision

Add a first-class `collection_mode` to the durable tax control:

- `collect`: calculate tax through the selected provider;
- `disabled`: deliberately collect no tax for new, unfrozen quotes.

The selected provider remains a separate field while collection is disabled.
This keeps its configuration intact and makes re-enablement explicit. A disabled
mode is not represented as a fake Medusa or external tax provider.

Every mode or provider transition increments the same monotonically increasing
control generation and writes one immutable audit record. The record includes
the actor, reason, idempotency key, prior and next mode, prior and next provider,
generation pair, and a fixed acknowledgement version. Provider secrets,
addresses, customer information, and free-form upstream errors remain excluded.

## Runtime behavior

### New and existing carts

- A cart without a processable payment session adopts the current mode and
  generation on its next tax refresh.
- A cart with a frozen quote keeps its original mode, provider, generation,
  fingerprint, tax lines, and Stripe calculation until the normal payment
  session is safely replaced or the cart expires.
- Completed orders and existing refunds are never repriced.
- A provider change made while collection is disabled selects the provider to
  use after re-enablement; it does not make a provider call.

### Explicit zero-tax evidence

Disabled mode returns a controlled zero-rate tax line for every Medusa item and
shipping subject. Returning no lines would make a deliberate decision
indistinguishable from a broken or incomplete calculation. Each line carries
only the internal mode, generation, subject fingerprint, and fixed code needed
to prove one coherent quote.

The disabled calculation path:

- makes zero TaxRate.io and Stripe Tax requests;
- does not read or decrement TaxRate.io quota;
- does not create a Stripe Tax Calculation or Transaction;
- does not link a Stripe Tax hook to the PaymentIntent;
- still proves the Medusa cart total, payment collection, payment session, and
  PaymentIntent amounts agree; and
- persists explicit zero-tax payment evidence so reporting does not classify
  the order as legacy or missing evidence.

Payment metadata gains an allowlisted collection-mode field. Disabled evidence
has a null calculation ID and null external tax transaction ID. Refund and
dispute reconciliation must not expect a tax reversal for that evidence.

### Fail-closed boundaries

- `collect` continues to fail closed when its selected provider cannot produce
  an exact result. It must never fall back to disabled mode or zero tax.
- `disabled` continues to require the authoritative control context. Missing,
  malformed, or mixed mode/generation evidence stops payment.
- Re-enabling collection is rejected unless the selected provider passes its
  readiness gate.
- Concurrent transitions use the distributed lock, expected generation, and
  idempotency key already used for provider switches.

## Admin experience

The Tax Control workspace presents three plain-language operating choices:

1. Do not collect tax.
2. Collect using TaxRate.io.
3. Collect using Stripe Tax.

Provider configuration and readiness remain visible separately from the current
collection mode. Turning collection off requires:

- `tax_control:update` permission;
- the current expected generation;
- a reason that explains the business decision;
- a typed acknowledgement that tax will be zero on new eligible checkouts;
- an impact preview for open and payment-frozen checkouts; and
- a confirmation that existing frozen checkouts and completed orders will not
  be repriced.

The screen must not imply that the application has determined no tax is owed.
It links to the operating runbook and states that the store owner is responsible
for registrations, collection obligations, returns, and professional advice.

## Storefront experience

- Checkout displays `Tax not collected` and `$0.00` for an explicit disabled
  quote; it does not label the result as an exemption or provider-calculated
  zero.
- The payable total remains server-owned and is refreshed after relevant cart
  changes.
- Receipts and order detail retain the amount actually charged and the
  historical tax decision without exposing internal provider controls.

## Migration and rollback

Use expand-only migrations:

1. Add non-null mode columns with the existing behavior as the default.
2. Backfill existing controls, audits, and evidence as `collect`.
3. Deploy readers that accept the expanded schema.
4. Deploy the disabled calculation and transition writers.
5. Enable the Admin control only after the complete test matrix passes.

Rollback hides the Admin control and leaves the stored mode/audit history
intact. It must never coerce disabled evidence into provider evidence. If the
runtime cannot honor a persisted disabled state, startup/readiness fails rather
than silently collecting tax.

## Required verification

- transition idempotency, stale-generation, concurrency, authorization, and
  acknowledgement tests;
- zero provider-call proof at service, Redis/DNS, and staging runtime levels;
- item, shipping, mixed, discounted, cart-edit, payment-prepared, completion,
  refund, dispute, and abandoned-cart cases;
- exact Medusa/payment/Stripe amount binding without a Stripe Tax hook;
- explicit reporting and CSV classification for disabled evidence;
- re-enable readiness and frozen-cart preservation;
- keyboard, screen-reader, error-focus, mobile, and real desktop screenshot
  acceptance for both disable and re-enable flows; and
- updated client, support, tax-control, filing, checkout, refund, incident, and
  rollback documentation.

## Consequences

This is intentionally more work than adding `disabled` to the provider enum.
The separate mode preserves provider configuration, prevents ambiguous
historical evidence, and makes external-call and reporting behavior testable.
It also preserves the rule that provider failure can never silently become zero
tax.

## Implementation record

The accepted design is implemented through expand-only migration
`Migration20260830150000` and the existing Tax Control singleton. The durable
control, immutable transition audit, quote evidence, cart context, tax-line
identity, Stripe PaymentIntent metadata, and filing projection now all carry
the collection mode explicitly.

The disabled calculator emits a zero line for every item and shipping subject
before any TaxRate.io, Stripe Tax, Redis quota, or tax-cache path can run.
Payment binding still validates the Medusa and Stripe payment amount, currency,
cart identity, fingerprint, generation, and mode, but rejects any attached
Stripe Tax hook for a disabled decision. Lifecycle reconciliation records
payment/refund/dispute state without requesting a tax transaction or reversal.

Admin exposes the three accepted choices with a reason, exact typed
acknowledgement for disabling, frozen-checkout impact, provider readiness for
re-enablement, response-loss reconciliation, and mode-aware immutable history.
Checkout and receipts say **Tax not collected**. Tax Records assigns the gross
amount to **Sales pending tax review**, exposes a collection-decision filter,
and exports `collection_mode` plus
`unclassified_sales_pending_review`; it never promotes disabled sales to
exempt or nontaxable.

Local unit, integration, concurrency, payment, refund, reporting,
no-provider-call, strict type, lint, Storefront projection/receipt, production
build, repository QA, dependency-policy, and peer checks cover the implemented
paths. A real graphical Chromium pass exercised the collecting state, completed
disable prompt, and resulting disabled state at 3,200 x 1,280 without horizontal
overflow. Scoped axe analysis of the project-owned workspace reported zero
violations or incomplete checks. The staging-configured Storefront production
build and full local Playwright matrix passed 53 tests with two intentional
skips and zero failures across desktop checkout, Pixel 7, and iPhone 15 Pro.
Those tests use explicit rendered-state assertions after `domcontentloaded` so
background cache and telemetry activity cannot deadlock the release gate.
Database migration rehearsal, re-enable browser coverage, the no-provider-call
staging trace, exact-SHA CI, and Railway acceptance remain release evidence
rather than assumptions in this ADR.

## References

- [Medusa Tax Module](https://docs.medusajs.com/resources/commerce-modules/tax)
- [Medusa Tax Module Provider](https://docs.medusajs.com/resources/commerce-modules/tax/tax-provider)
- [Medusa provider tax calculation](https://docs.medusajs.com/resources/commerce-modules/tax/tax-calculation-with-provider)
- [Medusa cart tax-line context hooks](https://docs.medusajs.com/resources/commerce-modules/cart/tax-lines)
- [Stripe Tax setup and disabling collection](https://docs.stripe.com/tax/set-up)
- [Stripe Tax PaymentIntent lifecycle](https://docs.stripe.com/tax/payment-intent)
- [Stripe zero-tax calculation reasons](https://docs.stripe.com/tax/zero-tax)
- [Connecticut sales and use tax information](https://portal.ct.gov/drs/sales-tax/tax-information)
