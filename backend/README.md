# Remorseless Records backend

This workspace is the Medusa 2 commerce authority. It owns catalog pricing,
inventory, carts, shipping, tax, the official Stripe payment session, orders,
reservations, and notification events. The Next.js storefront is a BFF and UI;
it does not duplicate these rules.

## Local setup

From the repository root, use the pinned pnpm workspace:

```bash
pnpm install
cp backend/.env.template backend/.env
pnpm --filter backend dev
```

For a new local database only, initialize Medusa system data with
`pnpm --filter backend ib`. Do not seed, migrate, or reset a shared Railway
database as part of ordinary startup.

Required deployed services are PostgreSQL and Redis. MinIO and Meilisearch are
used for media and search. Local fallbacks exist for some modules, but deployed
checkout mutations and jobs require the shared Redis-backed workflow and
locking providers.

## Checkout payment authority

The only new-payment path is Medusa's official
`@medusajs/payment-stripe` provider (`pp_stripe_stripe`):

- Stripe automatic capture is enabled.
- Automatic payment methods are constrained by
  `STRIPE_PAYMENT_METHOD_CONFIGURATION`.
- The approved configuration contains card, Link, Apple Pay, and Google Pay;
  delayed methods and BNPL are excluded.
- The official signed webhook is
  `POST /hooks/payment/stripe_stripe`.
- The old custom Stripe Checkout Session routes and custom webhook no longer
  exist.

`src/workflows/hooks/validate-checkout-payment.ts` runs inside Medusa's locked
complete-cart snapshot. Positive USD carts require exactly one processable
official Stripe session, and the cart, payment collection, and session amounts
and currencies must match exactly. Zero-total orders require no payment
session.

`POST /store/checkout/status` is an internal recovery endpoint. It requires a
short-lived HMAC proof generated with `CHECKOUT_BFF_SECRET`; browsers never
receive that secret or call the endpoint directly. It returns an order ID only
to the storefront server and only after the cart is durably completed and
linked to the order.

## Stripe configuration

Configure all Stripe values together or leave all three empty:

- `STRIPE_API_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PAYMENT_METHOD_CONFIGURATION`

Use `sk_test_...` and a test-mode `pmc_...` outside production. Never log
values. The webhook endpoint must subscribe to:

- `payment_intent.amount_capturable_updated`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.partially_funded`

For local test-mode forwarding:

```bash
stripe listen \
  --forward-to localhost:9000/hooks/payment/stripe_stripe
```

Use the temporary signing secret printed by that process as the local
`STRIPE_WEBHOOK_SECRET`.

## Checkout reconciliation

The `reconcile-checkout-payments` job is a safety net for a lost browser
completion request/response and delayed payment-state processing. Every two
minutes it can inspect a bounded set of old incomplete carts. It calls Medusa's
idempotent complete-cart workflow only when a fresh read shows:

- exactly one processable official Stripe session;
- that session is `authorized` or `captured`;
- the cart is older than the grace period and not completed;
- no order is already linked.

It never creates, confirms, captures, cancels, or refunds a Stripe payment
directly. It is disabled by default:

- `CHECKOUT_RECONCILIATION_ENABLED` (default `false`)
- `CHECKOUT_RECONCILIATION_MIN_AGE_SECONDS` (default `120`, range `60–3600`)
- `CHECKOUT_RECONCILIATION_MAX_ATTEMPTS` (default `50`, maximum `250`)

An aggregate warning is emitted if any completion fails or the safety cap is
reached. The summary excludes cart, payment, order, email, and address values.

## Cart and checkout retention

Two daily, opt-in jobs cover different records.

`remove-expired-anonymous-carts` runs at `04:17 UTC` and removes incomplete
carts with no customer and no email:

- `ANONYMOUS_CART_RETENTION_ENABLED` (default `false`)
- `ANONYMOUS_CART_RETENTION_DAYS` (default/minimum `37`)
- `ANONYMOUS_CART_RETENTION_MAX_DELETIONS` (default `1000`, maximum `10000`)

`remove-abandoned-guest-checkouts` runs at `04:37 UTC` and handles old guest
checkouts containing email/address PII:

- `ABANDONED_CHECKOUT_RETENTION_ENABLED` (default `false`)
- `ABANDONED_CHECKOUT_RETENTION_DAYS` (default/minimum `37`)
- `ABANDONED_CHECKOUT_RETENTION_MAX_DELETIONS` (default `250`, maximum `2500`)

The guest-checkout job re-reads each cart under a lock and protects customer,
completed, recently updated, and order-linked carts. It also protects every
unresolved or successful payment state. It deletes only no-payment carts or
unused sessions in safe `pending`, `canceled`, or `error` states; safe sessions
are removed through Medusa's official payment workflow before cart soft
deletion.

The 37-day minimum preserves the storefront's 30-day cart-cookie lifetime plus
a seven-day grace period. Read-only candidate counts must be reviewed before
either job is enabled in a new environment.

## Tax cache

The tax lookup module uses a bounded in-memory cache and Redis when configured:

- `TAX_RATE_LOOKUP_CACHE_TTL_MS` (default `300000`)

Tax failures remain checkout failures. The application does not silently
replace a failed lookup with zero tax.

## Fulfillment location contract

Storefront checkout ships from the canonical `HQ` stock location. Medusa
evaluates inventory and shipping eligibility at the same location, so an
option attached to an empty legacy warehouse is intentionally unavailable even
when aggregate inventory appears positive.

`pnpm run shipping:update` repairs this association without changing any stock
count. It enables the calculated per-item provider at `HQ`, scopes its service
zone to the United States, and updates the location's existing shipping option.
The storefront follows Medusa's two-step calculated-rate contract: it first
lists eligible options and then calls the provider-backed calculate endpoint
for each calculated option before displaying or selecting it.
Set `SHIPPING_STOCK_LOCATION_NAME` only when an environment intentionally uses
a different canonical location. The command fails instead of guessing when the
location is absent or ambiguous. See
[`src/scripts/README.md`](src/scripts/README.md#shipping-and-inventory-location-repair)
for the exact behavior and verification step.

## Quality commands

```bash
pnpm --filter backend exec eslint --max-warnings=0 .
pnpm --filter backend exec tsc --noEmit
pnpm --filter backend test
pnpm --filter backend build
```

Operational diagnosis, rollback, webhook rotation, and incident procedures are
documented in [`../docs/CHECKOUT_OPERATIONS.md`](../docs/CHECKOUT_OPERATIONS.md).
