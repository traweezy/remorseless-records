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

For a new local database only, migrate, synchronize module links, and then
seed explicitly:

```bash
pnpm --filter backend exec medusa db:migrate
pnpm --filter backend exec medusa db:sync-links
pnpm --filter backend run seed
```

Do not seed, migrate, or reset a shared Railway database as part of ordinary
process startup.

Required deployed services are PostgreSQL and Redis. MinIO and Meilisearch are
used for media and search. Local fallbacks exist for some modules, but deployed
checkout mutations and jobs require the shared Redis-backed workflow and
locking providers.

## Release and health model

Railway runs `pnpm --filter backend run release:prepare` before switching
traffic. The command fails closed if a migration, module-link sync, read-only
object-storage check, or atomic Meilisearch rebuild fails. Ordinary process
startup only starts Medusa; it never writes secrets to disk, migrates, seeds,
changes bucket policy, or rebuilds search.

- `GET /live` checks only that the process can answer HTTP.
- `GET /ready` checks PostgreSQL, Redis, Meilisearch, and object storage with
  bounded timeouts. It returns `503` when any configured dependency fails.
- `GET /api/health` is a temporary liveness alias for older monitors.

Production uses Medusa's official `@medusajs/file-s3` provider in
S3-compatible path-style mode. The provider keeps the historical `minio` ID so
existing file records remain valid. The bucket and public-read policy are
provisioned outside application startup.

A deliberate staging write/read/delete canary is available, but never runs
during deploy:

```bash
OBJECT_STORAGE_WRITE_CHECK_CONFIRM=upload-and-delete-canary \
  pnpm --filter backend run storage:verify-write
```

Custom catalog and news image uploads use `POST /admin/managed-uploads`.
Requests are limited to ten files, 12 MiB per file, and 20 MiB total; filenames,
extensions, media types, and image signatures are validated before the upload
is delegated to Medusa's File Module. The unused presigned-upload route is
disabled because it bypasses server-side content inspection.

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

## Tax control and payment evidence

The Tax Module has two installed calculation engines, but exactly one is active
for a new quote:

- TaxRate.io supplies a ZIP-based percentage and its returned monthly
  quota/usage.
- Stripe Tax supplies address-aware, per-line calculations and a calculation
  ID that is bound to the exact Medusa-created PaymentIntent.

An authenticated Medusa Admin can review readiness, quota, exact paginated
checkout impact, payment evidence, and an immutable provider-switch history at
**Tax control**. The current setup is read-only; an explicit provider action
opens the confirmation and audit-reason dialog. Switches increment an internal
generation. Open carts without a prepared payment use the new generation on
their next tax refresh; prepared payments keep their original provider,
generation, fingerprint, and calculation/rate. No cart can combine two
providers.

The storefront BFF calls `POST /store/checkout/tax-link` with a short-lived,
purpose-bound `CHECKOUT_BFF_SECRET` proof before returning a client secret and
again before cart completion. The backend verifies the Medusa cart, collection,
session, Stripe PaymentIntent, tax fingerprint, amount, currency, and—when
Stripe Tax is active—the unexpired calculation. One calculation can be attached
to only one PaymentIntent.

Non-PII evidence is reconciled on `order.placed`, `payment.captured`, and
`payment.refunded`, with an hourly bounded safety-net job. It records successful
tax transactions, every individual refund reversal, failed refunds,
Medusa/Stripe refund-ledger mismatches, disputes, and association errors. A
dispute is surfaced for manual tax review because Stripe does not automatically
reverse tax merely because a payment is disputed.

Existing Stripe-taxed order lines retain their historical effective tax rates
during returns and safe order updates. New taxable items on a Stripe-taxed order
fail closed: Medusa may require a separate additional payment, and that payment
needs its own bound Stripe Tax calculation. Until that dedicated flow exists,
create a separate order instead of bypassing tax/payment evidence.

Configuration:

- `TAX_RATE_LOOKUP_API_KEY`
- `TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE` — optional reviewed ZIP for a deliberate
  admin quota refresh; each refresh consumes one real TaxRate.io lookup.
- `TAX_RATE_LOOKUP_CACHE_TTL_MS` — default `300000`.
- `STRIPE_TAX_SHIPPING_TAX_CODE` — required for Stripe Tax readiness.
- `STRIPE_TAX_QUOTE_TTL_MS` — local/Redis quote ceiling, default `1800000`.

Tax and payment-association failures remain checkout failures. The application
does not silently replace a failed final lookup with zero tax. Operational
procedures are in
[`../docs/TAX_CONTROL_OPERATIONS.md`](../docs/TAX_CONTROL_OPERATIONS.md).

## Tax records and filing workpapers

The authenticated Admin **Tax records** route reads Medusa orders, captured
payments, refunds, delivery destinations, and preserved tax-line evidence into
an auditable period report. It provides New York quarter and March–February
sales-tax-year presets, quality gates, transaction and destination grids, and
signed transaction-detail and destination-summary CSV downloads.

The reporting ledger intentionally uses completed commerce records rather than
raw tax-provider calls. Cached lookups may serve many abandoned carts, so an
API-call log cannot establish sales-tax liability. Provider generations and
jurisdiction details remain supporting evidence on the Medusa tax lines.

Legacy tax rows and partial-refund allocations are never presented as
filing-ready: they remain visible with explicit review warnings in the UI and
exports. No customer names, contact details, or street addresses are exported.
The extension does not file or pay a return. See the data contract, filing
workflow, retention rules, and limitations in
[`../docs/TAX_RECORDS_AND_FILING.md`](../docs/TAX_RECORDS_AND_FILING.md).

## Fulfillment location contract

Storefront checkout ships from the canonical `HQ` stock location. Medusa
evaluates inventory and shipping eligibility at the same location, so an
option attached to an empty legacy warehouse is intentionally unavailable even
when aggregate inventory appears positive.

`pnpm run shipping:update` repairs this association without changing any stock
count. It enables the calculated per-item provider at `HQ`, scopes its service
zone to the United States, updates the location's existing shipping option, and
links imported published physical products that are missing Medusa's default
shipping profile.
The storefront follows Medusa's two-step calculated-rate contract: it first
lists eligible options and then calls the provider-backed calculate endpoint
for each calculated option before displaying or selecting it.
Set `SHIPPING_STOCK_LOCATION_NAME` only when an environment intentionally uses
a different canonical location. The command fails instead of guessing when the
location is absent or ambiguous. See
[`src/scripts/README.md`](src/scripts/README.md#shipping-and-inventory-location-repair)
for the exact behavior and verification step.

## Managed product media and discography

The original import left product images on Big Cartel. The migration command
below moves one validated 2,000px maximum master per unique source through
Medusa's configured File Module (MinIO when deployed), deduplicates identical
bytes by SHA-256, and updates native Medusa and custom catalog references only
after every required source is staged.

The command is deliberately polite to Big Cartel: request starts are separated
by at least one second plus jitter, concurrency is bounded at two, requests
time out, `Retry-After` is honored, and retryable failures use exponential
backoff. JPEG, PNG, and WebP signatures, dimensions, declared content type,
byte limit, and checksum are validated before upload. A 2,000px maximum was
selected because the 520px detail gallery can render at 3x density; smaller
runtime sizes are generated by Next Image.

Run the dry inventory, optional two-image probe, confirmed staging, and
confirmed cutover in that order:

```bash
pnpm --filter backend media:big-cartel:migrate
pnpm --filter backend media:big-cartel:migrate -- --probe=2
pnpm --filter backend media:big-cartel:migrate -- \
  --stage \
  --confirm-stage=stage-big-cartel-managed-media
pnpm --filter backend media:big-cartel:migrate -- \
  --apply \
  --confirm-cutover=replace-big-cartel-runtime-media
```

The state file and reports default to
`~/.local/share/remorseless-records/media-migration/`; use `--state-dir` to
choose another protected location. Staging is resumable. `--max-assets=N` is
available for a bounded staging test but is rejected for cutover. Do not remove
Big Cartel from Storefront image/CSP allow-lists until the cutover report has
zero unresolved sources.

Discography is not hand-maintained historical data. It is an exact projection
of every published custom catalog profile whose controlled product type is
`music-release`. The command validates the complete projection before a
serializable replacement and verifies one active row per Product ID afterward:

```bash
pnpm --filter backend discography:build
pnpm --filter backend discography:build -- \
  --apply \
  --confirm-replace=replace-discography-from-catalog
```

The replacement plan and completion report default to
`~/.local/share/remorseless-records/discography-rebuild/`. Existing records are
included in the pre-change plan for rollback and are not downloaded as managed
media because they are intentionally deleted.

## Quality commands

```bash
pnpm --filter backend exec eslint --max-warnings=0 .
pnpm --filter backend exec tsc --noEmit
pnpm --filter backend test
pnpm --filter backend build
```

Operational diagnosis, rollback, webhook rotation, and incident procedures are
documented in [`../docs/CHECKOUT_OPERATIONS.md`](../docs/CHECKOUT_OPERATIONS.md).
