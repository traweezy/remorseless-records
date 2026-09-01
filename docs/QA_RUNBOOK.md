# QA & Observability Runbook

This document outlines repeatable steps for validating Remorseless Records before shipping. It covers accessibility & performance, payments, and search consistency. Follow the sections sequentially; each can be run independently when relevant functionality changes.

---

## 1. Accessibility & Performance Sweep

> Quick automation: `QA_BASE_URL=http://127.0.0.1:3000 pnpm run qa:ci`
> (runs lint/typecheck, real Chrome mobile emulation with axe, pa11y axe
> audits, and Lighthouse assertions). Use the manual steps below to investigate
> failures.
> Set `QA_PATHS=/about,/accessibility` to replace the default dynamic route set
> when a deterministic, backend-independent local sweep is required.
> If Chrome is not discoverable on `PATH`, set `PA11Y_CHROME_EXECUTABLE_PATH`
> for pa11y, `QA_CHROME_EXECUTABLE_PATH` for the mobile audit, and
> `CHROME_PATH` for Lighthouse to a sandbox-capable Chrome binary.
> Do not disable the browser sandbox to make a host pass.
> Puppeteer install scripts and bundled-browser downloads are explicitly
> blocked in every workspace. Keep using a reviewed external Chrome binary;
> do not re-enable Puppeteer builds to repair a missing local browser.
> Pa11y and Lighthouse must resolve the single reviewed
> `@puppeteer/browsers@3.0.6` manager. Run
> `pnpm run qa:browser-toolchain-security` after browser-tooling changes; it
> fails if the removed `extract-zip` package returns, required Puppeteer 24
> runtime symbols disappear, or a Puppeteer browser-download install script
> becomes enabled.

### 1.1 Keyboard / Screen-reader

1. Start backend + storefront with production-like data.
2. Using only the keyboard:
   - Tab through global header (Nav → Quick Shop triggers → Cart). Verify focus ring and skip no elements.
   - On `/catalog`, open a Quick Shop modal and change variants; ensure focus is trapped and `Esc` closes it.
   - On a typed product detail route (`/music-release/[slug]`, `/bundle/[slug]`, or `/merch/[slug]`), confirm the variant selector is keyboard-operable and “Add to cart” updates the toast.
   - On `/bundle/[slug]`, confirm the fixed composition remains visible when an item is sold out, the card/detail sold-out indicators are textual, and the affected bundle variant cannot be added.
   - On `/cart`, adjust quantities and open checkout.
   - On `/checkout`, submit empty Contact and Delivery forms. Confirm focus
     moves to the invalid field/error summary and every summary item focuses
     its field.
   - Complete Contact, Delivery, and Delivery method using only the keyboard.
     Confirm Payment Element fields and Place order remain keyboard-operable.
3. Launch VoiceOver (macOS) or NVDA (Windows):
   - Read the product page, ensuring variant options announce the selected state.
   - Verify Quick Shop modal announces title, description, and product image alt text.
   - Verify checkout section state, shipping radios, payment errors, recovery
     status, and confirmation receipt updates are announced without duplicate
     or raw technical details.

### 1.2 Mobile Device Rendering

Do not use a resized desktop viewport as mobile validation. Run the real browser
surface with Chrome device emulation so the user agent, device scale factor,
touch input, mobile viewport, and safe-area behavior match a phone.

1. Validate at least the `Pixel 7` and `iPhone 15 Pro` Chrome device profiles.
2. Check `/`, `/catalog`, a representative route for each typed product family,
   `/cart`, `/checkout`, `/checkout/recover`, and a granted
   `/checkout/confirmation`.
3. Confirm the document width matches the viewport width (`scrollWidth ===
clientWidth`); intentional carousels must clip or scroll within their own
   container instead of widening the page.
4. Confirm the app bar spans the viewport, content remains inside its side
   gutters, long product titles wrap, and every control remains touchable.
5. Capture and inspect a real rendered screenshot for each changed mobile
   surface before sign-off.

Run the independent mobile gate against every public route:

```bash
QA_BASE_URL=http://127.0.0.1:3000 \
QA_SCREENSHOT_DIR=/tmp/remorseless-mobile-audit \
pnpm run qa:mobile
```

The gate launches real Chrome with Pixel 7 and compact 320-pixel phone
emulation. It fails on horizontal page overflow, missing touch emulation,
standalone controls below the WCAG 2.2 24×24 CSS-pixel minimum, HTTP errors, or
axe WCAG A/AA violations. It logs visible text below 11 CSS pixels as a
typography warning for manual review. Navigation waits for DOM content, a
visible `main`, loaded fonts, and two animation frames, then gives background
catalog-recovery/telemetry traffic a bounded five-second opportunity to become
idle. Global network idleness is not a prerequisite for a usable page. Use
`QA_PATHS=/contact,/checkout` for a targeted pass.
`QA_CHROME_NO_SANDBOX=1` exists only for an already isolated container or
workstation session whose user namespaces are unavailable; do not use it when
a browser sandbox can launch normally.

The equivalent isolated-container escape hatch for Lighthouse is
`LHCI_CHROME_NO_SANDBOX=1`. It is opt-in and must not be set on an ordinary
workstation.

### 1.3 Lighthouse acceptance

Build against the deterministic Medusa fixture, start that exact production
artifact, then run:

```bash
QA_LIGHTHOUSE_RUNS=3 \
LHCI_OUTPUT_DIR=/tmp/remorseless-lighthouse-reports \
pnpm run qa:lighthouse
```

The default matrix runs Home, Catalog, the representative
`/music-release/pathologist-pathological-decomposition` Product, the legacy
`/cart` drawer entry, Checkout, and Privacy three times each. Use
`QA_PRODUCT_PATH` to select another valid typed Product or `QA_PATHS` for a
focused diagnostic run. Do not replace the required three-run release median
with a single cold sample.

Enforced median budgets are:

| Metric                    | Budget                         |
| ------------------------- | ------------------------------ |
| Performance               | ≥ 0.80                         |
| Accessibility             | ≥ 0.95                         |
| Best Practices            | ≥ 0.90                         |
| SEO                       | ≥ 0.90 except noindex Checkout |
| First Contentful Paint    | ≤ 3,000 ms                     |
| Largest Contentful Paint  | ≤ 4,500 ms                     |
| Total Blocking Time       | ≤ 350 ms                       |
| Cumulative Layout Shift   | ≤ 0.10                         |
| Total transferred bytes   | ≤ 1,500,000                    |
| Script bytes / count      | ≤ 850,000 / 65                 |
| Total request count       | ≤ 120                          |

Reports are written to the filesystem and uploaded from CI as private
artifacts. Do not use Lighthouse temporary public storage for release evidence.
Investigate a regression instead of relaxing a budget to match it.

### 1.4 Automated Checks

```bash
# Formatting, static analysis, and repository policies
pnpm run qa:lint

# Explicit semantic type safety (Biome does not replace the TypeScript compiler)
pnpm --filter remorseless-records-storefront run typecheck
pnpm --filter backend exec tsc --noEmit

# Dashboard DOM compiler context and browser-boundary assertion regression
pnpm run qa:admin-browser-boundary

# Admin matrix wiring, keyboard guard, semantics, and dependency patch drift
pnpm run qa:admin-accessibility-boundary

# Browser QA dependency resolution and blocked browser-download install scripts
pnpm run qa:browser-toolchain-security

# Deterministic Medusa fixture endpoints and Browser Smoke release wiring
pnpm run qa:storefront-provider-fixture
```

### 1.5 Disposable PostgreSQL and Redis integration

Run the application boundary against fresh, local-only services:

```bash
pnpm run qa:disposable-integration
```

The orchestrator starts PostgreSQL 18.6 and Redis 8.10.1 from version- and
digest-pinned official images. Host ports bind only to loopback and default to
`55432` and `56379`; set `RR_INTEGRATION_POSTGRES_PORT` and
`RR_INTEGRATION_REDIS_PORT` to distinct non-privileged ports when those values
are occupied. The command supplies disposable credentials and blank payment
provider secrets itself. Never redirect it to a shared, staging, or production
service.

The gate applies the complete Medusa and custom migration chain, boots the real
API, verifies liveness/readiness/dependency health, proves tax collection still
defaults off, exercises persisted payment idempotency/failure/retry behavior,
and verifies Redis lock serialization and recovery. It then runs the focused
payment/queue regression suites and checks the generated API contract. The
Backend CI build depends on the equivalent service-container job.

Success or failure tears down the named Compose project, its network, and its
ephemeral volumes. An interrupt is trapped so partial startup is cleaned too.
After an interrupted host session, confirm no residue remains with:

```bash
docker compose --project-name remorseless-records-integration \
  --file compose.integration.yml ps --all
```

### 1.6 Admin accessibility and visual matrix

Build the actual Medusa Admin bundle before running its browser acceptance:

```bash
pnpm --filter backend run build
pnpm run qa:admin:accessibility
```

The matrix serves only the compiled Admin bundle and intercepts its GET and
OPTIONS requests with bounded, deterministic fixtures. Any mutation request is
rejected. Its 12 cases cover guided Product validation and offerings, existing
Product authoring, the native Product list and Catalog workspace,
Merchandising and its creation dialog, News and Discography creation dialogs,
Tax Control, Media Cleanup, Refund Operations, and Tax Records. Viewports cover
760-pixel narrow/mobile, 800-pixel 200%-equivalent, 1,440-pixel laptop, and
1,920-pixel wide layouts.

Every case must report zero axe violations and zero incomplete axe checks. The
gate also fails for missing landmarks/headings, route mismatch, document
overflow, unnamed controls, dangling `aria-controls`, positive tab order,
undersized interactive targets, motion under reduced-motion emulation, missing
or obscured focus, browser errors, or failed responses. Screenshots and the
JSON summary are written to `/tmp/remorseless-admin-accessibility` by default.
Inspect the changed surfaces; passing assertions do not prove visual hierarchy.

For a real graphical-desktop check, run one important route in headed mode,
capture the desktop, and inspect the resulting image:

```bash
DISPLAY=:0 ADMIN_ACCEPTANCE_HEADFUL=1 ADMIN_ACCEPTANCE_HOLD_MS=45000 \
ADMIN_ACCEPTANCE_HEIGHT=900 \
ADMIN_ACCEPTANCE_ROUTE=/app/catalog/products/product_acceptance \
ADMIN_ACCEPTANCE_SCREENSHOT=/tmp/remorseless-admin-accessibility/admin-headful.png \
ADMIN_ACCEPTANCE_WIDTH=1440 node qa/admin-visual-acceptance.mjs

DISPLAY=:0 flameshot full -p /tmp/admin-accessibility-final-desktop.png
```

If no graphical session or `flameshot` is available, record that limitation and
inspect the Puppeteer screenshots as fallback; do not describe the result as a
real desktop screenshot. The acceptance fixture is for rendering and
accessibility only. It is not staging health evidence and must never be changed
to issue writes.

### 1.7 Critical browser matrix

Pre-deploy Browser Smoke must use the loopback-only deterministic Medusa
fixture in `storefront/scripts/ci-medusa-fixture.mjs`. The fixture exposes only
the bounded read projections required to render Home, Product detail, Catalog,
and Discography; it rejects missing publishable keys, mutations, and unknown
routes. Both CI Playwright configurations start it automatically when it is not
already available. The Storefront CI job starts it before `next build` so no
client-bundled provider URL can silently point at staging.

Build with the fixture environment and production-like non-provider values,
then run both browser matrices:

```bash
CI_MEDUSA_FIXTURE_URL=http://127.0.0.1:4010 \
CI_MEDUSA_PUBLISHABLE_KEY=pk_ci_storefront_fixture_20260831 \
MEDUSA_BACKEND_URL=http://127.0.0.1:4010 \
NEXT_PUBLIC_MEDUSA_URL=http://127.0.0.1:4010 \
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://127.0.0.1:4010 \
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_ci_storefront_fixture_20260831 \
pnpm --filter remorseless-records-storefront run build
pnpm --filter remorseless-records-storefront run test:e2e \
  --config=playwright.ci.config.ts
pnpm --filter remorseless-records-storefront run test:e2e:critical
```

The gate runs seven non-destructive journeys in Chromium, Firefox, and WebKit:
home hydration, cart/empty state, quick-shop add, Product detail, desktop
filter refresh, checkout, and receipt confirmation. It fails on page/console
errors, overflow, invalid targets, broken focus/pointer affordances, unstable
scroll position, or missing commerce state. CI retains screenshots and traces
for 14 days when it fails.

This Storefront is guest-only and exposes no customer account or login route.
Do not run or credit the inherited database-reset account suite as current
application auth coverage. That suite is destructive and requires a dedicated
test database. Inspect at least one real rendered screenshot from each changed
critical surface before sign-off; automated assertions do not replace visual
review.

This deterministic gate is intentionally separate from staging acceptance.
After Railway deploys the exact green SHA, the staging operations monitor must
still exercise the live authenticated Product-handle and catalog-shelf
projections. A local fixture pass is never evidence that the deployed provider
is healthy.

### 1.8 Storefront launch acceptance

Run the deterministic launch matrix after the production build:

```bash
pnpm run qa:storefront:launch
```

Its 14 scenarios cover Home, Catalog, a typed Product, News/content reflow,
Terms, a populated 320-pixel Cart, empty Checkout with no eager Stripe request,
checkout validation/focus, paid/free disclosure semantics, confirmation,
recovery with reduced motion, privacy validation and non-PII success
reference, and consent-controlled storage/Bandcamp behavior. Every applicable
page is rejected for axe violations or incomplete/manual-review results,
runtime/console errors, failed unexpected responses, invalid or unnamed ARIA,
positive tab order, undersized targets, horizontal overflow, motion under
reduced-motion emulation, or hidden/obscured keyboard focus.

Screenshots are written to `/tmp/remorseless-storefront-launch` by default and
must be inspected. For UI changes, also open the exact production artifact in
a real headed browser and capture the graphical desktop with Flameshot. Record
which journeys have real-desktop evidence; automated Playwright captures do
not satisfy that separate review requirement.

The August 31, 2026 local slice passed 14/14 launch scenarios, 21/21 critical
Chromium/Firefox/WebKit journeys, and 34/34 Pixel 7/compact-phone public-route
audits. The Catalog Lighthouse optimization retest scored 0.91/0.83/0.81 with
a 0.83 diagnostic median. The final full 18-report matrix passed all six
routes; median performance was Home 0.87, Catalog 0.81, Product 0.89, Cart 0.85,
Checkout 0.83, and Privacy 0.84. The isolated local browser host required the
documented no-sandbox escape hatch because user namespaces were unavailable;
GitHub-hosted release jobs continue to use their normal sandbox.

### 1.9 Trusted Types report-only acceptance

The Storefront sends `Content-Security-Policy-Report-Only` on document
responses with `require-trusted-types-for 'script'` and advertises the
same-origin `/api/security/trusted-types-report` collector. API and static-asset
responses must not inherit the document-only report policy.

Before considering enforcement:

1. Build the production Storefront and confirm the bundle verifier reports that
   the Stripe loader uses `remorseless-stripe-js`.
2. Run `playwright.ci.config.ts` across Desktop Chrome, Pixel 7, and iPhone 15
   Pro. Exercise Home, hydrated Catalog interactions, carousels, Quick Shop,
   Cart, Checkout, confirmation, and recovery.
3. Reject any unexpected `securitypolicyviolation` event. The only reviewed
   framework classifications are React's inert script construction and the
   sanitized JSON-LD serialization, and only from a versioned Next client
   chunk.
4. Inspect the `rr.security.browser.reports` counter and
   `security.trusted_types.report` events in staging. Logs may contain only the
   bounded report count, effective directive, envelope format, runtime
   identity, and correlation identifiers. They must not contain document or
   blocked URLs, source samples, line/column data, referrers, or user agents.
5. Keep enforcement disabled until the reviewed staging observation window has
   no unexplained sink. Do not add a broad `default` Trusted Types policy to
   make a violation disappear.

The collector returns `204 No Content`, uses `Cache-Control: no-store`, rejects
cross-site requests, caps the body at 8 KiB, accepts at most 20 reports per
batch, and applies a 60-request-per-minute fallback limit.

---

## 2. Stripe Payment Element Matrix

### 2.1 Environment

- Ensure backend `.env` includes `STRIPE_API_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_LIFECYCLE_WEBHOOK_SECRET`, and
  `STRIPE_PAYMENT_METHOD_CONFIGURATION`.
- Ensure backend and storefront share `CHECKOUT_BFF_SECRET`; the storefront
  also needs a different `CHECKOUT_RECEIPT_SECRET`.
- Ensure backend and storefront share a separate `PUBLIC_FORM_BFF_SECRET` for
  body-bound contact/privacy calls. It must not reuse checkout, receipt, cookie,
  JWT, or webhook secrets.
- In production mode, confirm startup rejects a missing, placeholder,
  shorter-than-32-byte, or reused runtime secret without logging any value.
- During rotation, exercise Backend verification through
  `CHECKOUT_BFF_SECRET_PREVIOUS` and `PUBLIC_FORM_BFF_SECRET_PREVIOUS`, and
  Storefront receipt verification through
  `CHECKOUT_RECEIPT_SECRET_PREVIOUS`. Exercise the lifecycle endpoint with both
  `STRIPE_LIFECYCLE_WEBHOOK_SECRET` and
  `STRIPE_LIFECYCLE_WEBHOOK_SECRET_PREVIOUS`; the two secrets must be distinct.
  Remove prior keys after their documented drain windows.
- Verify every key/object is test mode before continuing. Do not use real card
  details or a live Stripe object.
- Start backend and listen for Stripe webhooks:

```bash
stripe login
stripe listen \
  --events payment_intent.amount_capturable_updated,payment_intent.succeeded,payment_intent.payment_failed,payment_intent.partially_funded \
  --forward-to localhost:9000/hooks/payment/stripe_stripe
```

In a second terminal:

```bash
stripe listen \
  --events refund.created,refund.updated,refund.failed,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,charge.dispute.funds_withdrawn,charge.dispute.funds_reinstated \
  --forward-to localhost:9000/webhooks/stripe/lifecycle
```

Record the two different webhook secrets printed by the CLI and map them to
`STRIPE_WEBHOOK_SECRET` and `STRIPE_LIFECYCLE_WEBHOOK_SECRET` respectively.

### 2.2 Test Cards

| Scenario           | Card                  | Expected                                  |
| ------------------ | --------------------- | ----------------------------------------- |
| Standard payment   | `4242 4242 4242 4242` | One PaymentIntent and Medusa order        |
| 3DS authentication | `4000 0025 0000 3155` | Authentication, clean recovery, one order |
| Generic decline    | `4000 0000 0000 0002` | Safe decline; no order                    |
| Insufficient funds | `4000 0000 0000 9995` | Specific safe decline; no order           |
| Expired card       | `4000 0000 0000 0069` | Expired-card error; no order              |
| Incorrect CVC      | `4000 0000 0000 0127` | CVC error; no order                       |
| Processing error   | `4000 0000 0000 0119` | Safe retry/recovery; no duplicate         |
| Invalid number     | `4242 4242 4242 4241` | Inline validation; no request             |

For each run:

1. Create cart with ≥1 item.
2. Complete Contact, Delivery address, and an authoritative Delivery method.
3. Confirm the Payment Element amount matches the customer-payable cent total.
   Medusa's raw taxable total may retain additional precision; Stripe's integer
   amount must equal the official provider's single rounded conversion.
4. Complete the payment and ensure `/checkout/confirmation` shows only after
   a linked completed Medusa order exists.
5. Verify the cart cookie clears and the short-lived receipt cookie is HttpOnly
   and scoped to `/api/checkout/confirmation`.
6. Confirm the receipt and order email amounts/items/address match Medusa.
7. Inspect Stripe Workbench delivery and backend aggregate logs; never print a
   client secret or customer/payment object.

Document results in PR or release notes.

### 2.3 Recovery and concurrency

Run all of the following in staging test mode:

- double-click/Enter on Place order;
- two tabs submitting the same signed cart;
- refresh and browser close after `confirmPayment`;
- lost/delayed complete response;
- delayed and duplicate official webhook;
- arbitrary Stripe parameters on `/checkout/return`;
- recovery polling through processing/finalizing/confirmed/failed states;
- revisit confirmation before and after the 30-minute receipt TTL;
- address/shipping/cart change in another tab before payment.

Every path must yield at most one charge and one order. An uncertain result must
say not to pay again and route through recovery. See
[`CHECKOUT_OPERATIONS.md`](CHECKOUT_OPERATIONS.md) for exact incident and
rollback procedures.

### 2.4 Browser automation boundary

Do not attempt to make Stripe's hosted Payment Element accept scripted card
submission by weakening browser security, exposing secrets, or using real card
data. Stripe's
[official automated-testing guidance](https://docs.stripe.com/automated-testing)
states that frontend card-entry automation is restricted.

Split the matrix at the card-data boundary:

- Use the real Payment Element in headed and device-emulated browsers to verify
  rendering, focus, inline validation, disabled submission, recovery copy,
  responsive containment, and reduced motion.
- Use Stripe's
  [official test PaymentMethods](https://docs.stripe.com/testing?testing-method=payment-methods)
  through the test-mode server boundary for success, 3DS next-action,
  declines, and processing errors.
- Use application unit/integration tests for safe Stripe error mapping,
  duplicate completion, response loss, return-query stripping, two-tab
  revision conflicts, and receipt TTL.

An automated browser may produce an ambiguous client error while its
PaymentIntent remains `requires_payment_method` with no last payment error.
That is an automation restriction, not proof of a customer-path failure. The
application must still fail conservatively into recovery and tell the shopper
not to pay again.

### 2.5 Last verified staging matrix

On July 25, 2026, commit `d71d87f` passed:

- real Payment Element invalid-number validation;
- official test PaymentMethods for success, required 3DS, generic decline,
  insufficient funds, expired card, incorrect CVC, and processing error;
- concurrent completion with exactly one authoritative order, cart clearing,
  and path-scoped receipt-cookie validation;
- music release quantity two, merchandise, fixed bundle, and mystery bundle
  add/cart/checkout journeys;
- disabled sold-out music-release and fixed-bundle controls;
- Chrome Pixel 7 emulation at 412 CSS pixels with no horizontal overflow or
  page errors; and
- a real headed-browser Flameshot inspection of the live Stripe fields and
  reconciled order summary.

The disposable success created staging order `#2`. The canonical staging
shipping configuration currently exposes one calculated Standard Shipping
option. Zero-total handling remained contract-tested because no suitable
zero-total staging product existed and catalog prices were not mutated for QA.
See `CHECKOUT_OPERATIONS.md` for CI, deployment, coverage, and arithmetic
evidence.

---

## 3. Meilisearch Observability & Sync

### 3.1 Manual Rebuild

Whenever product schemas or the transformer change:

```bash
pnpm --filter backend run search:sync
```

Watch backend logs for completion message:

```
[meilisearch] Atomic rebuild complete. 'products' is live; '<versioned index>' retains the prior index for rollback.
```

The rebuild is fail-closed and zero-downtime: it validates a versioned
candidate before the atomic swap, reconciles writes after the swap, validates
the new live index, retains the prior index for rollback, and prunes only
controlled candidates older than seven days. Save the owner-only JSON report
from `~/.local/share/remorseless-records/search-rebuild/` with the release
evidence.

### 3.2 CRUD Consistency Check

Run the following sequence:

1. **Create**: Add a new product via Medusa admin/CLI, verify `products` index count increases (`GET /indexes/products/stats`).
2. **Update**: Change title, tags, and price; confirm Meilisearch document reflects changes (`GET /indexes/products/documents/{id}`).
3. **Delete**: Remove the product; ensure document disappears and storefront search no longer shows it.

Helper command: `pnpm --filter backend run search:check` verifies count and
exact ID parity, required fields, published/stock invariants, title search,
product-type facets, and title sorting.

Helpful Meilisearch queries:

```bash
# List documents
curl -H "Authorization: Bearer $MEILISEARCH_ADMIN_KEY" \
  "$MEILISEARCH_HOST/indexes/products/search" \
  -d '{ "q": "demo", "limit": 5 }'

# Index stats
curl -H "Authorization: Bearer $MEILISEARCH_ADMIN_KEY" \
  "$MEILISEARCH_HOST/indexes/products/stats"
```

Fill in observed counts in the release checklist.

### 3.3 Monitoring Hooks

- Add log shipping or dashboard alerting around the `search:sync` command in CI/CD if run automatically.
- For production, monitor webhook or background jobs that update products. Emit metrics (`products_indexed_total`) if integrating with a metrics stack.

---

## 4. Sign-off Checklist

- [ ] Biome + strict TypeScript checks (storefront + backend) pass.
- [ ] Lighthouse thresholds met on target routes.
- [ ] Keyboard and screen-reader smoke tests completed.
- [ ] Stripe payment matrix executed, webhook confirmed.
- [ ] Recovery/concurrency matrix creates no duplicate charge or order.
- [ ] Meilisearch CRUD validation performed, counts recorded.
- [ ] README/QA runbook updated if new steps discovered.

Document results in PR description or release notes; failing any step is a blocker until resolved.
