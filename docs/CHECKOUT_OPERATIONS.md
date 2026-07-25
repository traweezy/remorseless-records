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
- Any checkout reconciliation `failed > 0`, safety cap, webhook failure, or
  amount-validation failure requires investigation.

Useful aggregate log events:

- `Checkout reconciliation completed`
- `Checkout reconciliation needs attention`
- `Checkout reconciliation failed`
- `Anonymous cart retention completed`
- `Abandoned checkout retention completed`
- `checkout_payment_*` validation errors from the complete-cart hook

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

Expected safety behavior:

- Once Stripe confirmation begins, an unknown result goes to
  `/checkout/recover`; it never displays an invitation to pay again.
- Recovery returns to checkout only for a definite active/failed state.
- Confirmation requires a completed cart plus order-cart link.
- The return handler strips third-party query parameters before rendering.
- The cart cookie clears only after authoritative order confirmation.
- The receipt cookie is HttpOnly, signed, 30 minutes, and scoped to
  `/api/checkout/confirmation`.

## Incident: payment succeeded but no order appears

1. Tell the shopper not to submit payment again.
2. Check aggregate webhook delivery state in Stripe Workbench.
3. Check the Medusa payment session status and whether an `order_cart` link
   exists. Do not expose the client secret.
4. Check the `reconcile-checkout-payments` job result.
5. If the session is authorized/captured and no link exists, leave the official
   webhook enabled to process payment events and the reconciliation job enabled
   to retry Medusa's complete-cart workflow.
6. Investigate inventory, shipping, tax, and `checkout_payment_*` validation
   failures.
7. If Medusa's workflow compensated by refunding/canceling, verify that through
   Medusa and Stripe before asking the shopper to try again.
8. Do not manually create an order or directly capture/refund in Stripe unless
   a separately approved incident procedure establishes the Medusa state.

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

## Secret and webhook rotation

Cart signing supports `CART_COOKIE_SECRET_PREVIOUS`; keep the prior secret for
one 30-day cart lifetime during a planned rotation.

`CHECKOUT_BFF_SECRET` must change on backend and storefront together. During
cutover, expect recovery requests signed with a mismatched key to fail closed.
Use a coordinated staging deployment and complete an in-flight recovery smoke
test.

`CHECKOUT_RECEIPT_SECRET` is storefront-only. Rotating it invalidates existing
30-minute receipt grants; email remains the durable receipt.

For Stripe webhook-secret rotation:

1. Create/rotate the test endpoint in Stripe.
2. Update the backend secret and deploy in a coordinated cutover.
3. Deliver a signed test event and observe `2xx`.
4. Remove the former endpoint/secret only after no in-flight delivery remains.
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

## Release evidence checklist

- [ ] Environment is staging and every Stripe object is test mode.
- [ ] Lint, format, strict typecheck, unit/integration tests, and builds pass.
- [ ] Dependency audit, SBOM, secret scan, and header/CSP tests pass.
- [ ] Exact amount matrix passes.
- [ ] Success, 3DS, every decline, browser-close, response-loss, duplicate,
      webhook-delay, and two-tab cases pass.
- [ ] Official webhook returns `2xx` for signed events.
- [ ] Reconciliation completes a disposable eligible test cart and is bounded.
- [ ] Desktop and Chrome Pixel/iPhone device-emulation screenshots are
      inspected with no horizontal overflow.
- [ ] Keyboard, focus/error summary, screen-reader status, reduced motion, and
      200% zoom/reflow pass.
- [ ] Confirmation email and receipt match the Medusa order.
- [ ] GitHub CI and both Railway staging deployments report success.
- [ ] No production configuration or traffic changed.
