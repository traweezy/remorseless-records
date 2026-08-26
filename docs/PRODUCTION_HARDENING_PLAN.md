# Production Hardening Plan

Last verified: August 25, 2026

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
- Deployed source: `797292b66d87e9919c68d9b9e25ebbb5a19982dd`.
- Railway project: `store`; only the `staging` environment exists.
- Backend deployment: `40fb5e6b-066b-4798-a60f-8b84a4f6b01a` (`SUCCESS`).
- Storefront deployment: `7b28678f-81bd-4929-8cf6-052167e5e73e`
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

## Current slice: native Admin mutation overlays

- [x] Overlay `POST /admin/products/:id` with exact `product:update`
      authorization.
- [x] Overlay `POST /admin/products/:id/variants/:variant_id` with exact
      `product_variant:update` authorization.
- [x] Constrain the matchers to generated `prod_...` and `variant_...` IDs so
      Product import, batch, and export routes cannot inherit an update grant.
- [x] Pin Medusa 2.18's missing native policies and prove each project overlay
      sorts before native validation and handler execution.
- [ ] Pass the full local gates, commit, push, and watch all GitHub and Railway
      staging checks to `SUCCESS` on the exact SHA.
- [ ] Run authenticated staging allow/authentication probes and confirm policy
      counts, role links, health checks, and logs remain unchanged.

## Authorization work after the current slice

- [ ] Add explicit fail-closed component boundaries to Catalog Authoring,
      Catalog Merchandising, Product summary, and Variant widgets. Dashboard
      `handle.permissions` metadata is not an authorization boundary.
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
- [ ] Mitigate `GHSA-jmr9-qjv8-65gv` in `extract-zip` by preventing unnecessary
      browser downloads and upgrading, replacing, or patching the
      Lighthouse/Pa11y parent chain.
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

## Observability and operations

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
