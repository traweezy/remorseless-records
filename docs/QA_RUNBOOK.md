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

The local default uses Lighthouse's 4x CPU slowdown for a high-end development
workstation. GitHub's hosted runner reports a roughly 2,300 CPU benchmark index
and therefore sets `QA_LIGHTHOUSE_CPU_SLOWDOWN=2`, following Lighthouse's
documented low-end-desktop calibration for the same mid-tier-mobile target.
This is host calibration, not a budget override: all category and metric limits
below remain identical. Retain reports and compare `environment.benchmarkIndex`
before changing the multiplier for another runner class. The accepted range is
1 through 20; invalid values fail before collection starts. See Lighthouse's
[CPU throttling guidance](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md#cpu-throttling).

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

# Prove local/CI wiring, then run the ten shared contract gates
pnpm run qa:ci-shared-contracts-boundary
pnpm run qa:ci-shared-contracts

# Explicit semantic type safety (Biome does not replace the TypeScript compiler)
pnpm --filter remorseless-records-storefront run typecheck
pnpm --filter backend exec tsc --noEmit

# Real native image decoding, resizing, output and rejection/fallback contracts
pnpm --filter remorseless-records-storefront run test:runtime:images

# Dashboard DOM compiler context and browser-boundary assertion regression
pnpm run qa:admin-browser-boundary

# Parsed provider/persistence values must remain unknown until decoded
pnpm run qa:storefront-response-boundary

# Admin matrix wiring, keyboard guard, semantics, and dependency patch drift
pnpm run qa:admin-accessibility-boundary

# Browser QA dependency resolution and blocked browser-download install scripts
pnpm run qa:browser-toolchain-security

# Strict seven-day dependency cooling and reviewed security exceptions
pnpm run qa:dependency-supply-chain

# Deny-by-default CI egress and reviewed Node 24 security actions
pnpm run qa:ci-runtime-security

# Runtime Dockerfile, action pin, image/SBOM, and attestation boundaries
pnpm run qa:runtime-images

# Revalidate every locked package against the active supply-chain policy
pnpm install --frozen-lockfile

# Deterministic Medusa fixture endpoints and Browser Smoke release wiring
pnpm run qa:storefront-provider-fixture
```

`qa:lint` and Root CI share the same ten-contract aggregate: recovery/media
unit and CLI tests (including Redis helper coverage), service-container
resolution, Storefront response and Admin browser boundaries, provider-fixture
tests, Dashboard product creation, scheduler timestamps, disposable-integration
wiring, operations-observation tests, and observability bootstrap. The
independent boundary check runs before the aggregate in both paths and rejects
missing members or bypassed workflow execution. Its own line, branch, and
function coverage floors are 80%, as are the Redis helper coverage floors.
Its fixed completion event is
`ci.shared_contracts.verified`; `serviceIntegration: false` explicitly excludes
real service acceptance. The added aggregate targets under 60 seconds locally;
the September 6 measurement was 18.05 seconds. The validator deliberately
accepts the reviewed workflow layout, not arbitrary YAML. Changes to triggers,
job controls, or command layout require an explicit policy/test update.

These checks use local fixtures and static contracts, not staging credentials
or live recovery operations. Actual disposable PostgreSQL/Redis integration
remains a separate Backend CI job (section 1.6). Existing explicit security
checks, application typechecks, and browser/coverage budgets stay separate.
For historical releases, distinguish local/pre-push evidence from checks that
their exact workflow SHA actually ran; the shared aggregate does not
retroactively add CI evidence to earlier commits.

`test:runtime:images` runs the actual installed Next optimizer and Sharp
decoder without a build, network access or persistent image fixtures. It
requires AVIF input to become a resized, decoded WebP rather than unchanged
upstream bytes, proves PNG-to-AVIF decoding after optimizer initialization,
and retains non-image/SVG rejection plus malformed-image fallback detection.
It runs in its own Node process because Next configures native loader state.
An HTTP 200 response with `image/avif` alone does not prove AVIF input decoding.
Storefront CI runs the five-case gate unconditionally before unit coverage.
Runtime-image validation and the existing master-only publication path also
run the same test against the resolved local Storefront image ID, before
vulnerability scanning or publication. The test is mounted read-only, not
shipped in the image. Its anonymous container has no network, a read-only
filesystem, dropped capabilities, no privilege escalation, and explicit
256-MiB / one-CPU / 64-PID limits. A 45-second process deadline and exact owned
container cleanup complement the per-test timeout; an exited-zero state is
required. The runtime-image policy tests reject skipped/modified decoder steps,
image-resolution drift and reordered scan/publication boundaries.

Launch browser checks derive same-origin response failures and external-request
classification from Playwright's configured `baseURL`, including on a private
alternate port. Missing configuration fails explicitly. Keep every assertion
and project when overriding a local server origin; do not touch an existing
user server or silently skip local fixture cases to free the default port.

After a fixture-backed Storefront build, run
`pnpm --filter remorseless-records-storefront run test:runtime:observability`.
Browser Smoke CI runs the same test against its existing build. It starts
owned ephemeral loopback Next/provider processes and holds four health requests
at a provider barrier with the same incoming trace and parent. Separate cases
finish the first-tracked root first and last, checking after each release that
held siblings have not completed. Both require the actual status, one correct
redacted completion per request and a request with no incoming trace.
The fixture deliberately has no Redis, so its health responses are 503; this
is correlation acceptance, not live readiness. Output capture is bounded and
raw runtime logs are not printed. Unit/real-SDK tests separately cover reverse
completion, duplicate ends, parent replay, child error correlation, expiration
and cardinality. Checkout hooks are included in both execution and measurement
of the existing transactional coverage gate, not just baseline test execution.
No retry, browser sandbox, accessibility or performance
budget is relaxed by this test.

The cooling gate covers the root, Backend, Storefront, and generated Backend
server policies. It requires strict seven-day release aging, rejects missing
registry publication times and exotic transitive sources, and forces frozen
lockfile revalidation. Reviewed exceptions live only in
`scripts/security/dependency-supply-chain-policy.json` and must use exact
selectors with regular, non-symlink evidence files. Do not add a broad package
range or copy an exception into a nested workspace to make an install pass.
Choose the newest mature release instead. The only current cooling exception
is the exact locally hardened Railway CLI release; the only audit ignores are
the three behaviorally verified React Router 6 backports required by Medusa.

The CI runtime-security gate covers every workflow that invokes Harden-Runner.
It binds all six workflows to the reviewed v2.21.0 commit, requires block mode
and the exact per-workflow endpoint sets, rejects DNS-over-HTTPS escape
endpoints, and proves no other workflow retains audit mode. Root, Backend,
Storefront, and Runtime Images also require the reviewed Shai-Hulud v2.2.0 Node
24 action and its fail-closed lockfile controls. Root Trivy scans use only
`ghcr.io/aquasecurity/trivy-db`; do not re-enable the default registry mirror
without reviewing and testing the resulting egress expansion.

### 1.5 Runtime image acceptance

Build the application artifacts before their final images:

```bash
pnpm --filter backend run build
pnpm --filter remorseless-records-storefront run build:runtime

candidate_revision="$(git rev-parse HEAD)"
docker build --file backend/Dockerfile.runtime \
  --build-arg "REVISION=${candidate_revision}" \
  --tag remorseless-records-backend:runtime-local .
docker build --file storefront/Dockerfile.runtime \
  --build-arg "REVISION=${candidate_revision}" \
  --tag remorseless-records-storefront:runtime-local .
```

The Backend build wrapper resolves the already-installed Medusa CLI and runs
it with the current Node executable. It must not launch `pnpm exec medusa`
from the nested Backend workspace: pnpm 11 can implicitly install a different
graph there. Missing CLI, failed compilation, and incomplete artifacts fail
closed; the generated runtime's post-build install remains frozen against
the root lockfile. `qa:medusa-build-toolchain` exercises these launcher cases.
Use the Node version in `.nvmrc` for local builds and gates.

The ordinary Storefront `build` command deliberately produces the server
artifact consumed by `next start` in source-based Railway deployments. Only
`build:runtime` sets `STOREFRONT_BUILD_OUTPUT=standalone`; use it before the
Storefront runtime Docker build so `server.js` exists without introducing the
unsupported `next start` plus standalone pairing.

The final image must run as UID 1000 on Node 26.5.0, expose its expected
health port, contain no npm/npx executable, and carry the source/revision OCI
labels. Backend must contain Medusa CLI, the observability preload, and
`scripts/runtime-release-prepare.mjs`. Storefront must contain `server.js`,
`.next/static`, and `public`.

Scan each exact image with Trivy 0.70.0, the reviewed GHCR database,
vulnerability scanning only, `ignore-unfixed`, `CRITICAL,HIGH`, and exit code
1. Then generate CycloneDX output and validate it against the exact image
record with:

```bash
node scripts/write-runtime-image-record.mjs \
  --service backend \
  --revision "${candidate_revision}" \
  --digest 'sha256:<64 lowercase hex characters>' \
  --output /tmp/backend.image.json
node scripts/verify-runtime-image-artifacts.mjs \
  /tmp/backend.image.json /tmp/backend.cdx.json
```

Use a fresh private `/tmp` directory for each run. Do not commit SBOMs, image
records, Trivy caches, or image archives. The same contract applies to
Storefront with `--service storefront`.

For Storefront container smoke, inject only the documented non-production
32-byte secret fixtures and require `/live`. `/ready` is dependency-aware and
must return 503 if no Backend is available; use the deterministic Medusa
fixture when a 200 readiness assertion is required. No visual UI changed in
this image-only slice, so a screenshot is not required.

### 1.6 Disposable PostgreSQL and Redis integration

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

### 1.7 Admin accessibility and visual matrix

Build the actual Medusa Admin bundle before running its browser acceptance:

```bash
pnpm --filter backend run build
pnpm run qa:admin:accessibility
```

The matrix serves only the compiled Admin bundle and intercepts its GET and
OPTIONS requests with bounded, deterministic fixtures. Before fixture handling
or network fallthrough, the browser aborts every request except GET, HEAD, and
OPTIONS, regardless of origin. The local static server independently returns
405 with `Allow: GET, HEAD, OPTIONS` for every other method; OPTIONS returns
204 and HEAD never streams a body. A failed browser abort produces only
`request:mutation_block_failed` and cannot fall through to the network.
`qa:admin-accessibility-boundary` tests both layers and runs in the local lint
gate and Root CI. Its 12 cases cover guided Product validation and offerings,
existing Product authoring, the native Product list and Catalog workspace,
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

### 1.8 Critical browser matrix

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

### 1.9 Storefront launch acceptance

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

### 1.10 Trusted Types enforcement and regression acceptance

The Storefront enforces Trusted Types on document responses whenever
`NODE_ENV` is not `development`. `Content-Security-Policy` must contain
`trusted-types nextjs nextjs#bundler remorseless-stripe-js` and
`require-trusted-types-for 'script'`. Development retains reporting without
enforcement. The same directives remain in
`Content-Security-Policy-Report-Only`, with the same-origin
`/api/security/trusted-types-report` collector and `Reporting-Endpoints`
header, for regression monitoring and rollback. API and static-asset responses
must not inherit these document-only policies. Implementation revision
`5b6588fc9ae7f9ed8854f202dd129753f149a82a` and its observation and acceptance
evidence are recorded in [the session handoff](NEXT_SESSION_HANDOFF.md).

For each relevant release:

1. Build the production Storefront and confirm the bundle verifier reports that
   the Stripe loader uses `remorseless-stripe-js`. Check an HTML response from
   the candidate artifact for both enforced directives, the report-only
   policy, and the reporting endpoint.
2. Run `playwright.ci.config.ts` across Desktop Chrome, Pixel 7, and iPhone 15
   Pro. Exercise Home, hydrated Catalog interactions, carousels, Quick Shop,
   Cart, Checkout, confirmation, and recovery. Set `PLAYWRIGHT_BASE_URL` to the
   HTTPS staging origin to validate the deployed artifact; omit it for the
   local production artifact and deterministic Medusa fixture. The browser
   scenarios intercept payment/provider responses and do not establish real
   payment-provider acceptance; perform the separate test-mode payment matrix
   in section 2 when that boundary changes.
3. Reject unexpected `securitypolicyviolation` events and investigate blocked
   script/HTML sinks or runtime errors. The listener retains only the reviewed
   classifications for React's inert script construction and sanitized JSON-LD
   serialization from a versioned Next client chunk. Those classifications do
   not authorize a broken journey or a new sink. Do not add a broad `default`
   Trusted Types policy or expand the named policies to hide a regression.
4. Inspect the `rr.security.browser.reports` counter and
   `security.trusted_types.report` events in staging. Logs may contain only the
   bounded report count, effective directive, envelope format, runtime
   identity, and correlation identifiers. They must not contain document or
   blocked URLs, source samples, line/column data, referrers, or user agents.
5. Record the candidate revision, deployment identity, browser results, and
   bounded log-observation window in the handoff. Investigate any unexplained
   report before accepting the release.

If enforcement breaks a supported journey, revert the enforcement-only change
in `storefront/src/config/content-security-policy.ts` (introduced by
`53cecd4`), together with its enforcement assertions. Preserve the nonce CSP,
named-policy integrations, report-only header, collector, and privacy limits.
Rebuild and deploy the rollback to staging, rerun the affected browser journey,
and verify reporting remains present while the enforced Trusted Types
directives are absent. Record the regression and a clean observation window
before re-enabling enforcement.

The collector returns `204 No Content`, uses `Cache-Control: no-store`, rejects
cross-site requests, caps the body at 8 KiB, accepts at most 20 reports per
batch, and applies a 60-request-per-minute fallback limit.

### 1.11 Grouped storage, payment, and telemetry acceptance

Review each dependency family's release notes and cooling eligibility, then
collect compatible upgrades into one root lockfile and one release acceptance
pass. Keep logical commits, but do not push documentation-only checkpoints or
deploy each small family separately. Use the `.nvmrc` runtime, root frozen
installation, and installed test binaries; nested-workspace `pnpm exec` can
silently install an unrelated graph.

The storage provider contract suite exercises the actual installed SDK with
injected HTTP responses. It must reject quiet bulk-delete responses containing
per-object errors even when HTTP status is 200. Streaming tests must cover an
unfinished producer, a finished producer with an in-flight request, concurrent
upload isolation, and multipart part/completion cancellation. Verify that
cleanup uses a separate bounded signal, no shared client is mutated, and
timers/streams are released. `S3 file provider request failed.` and
`S3 multipart cleanup failed.` are fixed diagnostic messages; never add object
keys, credentials, URLs, or provider payloads to these logs. Cancellation and
multipart cleanup cannot prove remote rollback after response loss. Investigate
cleanup failures and use the documented managed-media ownership/reconciliation
boundary, not a broad bucket deletion or blind destructive retry.

`qa:observability-bootstrap` runs the preload contract and real in-memory SDK
tests. Database/Redis spans may retain trace IDs, timing, status, and bounded
operation attributes, but not SQL literals, bound values, database/host names,
or raw errors. Check metric labels independently from spans. Preserve duration,
error, connection, and runtime measurements without enabling a new exporter or
global instrumentation. PostgreSQL pool labels use opaque process-local
groups capped at 32 plus overflow; do not restore raw names or hashes. The
upstream multi-pool delta-baseline limitation exists before this upgrade, so
pool counters are not authoritative connection inventory. Use database
readiness/operational probes for health decisions. Confirm disabled startup
and shutdown remain quiet.

The Stripe SDK transport suite validates actual serialized API requests and
response-body timeouts with an injected Fetch implementation. The browser
`Stripe loader` tests in both CI and critical configurations serve the installed
loader under enforced CSP and fulfill all external scripts locally. Keep
`remorseless-stripe-js` as the only Stripe policy, with its exact URL allowlist,
and preserve lazy/concurrent loading and failed-load recovery. These offline
checks supplement, but do not replace, the test-mode payment matrix below.

After final full local gates, verify all four workflows at the pushed SHA,
validate each image record against its SBOM, and independently confirm each
Railway service's deployed SHA, health, correlated logs, and browser behavior.
Retain cancellation diagnostics and expected fixture failures explicitly;
passing tests do not imply an entirely error-free observation window.

---

### 1.12 UI, parser, and native-image compatibility

The `UI runtime` browser cases run in the responsive and three-engine critical
matrices. Their dedicated three-image product is available only from the
local provider fixture's exact handle lookup, never the shared catalog list.
Exercise rapid next/previous/thumbnail navigation, failed active-image removal,
and a single Previous press after the image count shrinks. Both normal and
reduced-motion paths must finish with one visible, fully loaded main image.

Quick shop acceptance delays the detail response, closes/reopens while pending,
then releases it and checks cache reuse, skeleton removal, and restored opener
focus. Controlled drawers must also preserve nested/StrictMode/rapid-reopen
behavior, explicit consumer autofocus handlers, and intentional external focus.
Do not restore removed, disabled, hidden, inert, or navigated-away controls.
Opacity alone does not make an opener unfocusable: Quick shop's trigger fades
while the drawer owns focus and becomes visible again when focus returns.
Check real cart and discography calendar icons, accessible names, keyboard
selection, mobile layout, and a headed desktop screenshot after these changes.

For deployed acceptance, name the exact spec files and report local-only
gallery skips separately. The gallery handle is intentionally unavailable on
staging. Intercepted Quick shop/cart/Stripe fixtures validate the deployed
client behavior but are not proof of live provider writes or payment delivery.

The real CSV parser regressions require `__proto__`, `constructor`, and
`toString` headers to remain own data properties with an unchanged row
prototype. Grouped duplicates also exercise the upstream parser fix, but
application imports do not enable grouping; the string-only boundary must
reject those grouped values. Keep the framework's separate parser major
isolated, and do not describe a library reproducer as a demonstrated app exploit.

Run the actual native image sandbox after Sharp/libvips updates. Preserve
input/output size, pixel, dimension, channel and animation limits, metadata
stripping, worker deadlines, and no-network/no-filesystem-write privileges.
Cover extreme aspect ratios, palette transparency, corrupt images, declared
type mismatch, and multi-frame rejection. Keep native-library license notices,
runtime-image scans/SBOMs, and real AVIF optimizer smoke in the same acceptance
batch; passing unit mocks alone is insufficient.

---

### 1.13 Git-hook and loader acceptance

Run the supported Node and exact declared pnpm versions, then:

```bash
pnpm run qa:toolchain-runtime
pnpm run qa:medusa-build-toolchain
pnpm run qa:ci-shared-contracts-boundary
```

The first gate exercises the actual two Git/Node wrappers and installer in
private disposable Git repositories. It uses a harmless fixture pnpm, not
real QA, package installation, cloud remotes or Lefthook. Cases cover blocked
commits/pushes, serial gate execution, missing/mismatched/malformed manager
identity, bounded output, timeouts and cancellation, exact legacy recognition,
private backups, repeat installation, refused custom hooks/configuration and
link/FIFO targets, concurrent edits, and recovery from a failed second
activation. Installer and dispatcher line/branch/function coverage each remain
above the 80% gate. Tests run in separate processes with a 60-second deadline;
the existing parity policy protects the exact commands, coverage and deadline
flags, and unconditional Root CI execution. The ten-member shared aggregate
is unchanged. These local guards do not replace independent CI enforcement.

The same gate includes one real `tsx/cjs/api` smoke test, with native Node type
stripping disabled, typed relative imports and same-basename module isolation.
This is compatibility coverage for Vite's optional TypeScript-config fallback;
the current app configuration does not exercise that path. It does not claim
CLI/watch, signal-forwarding or `tsImport` application coverage.

The Medusa gate retains its four build-launcher cases and adds four actual
Backend-resolved SWC transformer cases: legacy decorator identities/reflection
metadata, nested-class isolation, automatic TSX using Backend React 18, and
malformed TypeScript rejection. Options come from the real Backend Jest
configuration. The nested legacy case is not a reproduction of upstream's
separate modern-decorator fix. Node coverage cannot measure compiled SWC Rust
internals, and a package scan does not prove complete native dependency coverage.

Install/migration emits bounded `git.hooks.installed` or
`git.hooks.install_skipped` records; successful gates emit `git.hook.passed`.
Expected local installation is sub-second and the isolated gate targets under
15 seconds; record measurements instead of relaxing assertions on a slow host.
Version checks have a five-second deadline and each actual QA command a
30-minute ceiling. Runtime gate changes still require full application builds,
coverage, exact-SHA CI, runtime-image and deployed staging acceptance.

Root, Backend, Storefront and the generated Backend workspace explicitly set
`enableGlobalVirtualStore: false`. This preserves one installed layout when
switching between ordinary local and `CI=true` checks. An unset value can
otherwise resolve differently in pnpm 11 and spuriously fail the strict
dependency gate; see [the upstream report](https://github.com/pnpm/pnpm/issues/12337).
Keep `CI=true`, `pmOnFail=error` and `verifyDepsBeforeRun=error` intact. Do not
work around this by disabling CI mode, permitting automatic installation or
weakening drift detection. After changing workspace settings, use the pinned
manager for an explicit frozen install, then verify a lightweight CI-mode
command before application builds. The supply-chain verifier and generated
configuration tests protect the explicit false policy.

### 1.14 PostHog transport compatibility

Run `pnpm run qa:posthog-runtime` using the pinned toolchain. The same exact
command runs after the hook/loader gate in local root QA and Root CI. The
independent parity suite protects its test scope, process isolation,
30-second runner deadline, unconditional execution and order.

Three real-SDK cases cover Medusa-shaped capture/identify/group events and
awaited queue draining, a 100 ms request abort with retries disabled, and
cancellation of a late response body. Fetch is injected; global fetch and
socket connection are blocked before SDK loading. Fixtures use only a
reserved `.invalid` host and a noncredential test key, with remote config,
exception autocapture and local flag evaluation disabled. Cleanup drains only
into the owned successful transport and checks for unexpected requests/errors.
The fixture has two-second operation bounds and five-second per-case limits;
target total execution is under five seconds, without weakening limits.

The available Medusa adapter and the direct Backend dependency must resolve
the same SDK. This is dependency compatibility, not live analytics delivery:
the app does not register the PostHog provider. Do not enable a provider or send
events to obtain acceptance. Local feature-flag evaluation, OTLP attribute
encoding and browser-user-agent classification are separate upstream changes,
not application paths covered by these transport cases. Real flush failures
reject, while shutdown can consume classified fetch failures; do not impose
an invented rejection contract on shutdown.

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
