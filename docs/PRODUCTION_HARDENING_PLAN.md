# Production Hardening Plan

Last verified: August 26, 2026

This is the authoritative launch-readiness backlog for Remorseless Records. It
supersedes the local `tmp/HARDENING_NEXT_STEPS.md` working note. Detailed
operating procedures remain in the linked runbooks and ADRs; this document
tracks what is still required before production traffic is approved.

## Operating contract

- Railway `staging` is the only authorized deployment target until the owner
  separately approves production work.
- Use Node 26.x, pnpm 11.17.0, and the single root lockfile.
- Deliver one small Conventional Commit per logical hardening slice.
- Before each push, pass the focused tests plus repository lint, strict
  typecheck, relevant coverage, security checks, and production builds.
- After each push, watch all GitHub Actions jobs and the affected Railway
  staging deployments to `SUCCESS`, then run health, route, API, log, and
  browser validation before beginning another slice.
- Do not change production traffic, paid services, credentials, domains,
  replicas, data, or destructive migrations without explicit approval.

## Verified baseline

- Git branch: `main`; the repository has no `master` branch.
- Deployed application source: `6ed952ffd03bb3879a626ef3e607039320742078`.
- Railway project: `store`; only the `staging` environment exists.
- Backend deployment: `13a45a21-a3af-472c-9c13-30ddc269d385` (`SUCCESS`).
- Storefront deployment: `e8785c9a-7a7a-43b1-a3b0-97574fed1e37`
  (`SUCCESS`).
- Backend and Storefront `/live` and `/ready` checks return HTTP 200.
- The public storefront route/API smoke matrix passes. `/products`
  intentionally redirects to `/catalog`.
- Staging uses Stripe test mode, TaxRate.io, Redis, PostgreSQL, MinIO, and
  Meilisearch. No production environment or production domain has been
  provisioned.
- The deployed RBAC baseline contains 260 active policies, one wildcard, 259
  concrete Super Admin permissions, and all 27 exact custom definitions.

## Completed slice: catalog Admin authorization manifest

- [x] Inventory all 64 active custom Admin methods exactly once: 41 catalog
      methods and 23 other methods.
- [x] Generate exact, anchored, default-deny authorization middleware from one
      typed manifest.
- [x] Register 11 catalog policies covering Catalog Authoring, Taxonomy, and
      Merchandising, including required native aggregate permissions.
- [x] Remove the dead `/admin/custom` route and the permanently disabled
      physical media-asset DELETE route.
- [x] Add source-inventory, route-equivalence, default-deny, policy-definition,
      role-contract, and Admin content-boundary tests.
- [x] Update the root, Backend, Admin, and RBAC ADR documentation.
- [x] Fix the unrelated Lexical/React `EditorChildrenComponent` strict
      typecheck failure that blocked the repository quality gate.
- [x] Run lint, strict typecheck, Backend tests, Storefront tests and coverage,
      dependency audit, secret scan, SBOM/image scans, and production builds.
- [x] Commit and push the catalog manifest as one atomic release.
- [x] Watch all GitHub workflows and both Railway staging deployments to
      `SUCCESS` on the exact commit SHA.
- [x] Verify staging has 260 active policies, one wildcard, 259 concrete Super
      Admin permissions, all 27 custom definitions, and unchanged role/user
      links.
- [x] Run the source-derived restricted-role matrix and authenticated staging
      Super Admin route/effective-permission probes; confirm no unexpected
      Admin 4xx, 5xx, policy-sync, or authorization failures in deployment
      logs. No disposable role or user was created.

Release evidence: Root CI `32915688896`, Backend CI `32915688939`, and
Storefront CI `32915688961` passed for `797292b`. Railway Backend
`40fb5e6b-066b-4798-a60f-8b84a4f6b01a` and Storefront
`7b28678f-81bd-4929-8cf6-052167e5e73e` deployed the exact SHA. Read-only
database checks found one active role, one role-policy link, and the unchanged
three user-role links for three users. The live effective-permission endpoint
returned 259 unique concrete grants and all 27 custom keys. Representative
authorized routes returned 200, unauthorized Catalog access returned 401, the
two removed route surfaces returned 404, all health probes returned 200, and
the exact-deployment build/runtime logs contained no warning or error entries.

## Completed slice: native Admin mutation overlays

- [x] Overlay `POST /admin/products/:id` with exact `product:update`
      authorization.
- [x] Overlay `POST /admin/products/:id/variants/:variant_id` with exact
      `product_variant:update` authorization.
- [x] Constrain the matchers to generated `prod_...` and `variant_...` IDs so
      Product import, batch, and export routes cannot inherit an update grant.
- [x] Pin Medusa 2.18's missing native policies and prove each project overlay
      sorts before native validation and handler execution.
- [x] Pass the full local gates, commit, push, and watch all GitHub and Railway
      staging checks to `SUCCESS` on the exact SHA.
- [x] Run authenticated staging allow/authentication probes and confirm policy
      counts, role links, health checks, and post-acceptance logs remain
      unchanged.

Release evidence: Root CI `32918827776`, Backend CI `32918827724`, and
Storefront CI `32918827742` passed for
`f411275b63d5aa8ee6f190b9dac318b4e6eef736`. Railway Backend
`fb3210d0-e045-40ef-8174-3c5a1ccb35bb` and Storefront
`401ecb5e-2c05-47a3-85d6-9947f780189c` deployed that exact SHA successfully.
Unauthenticated Product and Variant update probes returned 401; authenticated
strict-validation probes returned 400 before either nonexistent ID could reach
a handler. The existing administrator still received 259 unique concrete
permissions, including all 27 custom permissions, with `rbac: true`. A
read-only transaction confirmed 260 active policies, one wildcard, 259
concrete policies, one active role, one role-policy link, and the unchanged
three Super Admin user links. Backend and Storefront `/live` and `/ready`, plus
the Storefront root, returned 200. Build logs and the final acceptance runtime
window contained no warning or error entries.

An earlier empty-body probe intentionally used nonexistent IDs and could not
mutate a record. The Product route returned 404, but Medusa 2.18's native
Variant response remapper dereferenced the missing Product and returned 500.
That operator-generated error is retained in the deployment log and was
resolved by the following hardening slice.

## Completed slice: native Variant missing-resource handling

- [x] Pin the Medusa 2.18 failure for an authenticated Variant update whose
      Product or Variant ID does not exist.
- [x] Return a stable 404 without leaking a stack or bypassing the exact
      `product_variant:update` authorization overlay.
- [x] Cover authorized, unauthorized, validation-failed, Product-missing, and
      Variant-missing paths without mutating staging data.
- [x] Pass local gates, push one atomic fix, and watch GitHub and both Railway
      staging deployments before advancing.

Current local evidence: the pinned route patch and its lockfile checksum are in
sync. Four focused native-handler tests cover the missing pair, a concurrent
zero-row result, a vanished parent Product, and the successful response
contract. The complete Backend gate passes with 156 suites and 836 tests, plus
ESLint, strict typecheck, the React Router security verifier, production build,
and production dependency audit. The built Backend artifact contains both the
Variant safeguards and the existing privacy patch.

Release preparation also exposed an incomplete cached Puppeteer Chrome
installation during pnpm's automatic workspace refresh. With owner approval,
the workspace was repaired strictly from the offline frozen lockfile while
browser downloads were disabled; pnpm reapplied the patch and restored the Git
hooks without changing dependency versions. Cross-app lint and typecheck now
pass, as do all 102 Storefront suites and 538 tests with 93.5% statement and
85.71% branch coverage.

Release evidence: Root CI `32942014174`, Backend CI `32942014179`, and
Storefront CI `32942014231` passed for
`8b5553e539f772f511b28b0628100a1a7f52e61a`. Railway Backend
`937eac40-59b8-4d9e-bde7-6aed7d07e32b` and Storefront
`adb754a4-68b1-4845-a2f3-924142a87214` deployed the exact SHA successfully.
The unauthenticated malformed probe returned 401, the authenticated malformed
probe returned 400, and authenticated missing-pair and verified
existing-Product/missing-Variant probes both returned 404 without changing a
record. The administrator retained 259 unique concrete permissions, all 27
custom keys, and `rbac: true`. A read-only repeatable-read transaction confirmed
260 active policies, one wildcard, 259 concrete policies, 27 custom policies,
one active role, one role-policy link, and three user-role links for three
users. All five health/root probes returned 200.

Exact-deployment log review found no application exception, warning, failed
operation, or leaked stack. Railway classified five successful pnpm command
banners written to stderr as `error`-level events, and Railpack emitted npm
wrapper warnings about production configuration and forced installation. The
accepted file manifests remain pnpm-only; removing or classifying this platform
log noise remains an observability follow-up.

## Completed slice: Catalog Admin fail-closed UI authorization

- [x] Inventory the data dependencies and mount points for Catalog product
      creation, product editing, merchandising, Product summary, and Variant
      profile surfaces.
- [x] Centralize the complete conjunctive capability contract for each surface,
      including every custom Catalog action and native Product, Variant, Price,
      Inventory, and File prerequisite that its reachable requests use.
- [x] Wrap the actual page and widget implementations before their queries,
      effects, mutations, or browser-draft access can mount.
- [x] Extend the shared permission boundary with compact widget pending/retry
      states and hidden denied widgets; denied pages retain the explicit access
      explanation.
- [x] Declare primary `handle.permissions` metadata for the three Catalog routes
      while keeping the component boundary authoritative.
- [x] Add focused pending, error/retry, denied, allowed, exact-contract,
      metadata, and query-leakage coverage. All 22 focused tests and targeted
      ESLint checks pass.
- [x] Pass the complete repository lint, strict typecheck, tests, coverage,
      production builds, bundle budget, dependency, router-security, and local
      filesystem vulnerability/secret gates.
- [x] Inspect the exact deployed Admin workspace in a headed Chromium browser
      at 1440 x 900 and review the captured rendered image for clipping,
      overflow, hierarchy, and control legibility. Flameshot could not capture
      the active Wayland/Xwayland session, so the headed browser's direct
      screenshot was used as the documented fallback.
- [x] Push the atomic slice, watch every GitHub workflow and both Railway
      staging deployments to `SUCCESS`, then complete staging acceptance.

Discovery: Dashboard 2.18 treats custom-route `handle.permissions` as metadata
and does not guard widgets. The reusable boundary must therefore wrap the
implementation that owns the protected hooks, not only advertise a permission
on its route or widget entry file. A denied Product summary now registers no
authoring-view query, and every denied Catalog page registers zero Catalog
query keys.

Current local evidence: cross-app lint and strict typecheck pass, as does
Backend ESLint. All 159 Backend suites and 854 tests pass. All 102 Storefront
suites and 538 tests pass with 93.5% statement and 85.71% branch coverage.
Backend and Storefront production builds pass; the Admin bundle remains within
budget at 1,798,700 gzip bytes for the main asset and 2,393,631 gzip bytes
total. The production audit reports only the three accepted ignored moderate
findings and no high/critical finding, the React Router 6.30.4 backport verifier
passes, and Trivy reports zero high/critical dependency, secret, or
misconfiguration findings in the source scan.

Release evidence: Root CI `32962293546`, Backend CI `32962293571`, and
Storefront CI `32962293567` passed for
`6ed952ffd03bb3879a626ef3e607039320742078`. Railway Backend
`13a45a21-a3af-472c-9c13-30ddc269d385` and Storefront
`e8785c9a-7a7a-43b1-a3b0-97574fed1e37` reached `SUCCESS` on that exact SHA.
Backend and Storefront `/live` and `/ready`, plus the Storefront root, returned
200. Fresh administrator authentication, feature flags, and effective
permissions returned 200; RBAC remained enabled with 259 unique concrete
permissions and all 27 custom keys. Exact-deployment runtime logs contained no
application warning, error, exception, failed operation, or stack. Build-log
matches were limited to the already tracked Railpack Corepack bootstrap and
npm wrapper warnings while the actual install, build, and start commands
remained pnpm-only.

The exact staging Catalog Merchandising workspace rendered correctly in a
headed Chromium browser at 1440 x 900 with complete navigation and actions, a
stable two-column layout, readable controls, and no visible clipping or page-
width overflow. The reviewed capture is
`/tmp/catalog-admin-merchandising-6ed952f.png`; temporary acceptance images are
not repository artifacts. Denied-role UI behavior remains proven by the
source-derived no-query component matrix without creating or changing a
staging role, user, link, policy, or catalog record. A repeat read-only policy
count was attempted but could not connect because the CLI supplied only
`postgres.railway.internal`, which is not resolvable from the local runner; no
connection or transaction occurred. This slice contains no policy definition,
migration, or database change, and the live effective-permission contract is
unchanged.

## Completed slice: browser-tooling archive extraction containment

- [x] Trace `extract-zip@2.0.1` to the latest Pa11y and Lighthouse CI releases
      through their Puppeteer 24 browser-manager dependency.
- [x] Confirm the reviewed GitHub advisory lists no patched `extract-zip`
      release and reproduce creation of an escaping `../../outside.txt`
      archive symlink in an isolated temporary directory.
- [x] Pin and patch the single resolved `extract-zip` instance so a symlink
      target is resolved relative to its destination and rejected before
      creation when it escapes the canonical extraction root.
- [x] Explicitly deny Puppeteer install scripts in the root, Backend, and
      Storefront pnpm build-policy manifests. Every CI browser job already
      resolves an external Chrome executable and does not require a downloaded
      Puppeteer browser.
- [x] Add a behavioral security verifier proving the malicious archive is
      rejected, no escaping link is created, a safe in-root link remains
      readable, and all three build-policy manifests remain fail-closed.
- [x] Run the verifier from Root CI after the frozen pnpm install.
- [x] Pass the complete frozen-install, browser QA, quality, build, dependency,
      secret, and vulnerability gates.
- [x] Commit and push the atomic mitigation, then watch all GitHub workflows
      and both Railway staging deployments to `SUCCESS` on the exact SHA.

Discovery: `pa11y@9.1.1` and `@lhci/cli@0.15.1` are the current upstream
releases, while Lighthouse 13.3.0 still depends on Puppeteer Core 24.43. The
advisory therefore cannot currently be removed through a supported version
upgrade. Pnpm's explicit `allowBuilds` denial prevents both installed Puppeteer
versions from running their browser-download scripts. The local patch closes
the vulnerable extraction behavior for all consumers while preserving safe
symlinks and existing external-Chrome QA. GitHub's version-based Dependabot
alert may remain open because it cannot interpret a pnpm package patch; do not
dismiss it until an upstream fixed version or a reviewed dependency
replacement removes `extract-zip@2.0.1` from the lockfile.

Local validation passed with a zero-download frozen offline install, the
malicious/safe archive regression verifier, cross-app ESLint and strict
typecheck, 159 Backend suites with 854 tests, and 102 Storefront suites with
538 tests. Storefront coverage remained 93.5% statements, 85.71% branches,
94.41% functions, and 93.47% lines. Both production builds passed; the Admin
bundle remained inside its raw and gzip budgets. The production dependency
audit reported only the three documented ignored moderates, while Trivy found
no high/critical production dependency, misconfiguration, or secret findings.
Pa11y, Pixel 7/compact-phone mobile Chrome audits, and Lighthouse assertions
passed on `/about`, `/accessibility`, `/cookies`, and `/terms` using the
reviewed external Chrome binary.

Release evidence: Root CI `32968132026`, Backend CI `32968132003`, and
Storefront CI `32968132047` passed for
`5adac36c62a5cae0d448c19cbff87c8b47eed51c`. Railway Backend
`1103e17c-151a-47fe-85bc-72eedec46101` and Storefront
`4a0b6f42-6076-4a68-b9f4-1338719e17a7` reached `SUCCESS` on that exact SHA.
The Railway installs re-verified the 1,956-entry frozen lockfile without a
Puppeteer postinstall or browser download; the Backend runtime install skipped
all development dependencies. Backend `/api/health`, `/live`, `/ready`, and
`/app` returned 200. Storefront `/live`, `/ready`, `/`, `/about`,
`/accessibility`, `/cookies`, `/terms`, `/catalog`, and `/api/healthcheck`
returned 200; `/products` retained its expected 308 redirect to `/catalog`.
Exact-deployment build and runtime warning/error scans found no application
issue. The only filtered runtime output was the already tracked Railpack/pnpm
command-banner severity misclassification.

## Remaining authorization work

- [ ] Replace or disable the native Dashboard import drawer path that begins
      with the intentionally disabled presigned-upload endpoint.
- [ ] Route destructive catalog changes through audited, idempotent,
      version-checked workflows.
- [ ] Prefer archive or quarantine over hard deletion where recovery is
      required.

## Checkout, payment, refund, and job reliability

- [ ] Diagnose the recurring BullMQ `Missing lock ... moveToFinished` failures
      for `reconcile-checkout-payments` observed on August 24 and 25, 2026.
- [ ] Measure job duration, Redis latency, event-loop delay, lock renewal,
      reconnects, AOF latency, memory pressure, and stalled-job behavior before
      tuning lock settings.
- [ ] Prove every scheduled money-moving job is idempotent and stalled-job
      recovery cannot duplicate a charge, completion, order, refund, or email.
- [ ] Configure a separate staging Stripe lifecycle webhook secret and the
      `/webhooks/stripe/lifecycle` endpoint.
- [ ] Exercise signed, duplicate, delayed, out-of-order, queue-failed, refund,
      repeated-partial-refund, and dispute events.
- [ ] Prove checkout reconciliation handles response loss without a duplicate
      payment or order.
- [ ] Complete the exact-amount, success, 3DS, decline, browser-close,
      response-loss, duplicate-submit, concurrency, and recovery matrix in
      `docs/CHECKOUT_OPERATIONS.md`.
- [ ] Verify confirmation email, receipt, Medusa order, Stripe PaymentIntent,
      and tax evidence agree.
- [ ] Complete the refund and dispute reconciliation matrix in
      `docs/REFUND_OPERATIONS.md`.
- [ ] Keep all payment traffic in Stripe test mode until a separate production
      change is approved.

## Tax readiness

- [ ] Obtain business approval and qualified tax advice for provider choice,
      registrations, product tax codes, shipping treatment, filing ownership,
      and Stripe Tax pricing.
- [ ] Run the sandbox golden matrix across taxable, non-taxable, mixed,
      shipping-taxed, discounted, refunded, and partially refunded orders.
- [ ] Prove the Medusa/Stripe/provider three-way amount invariant and tax
      transaction/reversal evidence.
- [ ] Compare representative Stripe Tax results with TaxRate.io without
      charging customers.
- [ ] Add reviewed TaxRate.io response bounds and reject malformed, negative,
      or implausible rates.
- [ ] Validate tax cache TTLs at startup and bound or purge in-memory caches.
- [ ] Configure a reviewed monitoring ZIP before enabling paid quota probes.
- [ ] Complete the filing-record and tax-control runbooks.
- [ ] Request separate approval before live registrations or a production tax
      provider change.

## Application and API security

- [ ] Replace Storefront production `script-src 'unsafe-inline'` with a
      nonce/hash policy; set `base-uri 'none'` and evaluate Trusted Types.
- [ ] Remove unused sample S3 and Unsplash image origins from the production
      allowlist.
- [ ] Add global Backend/Admin HSTS, CSP, `nosniff`, frame, referrer,
      permissions, and cache headers.
- [ ] Standardize RFC 7807 responses with request and trace IDs across custom
      Backend and Storefront APIs.
- [ ] Add App Router `error.tsx` and `global-error.tsx` boundaries with safe,
      observable recovery UX.
- [ ] Validate strong, distinct JWT, cookie, cart, checkout-BFF, receipt, and
      webhook secrets at startup and support controlled rotation.
- [ ] Remove persistent bootstrap Admin credentials from normal Backend
      runtime.
- [ ] Move all generic abuse controls to Redis-backed atomic rate limits.
- [ ] Trust client IP headers only behind a documented Railway proxy boundary.
- [ ] Remove User-Agent from the cart rate-limit identity.
- [ ] Protect Backend contact and privacy routes with shared limiting, bounded
      email timeouts, neutral responses, and purpose-bound BFF authentication.
- [ ] Persist privacy requests in a protected audit store if required by the
      approved retention policy.
- [ ] Cap search offset and total work.
- [ ] Rename Meilisearch host/search-key inputs to server-only variables and
      remove its public domain if browser-direct search is not intentional.
- [ ] Replace the all-product handles scan with bounded keyset pagination,
      published-status filtering, and publishable-key sales-channel filtering.
- [ ] Verify every public helper applies published-status and publishable-key
      sales-channel boundaries.
- [ ] Add outbound deadlines, cancellation, bounded retries, and redacted
      provider errors for content, search, email, Stripe, tax, storage,
      contact, and privacy calls.
- [ ] Harden malformed cookie decoding so invalid percent encoding cannot throw
      outside the parser boundary.
- [ ] Make browser query persistence opt-in for any PII-bearing data.

## Upload and media hardening

- [ ] Decode and re-encode uploaded images in a sandboxed pipeline.
- [ ] Cap dimensions, total pixels, frame count, decompressed size, input size,
      and processing time.
- [ ] Strip metadata and quarantine/scan files before immutable public storage.
- [ ] Define managed-media quarantine retention and an audited purge policy.
- [ ] Verify migrated media no longer depends on Big Cartel URLs.
- [ ] Complete the managed-media and discography cutover evidence required by
      `docs/adr/0005-managed-media-and-discography-rebuild.md`.

## Infrastructure, data protection, and recovery

- [ ] Design and obtain approval for the Railway production environment,
      domains, services, capacity, and cost before provisioning it.
- [ ] Replace the Backend PostgreSQL superuser connection with a least-privilege
      runtime role and a separate migration/DDL role.
- [ ] Require TLS for every non-private database connection.
- [ ] Move Storefront Redis to the Railway private service reference.
- [ ] Remove public Redis and PostgreSQL TCP proxies unless a reviewed,
      encrypted administrative path requires them.
- [ ] Put MinIO Console behind private access/SSO or remove its public domain.
- [ ] Configure PostgreSQL backups/PITR and perform a timed restore drill.
- [ ] Configure off-site media backup and verify object checksums and restores.
- [ ] Document Redis recovery semantics and Meilisearch rebuild/snapshot
      recovery.
- [ ] Pin Redis, PostgreSQL, MinIO, and Meilisearch images by tested version and
      immutable digest; remove floating `latest` tags.
- [ ] Enable `pg_stat_statements`, slow-query logging, I/O timing, and relevant
      database/volume metrics with an overhead budget.
- [ ] Define availability, latency, recovery-time, and recovery-point goals
      before adding replicas, PgBouncer, overlap/draining, or paid monitoring.
- [ ] Reduce the Backend 720-second deploy health timeout after startup and
      migration behavior is measured.

## GitHub, CI, supply chain, and test depth

- [ ] Protect `main` with a ruleset requiring pull requests, current checks,
      review/conversation resolution, and restricted force-push/delete.
- [ ] Consolidate duplicate GitHub deployment environments and add environment
      protection rules for production.
- [ ] Enable Dependabot security updates or document an equivalent owned
      remediation SLA.
- [ ] Resolve or evidence-dismiss every open CodeQL alert, including the
      stranded legacy search-analysis category.
- [x] Mitigate `GHSA-jmr9-qjv8-65gv` in `extract-zip` with fail-closed symlink
      containment, a malicious-archive regression gate, and explicit denial of
      Puppeteer browser-download install scripts.
- [ ] Remove the local `extract-zip` patch and the vulnerable package version
      when Pa11y/Lighthouse ship a reviewed fixed chain or can be replaced
      without losing accessibility and performance coverage.
- [ ] Make Storefront build, Playwright, accessibility, and Lighthouse jobs
      required on relevant pull requests and scheduled runs.
- [ ] Run Chromium, Firefox, and WebKit for critical home, catalog, product,
      cart, checkout, auth, and receipt paths; upload failure artifacts.
- [ ] Expand Storefront coverage to cart, checkout, BFF routes, components, and
      critical user flows instead of measuring only the current narrow include
      set.
- [ ] Raise Redis client branch/function coverage from the current low level.
- [ ] Add Backend coverage enforcement of at least 80% for core and critical
      paths.
- [ ] Add disposable PostgreSQL/Redis integration, migration, API-contract,
      payment failure/retry, and queue recovery tests.
- [ ] Add Prettier as the repository formatter and enforce a formatting check in
      hooks and CI.
- [ ] Tighten Backend ESLint unsafe-TypeScript rules incrementally without
      hiding existing debt.
- [ ] Review the custom Backend post-build dependency install/patch process for
      reproducibility and file-system races.
- [ ] Scan final runtime images, generate image-linked SBOM/provenance, and sign
      or attest the deployed artifacts.
- [ ] Move hardened-runner egress from audit mode to an explicit allowlist after
      observing required endpoints.
- [ ] Add a real dependency cooling window and keep only narrowly justified
      security exceptions.
- [ ] Plan isolated compatibility upgrades for Medusa, Next.js, TanStack,
      Stripe, AWS SDK, and other outdated dependency families.

Discovery: GitHub Dependabot alert `27` classifies
`GHSA-jmr9-qjv8-65gv` / `CVE-2026-56876` as a high-severity development-only
`extract-zip@2.0.1` symlink path-traversal risk in the root lockfile. It is
introduced by `@puppeteer/browsers` through Pa11y and Lighthouse, not by a
runtime dependency, and GitHub currently lists no patched `extract-zip`
version. Production-only pnpm audit and the Trivy source scan remain clean of
high/critical findings; that does not close or dismiss the development-tooling
alert. The checked mitigation contains the current behavior; the separate
removal item remains open until the parent chain can be upgraded or replaced
so the vulnerable package version leaves the lockfile.

## Observability and operations

- [ ] Remove or classify Railpack npm wrapper warnings and successful pnpm
      command banners currently recorded at error severity so deployment-log
      alerts remain actionable.
- [ ] Add structured JSON logging with redaction, request ID, trace ID, span ID,
      service, environment, and commit SHA.
- [ ] Add OpenTelemetry traces and RED metrics for HTTP, database, Redis,
      search, storage, Stripe, tax, email, queues, and scheduled jobs.
- [ ] Add privacy-conscious Web Vitals and frontend error reporting.
- [ ] Alert on Redis reconnects/latency, BullMQ stalls, payment/tax mismatches,
      reconciliation backlog, webhook failures, readiness failures, database
      saturation, storage errors, and elevated error/latency rates.
- [ ] Define an SLO, severity, owner, escalation path, and runbook for every
      alert.
- [ ] Add payment, tax, notification, lifecycle, search, storage, and RBAC
      capability checks to startup/readiness without exposing secrets.
- [ ] Verify anonymous-cart and abandoned-checkout retention jobs execute and
      report auditable counts.

## Legal, accessibility, and launch acceptance

- [ ] Obtain qualified counsel/client approval for all legal page copy,
      jurisdiction coverage, retention periods, and operating procedures.
- [ ] Verify checkout disclosures immediately before payment.
- [ ] Validate that only necessary cookies operate before consent.
- [ ] Verify privacy requests end to end and staff the monitored support
      channels.
- [ ] Train support staff on shipping delay, cancellation, return, refund,
      dispute, privacy, and accessibility procedures.
- [ ] Complete keyboard, focus, screen-reader, contrast, target-size, reduced
      motion, and error-summary validation.
- [ ] Capture real desktop screenshots for the responsive checkout, catalog,
      product, cart, content, Admin, and recovery matrices.
- [ ] Complete Lighthouse budgets and production-like performance testing.
- [ ] Obtain named business, legal, tax, support, security, and
      production-change sign-offs.

## Production release gate

Production may be proposed only after all launch-blocking items above are
complete or explicitly risk-accepted with an owner, rationale, expiration, and
rollback. The final release evidence must include:

- exact commit and immutable artifact identifiers;
- green lint, format, strict typecheck, unit, integration, E2E, accessibility,
  coverage, dependency, secret, SBOM, image, and production-build gates;
- healthy staging deployments and complete smoke/browser matrices;
- payment, tax, refund/dispute, privacy, retention, and recovery evidence;
- timed database and media restores;
- SLOs, alerts, runbooks, on-call ownership, and rollback rehearsal; and
- explicit approval immediately before creating or changing production state
  or traffic.
