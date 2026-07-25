# ADR 0001: Use Medusa Payment Sessions as checkout authority

- Status: accepted
- Date: 2026-07-25
- Scope: guest web checkout

## Context

The store currently contains two Stripe integrations:

1. the active checkout initializes a Medusa payment collection and Stripe
   PaymentIntent, mounts the legacy Card Element, confirms the PaymentIntent in
   the browser, and then completes the Medusa cart;
2. an older custom backend creates an unrelated Stripe Checkout Session,
   reconstructs item/shipping/tax totals, handles a custom webhook, and uses a
   separate confirmation lookup.

Medusa already owns catalog pricing, promotions, shipping, tax, inventory,
payment collections, orders, and reservations. A second Stripe Checkout
Session duplicates those authorities and permits the charged total to diverge
from the order total.

Medusa 2.18 also documents that its complete-cart workflow validates payment
session state but does not compare the payment session amount with the cart
total. The installed workflow exposes a locked `validate` hook before order
creation and payment authorization.

## Decision

- Medusa is the sole commerce and order authority.
- Medusa's official Stripe provider is the sole integration allowed to create
  new Stripe PaymentIntents for checkout.
- The browser communicates only with same-origin semantic checkout routes that
  resolve the signed, HttpOnly cart cookie. A raw cart ID is not checkout
  identity.
- Stripe's Payment Element replaces the legacy Card Element.
- Browser completion, Medusa's official Stripe webhook, and a bounded
  reconciliation job converge on Medusa's idempotent complete-cart workflow.
- The `completeCartWorkflow.validate` hook rejects non-USD, non-finite,
  over-precision, non-Stripe, duplicate-session, amount-mismatch, and
  currency-mismatch states using the same locked cart snapshot that Medusa uses
  to create the order.
- Positive totals require exactly one processable `pp_stripe_stripe` payment
  session. Zero totals never create a Stripe PaymentIntent.
- Automatic capture remains disabled until exact amount mapping, successful
  completion, compensation, webhook, and reconciliation behavior pass in the
  Stripe sandbox.
- Customer confirmation requires a Medusa order linked to the signed cart and
  a short-lived receipt grant. A Stripe redirect or success state alone is not
  confirmation.
- The custom Checkout Session creation path stops accepting new traffic only
  after the official provider path passes staging proof. Historical lookup is
  retained temporarily and removed after review.

## Consequences

### Benefits

- One charged amount, one payment authority, and one order lifecycle.
- Medusa retains its cart lock, inventory reservation, idempotency, and payment
  compensation behavior.
- Stripe card data remains inside Stripe-hosted Elements.
- Browser closure or response loss can recover through the official webhook and
  reconciliation path.
- Stable checkout problem codes can map failures to safe customer actions.

### Costs

- The checkout page and same-origin API must be decomposed around a server
  projection and revision.
- Payment Element, return handling, receipt grants, webhook registration,
  reconciliation, and operations runbooks require new tests and monitoring.
- The legacy custom Stripe route and webhook need a staged compatibility window
  before deletion.

## Safety and rollout

Implementation is restricted to local development and Railway staging with
Stripe test/sandbox keys. No production payment configuration or traffic
change is authorized by this ADR.

The rollout order is:

1. complete the major-unit money cutover and verify exact values;
2. install the locked amount/currency validation hook;
3. prove one disposable Stripe test PaymentIntent maps exactly;
4. build and test semantic server contracts;
5. prove automatic capture, webhook completion, and compensation in the
   sandbox;
6. replace the browser UI with Payment Element;
7. run the complete failure, recovery, accessibility, and device matrix;
8. request separate production approval.

## References

- [Medusa checkout flow](https://docs.medusajs.com/resources/storefront-development/checkout)
- [Medusa payment step](https://docs.medusajs.com/resources/storefront-development/checkout/payment)
- [Medusa complete cart](https://docs.medusajs.com/resources/storefront-development/checkout/complete-cart)
- [Medusa Stripe provider](https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider/stripe)
- [Medusa workflow hooks](https://docs.medusajs.com/learn/fundamentals/workflows/workflow-hooks)
- [Stripe Payment Element](https://docs.stripe.com/payments/payment-element)
- [Stripe PaymentIntent status and webhooks](https://docs.stripe.com/payments/payment-intents/verifying-status)
- [Stripe webhook behavior](https://docs.stripe.com/webhooks)
