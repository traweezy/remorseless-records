# Production Hardening Plan

Last verified: August 31, 2026

This is the authoritative launch-readiness backlog for Remorseless Records. It
supersedes the local `tmp/HARDENING_NEXT_STEPS.md` working note. Detailed
operating procedures remain in the linked runbooks and ADRs; this document
tracks what is still required before production traffic is approved.

## Active handoff — August 31, 2026 at 23:15 EDT

The locally implemented **Legal, accessibility, and launch acceptance** slice
is complete and accepted on staging. The accepted application revision is
`8e904890e949f9833cff4f1adaf9ff13f1512a73`; this documentation closure is the
only remaining repository change. The pre-existing untracked `Default/`
directory is unrelated user content and must remain unread, untouched, and
unstaged.

The launch implementation includes exact paid/free checkout disclosures,
server-initial consent controls, a privacy-request BFF with accessible recovery,
a deterministic 14-scenario launch matrix, 21 critical cross-browser journeys,
Pa11y, and a six-route three-run-median Lighthouse gate. The catalog intent
refresh correction is accepted at `255903be923ef054c1362c9ce77e975084e30392`.
The Admin accessibility/support slice remains accepted at
`7a82faf07f6d0ca144f45d9e9d17af35f33e3e9a`.

The final application revision restores accessible News covers for six legacy
published records that predate mandatory alternative text. Store and Admin
read boundaries derive a deterministic title-based fallback, while new Admin
writes remain strict and the seed path persists authored alternative text.
Backend CI `33464166082`, Storefront CI `33464166101`, and Root CI
`33464166091` passed on the exact SHA. Backend Railway deployment
`1690f323-3358-47e7-b668-701a973ec2e4` reached `SUCCESS` with image digest
`sha256:c5cda97578e78a96478396db869df428c5214be60e650e647500a1df2293dbbe`;
the unchanged Storefront correctly skipped deployment and remains accepted at
deployment `fe3169b7-b737-4bf8-80cb-29fba7a99736`, image digest
`sha256:09a69d66f49d710fa21ff83a6ce9ea443e44a08dbfe7af0de7c933ded2dd8a05`.

Local acceptance is green: the Backend passed 273 suites / 2,044 tests at
91.46% statements, 84.87% branches, 95.62% functions, and 91.48% lines; the
Storefront passed 136 baseline files / 810 tests at
94.25/86.65/96.03/94.25 and 35 transactional files / 313 tests at
83.39/76.02/85.81/83.48. Strict TypeScript, Biome, production builds, frozen
packaged-server installation, 54 responsive journeys with two expected skips,
14 launch journeys, 21 Chromium/Firefox/WebKit critical journeys, Pa11y, and
Lighthouse all passed. Real graphical desktop captures of Product, Terms,
cart, checkout, confirmation, and recovery were inspected in addition to the
earlier Admin and Storefront Catalog captures.

Live acceptance returned HTTP 200 for both `/live` and `/ready` pairs,
Storefront `/news`, Backend `/store/news`, and Storefront `/api/news`. Both News
APIs returned all six visible entries with non-empty cover alternatives. The
20-minute acceptance window contained zero Backend or Storefront HTTP 5xx
responses and no News/projection failure; Railway's only Backend error-level
record was its `$ node ./scripts/release-prepare.mjs` command banner.

Production remains blocked by the unchecked operational and approval items in
this plan: qualified legal/tax/client approval; staffed support and privacy
ownership plus training; named launch sign-offs; the real Stripe/tax/refund
matrices; the full scheduler no-recurrence window; production infrastructure,
least-privilege roles, private service exposure, backups/PITR and timed restore
drills; final runtime supply-chain evidence; and production monitoring/change
approval. The deliberate `scheduler_incident_latched` reason remains open and
must never be cleared manually or with synthetic state.

## Operating contract

- `staging` is the default integration branch and the only branch connected to
  automatic Railway staging deploys. Normal work is pushed to `staging`.
- `master` is the production-candidate branch and advances only through a
  reviewed pull request from an exact, accepted `staging` commit.
- Production deploys are manual from an approved exact `master` SHA. A merge to
  `master` never authorizes or automatically triggers production work.
- Until launch is explicitly approved, any separately approved production
  validation deployment must be stopped after validation and verified to have
  zero running instances so it does not continue accruing compute cost.
- Use Node 26.x, pnpm 11.17.0, and the single root lockfile.
- Deliver cohesive, reviewable Conventional Commits. Prefer larger hardening
  slices when the bundled controls share one security or release boundary.
- Before each push, pass the focused tests plus repository lint, strict
  typecheck, relevant coverage, security checks, and production builds.
- Work one named backlog section at a time. Complete every locally executable
  objective in that section, update its documentation, and run focused local
  checks after each objective plus the full local section gates before pushing.
- Push the completed local section as cohesive atomic commits, then watch all
  GitHub Actions jobs and affected Railway staging deployments to `SUCCESS`
  and run the section's health, route, API, log, and browser acceptance before
  starting another section.
- Do not change production traffic, paid services, credentials, domains,
  replicas, data, or destructive migrations without explicit approval.

## Verified baseline

- Git branches: `staging` is the default/integration branch; `master` is the
  protected production-candidate branch. Retired `main` was deleted.
- Latest application-changing staging SHA accepted:
  `8e904890e949f9833cff4f1adaf9ff13f1512a73`.
- Latest documentation-bearing staging SHA accepted:
  `f620c6ee9678903863d723c165631437572ce968`.
- Railway project: `store`; only the `staging` environment exists.
- Application acceptance Backend deployment:
  `1690f323-3358-47e7-b668-701a973ec2e4` (`SUCCESS`).
- Application acceptance Storefront deployment:
  `fe3169b7-b737-4bf8-80cb-29fba7a99736`
  (`SUCCESS`).
- Backend and Storefront `/live` and `/ready` checks return HTTP 200.
- The public storefront route/API smoke matrix passes. `/products`
  intentionally redirects to `/catalog`.
- Staging uses Stripe test mode, TaxRate.io, Redis, PostgreSQL, MinIO, and
  Meilisearch. No production environment or production domain has been
  provisioned.
- The deployed RBAC baseline contains 260 active policies, one wildcard, 259
  concrete Super Admin permissions, and all 27 exact custom definitions.

## Completed slice: distributed abuse-control boundary

- [x] Inventory all generic Storefront and Backend rate limits, identity
      sources, Redis clients, route semantics, and outage behavior.
- [x] Replace process-only generic counters with one atomic Redis fixed-window
      contract while retaining a bounded 10,000-bucket local fallback for
      explicitly availability-sensitive reads and local development.
- [x] Fail closed with correlated RFC 7807 HTTP 503 responses for cart,
      contact, privacy, Store, public-form, tax-control, and media mutations
      when Redis cannot make the decision.
- [x] HMAC every persisted client key with an existing validated server secret;
      keep raw client addresses, User-Agent, credentials, and request content
      out of Redis keys and logs.
- [x] Trust only Railway's validated `X-Real-IP` when all three documented
      Railway project, environment, and service system IDs establish the
      runtime boundary; ignore `X-Forwarded-For` and vendor forwarding headers.
- [x] Remove User-Agent from cart rate identity and prove two agents at the same
      trusted client address consume the same shared bucket.
- [x] Add Storefront and Backend boundary, invalid/repeated-header, atomic Lua,
      HMAC privacy, concurrent-decision, outage-policy, Retry-After, and
      correlated middleware response tests.
- [x] Document the trust boundary, failure matrix, incident checks, and rollback
      path in both application READMEs and `docs/RELEASE_OPERATIONS.md`.
- [x] Pass complete lint, strict typecheck, unit/coverage, security, and
      production-build gates.
- [x] Commit and push the cohesive slice to `staging`; watch all exact-SHA
      GitHub workflows and both Railway deployments to success before moving
      on.
- [x] Verify both live/readiness pairs, representative guarded reads, response
      headers, Redis health, and exact-deployment build/runtime/network logs.

Discovery: the cart mutation boundary already had an atomic Redis Lua counter
with fail-closed write behavior, but its client signal combined the first
unconditionally trusted forwarding value with User-Agent. Every other generic
Storefront and Backend limiter was process-local, so replica changes reset and
split enforcement. Railway's current public-networking contract identifies
`X-Real-IP`, not the previously preferred `X-Forwarded-For`, as the client
remote address. The shared implementation therefore preserves the proven cart
atomic contract, applies it to every generic route class, and narrows identity
to the documented Railway boundary without requiring a new service variable or
an infrastructure mutation.

Local gate evidence: repository and Backend lint plus both strict typechecks
passed; Backend passed 965 tests across 182 suites; Storefront passed 616 tests
across 116 files with 93.80% statement, 86.64% branch, 94.70% function, and
93.77% line coverage. Both production builds passed, including the Storefront
client-bundle secret check over 127 static assets. The production dependency
audit, React Router security backport check, Trivy high/critical dependency and
secret scan, and pinned Gitleaks 8.30.1 full-history scan passed. The Storefront
build used isolated synthetic build-only configuration because the developer
environment intentionally contains non-production placeholders; its local
Meilisearch connection refusal followed the existing non-fatal build fallback.

Exact staging acceptance: application SHA
`1474dd785aab5a1c0914ad9a067fc277fa9d34cd` passed Root CI
`33257594024`, Storefront CI `33257594121`, and Backend CI `33257594123`.
Railway then deployed the same SHA through Backend deployment
`2217f6e9-c2fb-461e-9ab7-fba90a9ab585` and Storefront deployment
`c558abc0-9b68-4809-9195-297bc01aacfd`, both at `SUCCESS`. Their accepted image
digests are respectively
`sha256:7f3fe4da7fa4363c78195cb665a430ed28a325e32254eb1e80c70521df1f6963`
and
`sha256:d33cb3770a5ba6961cc20b00ac73d4db47031fbc2fd407c9c52e878bcc075fcf`.
Backend predeploy found migrations current, connected every Redis provider and
object storage, indexed and validated all 461 published products in a candidate
Meilisearch index, reconciled 461 of 461 records, and cut over atomically while
retaining the prior index for rollback. Both exact runtime instances remained
`RUNNING` after replacement: Backend
`3c53b09f-4377-42f1-a38b-91d152727c39` and Storefront
`651d273d-7cd4-42eb-bdf6-614a4ebc2476`.

Live staging acceptance: both `/live` and dependency-aware `/ready` pairs, the
Backend `/api/health`, Storefront `/api/healthcheck`, storefront root, genre
filters, guarded product search, and non-mutating cart route returned 200. The
Storefront and Backend responses retained their strict transport, CSP, frame,
content-type, referrer, permissions, and no-store policies. A scoped read-only
Redis probe returned `PONG`, 6.65 MiB used memory, 13 connected clients, four
expected blocking workers, zero rejected connections, zero evictions, and zero
server latency events. It also discovered `maxmemory=0` with `noeviction`; a
capacity-aware memory ceiling and persistence-compatible eviction decision
remain backlog rather than an unreviewed staging mutation.

Exact runtime logs contained no `rate_limit.unavailable`, Redis connection
error, HTTP 429, HTTP 503, or HTTP 5xx record. Railway's
[CLI log contract](https://docs.railway.com/cli/logs) exposes network-flow logs
at service scope, so acceptance additionally filtered the returned
`deploymentId` and `deploymentInstanceId` fields to the exact release and active
instances. The remaining packet-level drop records were confined to startup or
post-start indexing: short Postgres/Redis `TCP_CLOSE`, `TCP_OLD_DATA`, and
`TCP_INVALID_SYN` records plus small internet `NO_SOCKET` tails. Treating these
as transport cleanup is an evidence-based inference from their timing and peer
ports, not an undocumented definition of the Railway cause labels. There were
no failed DNS records, application dependency errors, readiness failures, or
HTTP failures. No production environment, service, or other Railway project was
read or changed during acceptance.

Documentation closure SHA
`050cf4ea4c88f403b48320e981e1b57a899a37e9` passed Storefront CI
`33258650312`, Root CI `33258650315`, and Backend CI `33258650324`. Its
docs-only Backend deployment `8ca62388-40d1-4fb4-8800-de7741c71443` and
Storefront deployment `ed88c38d-4068-4aa6-b896-ff90d6b8a2c4` both correctly
reported `SKIPPED` with `No changes to watched files`; the already accepted
application deployments remained active and healthy.

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
Backend and Storefront `/live` and `/ready`, plus the Storefront root, returned 200. Fresh administrator authentication, feature flags, and effective
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

## Completed slice: stale CodeQL clear-text logging alert

- [x] Trace CodeQL alert `1` across every analysis category instead of
      assuming its aggregate `open` state represented current source.
- [x] Verify commit `b31c3369a07d9b2dda95c1a0501deaa839d7a421`
      removed the full `medusaConfig` `console.log` sink and current source
      contains no replacement config or secret-bearing log path.
- [x] Confirm the active `.github/workflows/backend.yml:codeql` category marks
      the finding fixed and the only open instance came from the retired
      `.github/workflows/codeql.yml` analysis category removed by `010dac0`.
- [x] Evidence-dismiss the stale aggregate alert as a current-code false
      positive with the fix, retired-category provenance, and reopen condition
      preserved in GitHub's audit comment.

Discovery: the historical finding was valid when the Backend serialized the
entire Medusa configuration, including provider and application secrets. The
source fix had already shipped, but GitHub retained the alert because deleting
the original monolithic CodeQL workflow stranded its last result. The scoped
Backend CodeQL workflow remains the continuous regression gate. No application
code change or risk acceptance was needed; alert `1` was dismissed on August
26, 2026 only after the current source and per-category states were verified.

## Completed slice: staging-to-master release controls

- [x] Fast-forward the historical `staging` branch to the last accepted SHA,
      create `master` at that same SHA, and make `staging` the GitHub default.
- [x] Connect both Railway application services to `staging`, then delete the
      retired local and remote `main` references without rewriting history.
- [x] Run all three CI workflows for pushes and pull requests targeting
      `staging` or `master`.
- [x] Require the full Storefront build, Playwright, accessibility, and
      Lighthouse matrix for every production-candidate pull request.
- [x] Add a fail-closed release-policy verifier and the promotion/manual deploy
      runbook.
- [x] Protect `staging` from deletion and force pushes; require pull requests,
      conversation resolution, and deletion/force-push protection on `master`.
- [x] Commit and push the cohesive release-control slice to `staging`, then
      verify all GitHub and exact Railway staging acceptance gates.

Discovery: the remote `staging` branch already existed at the initial commit
and was an ancestor of the accepted code, so it was safely fast-forwarded.
Railway has only a `staging` environment; no production service, credential,
domain, deployment, or traffic was created or changed. The manual production
contract therefore records the intended boundary without pretending the
production platform is ready. The source cutover redeployed accepted SHA
`26a7c81101ba25a5a0570f959b84c6dc77625859` as Railway Backend
`ebd34795-78cf-4f52-8a0e-095f49a52120` and Storefront
`6a4e988e-fc24-429e-bc0b-f6a720a75dd7`, both from branch `staging`. Health,
readiness, Admin, storefront, catalog, and API probes passed; filtered logs
contained no application warning or error.

Release evidence: Root CI `33021651528`, Backend CI `33021651592`, and
Storefront CI `33021651476` passed for
`f277e975cb44d539639170594dd8d573b19316f4`. Railway Backend
`8030caa9-82a0-4e98-a40c-b64260ce86c5` and Storefront
`5ba61d4e-a267-4469-8b4b-f95274fbbf65` deployed that exact SHA from
`staging`. Backend `/api/health`, `/live`, `/ready`, and `/app` returned 200.
Storefront `/live`, `/ready`, `/`, `/about`, `/accessibility`, `/cookies`,
`/terms`, `/catalog`, and `/api/healthcheck` returned 200; `/products`
retained its expected 308 redirect to `/catalog`. Exact-deployment log scans
found no application warning or error.

Discovery: reconnecting a Railway GitHub source reset each deployment
trigger's wait-for-CI setting. Both application triggers were restored to
`checkSuites: true` after this release. The next `staging` push must prove each
exact deployment enters `WAITING` until its GitHub checks succeed before the
branch/deploy cutover is considered fully regression-tested.

## Completed slice: remaining CodeQL alert closure

- [x] Classify all seven open alerts by rule, active analysis category, exact
      dataflow, current source, and existing regression coverage.
- [x] Evidence-dismiss stale alert `2`: commit `240b543` replaced incomplete
      quote-only escaping with `JSON.stringify`, adversarial tests cover quote,
      backslash, control-character, and trailing-slash inputs, active analyses
      mark the finding fixed, and only the retired workflow category remained.
- [x] Replace the search document's regex HTML stripping and ordered entity
      replacements with the shared allow-list sanitizer/plain-text boundary.
- [x] Eliminate both post-build check/use races by opening the existing regular
      file once with no-follow semantics, transforming that inode, and flushing
      it through the same descriptor.
- [x] Bound and validate remote category pages, identifiers, handles, counts,
      pagination, authentication responses, URLs, and request duration before
      building an exported category map.
- [x] Write category-map and search-rebuild JSON artifacts through canonical,
      contained directories, exclusive mode-0600 temporary files, durable
      flushes, and same-directory atomic renames.
- [x] Add focused malformed-markup, traversal, symlink, private-mode,
      duplicate-handle, bounded-schema, and optional-file regression tests;
      strict Backend typecheck and all 19 focused Node/Jest tests pass.
- [x] Pass the full repository quality/security/build matrix, commit and push
      the cohesive slice, confirm the six active findings close in both current
      CodeQL categories, prove Railway waits for CI, and complete exact-SHA
      staging acceptance.

Discovery: alerts `16` and `18` describe intentional remote JSON evidence
writes, not attacker-controlled output paths. The code now constrains the
remote schemas and uses non-executable private atomic artifacts. The active
analysis recognized those controls and marked both findings fixed without a
dismissal or suppression. Alerts `7`, `10`, `11`, `16`, `17`, and `18` all
closed automatically from the current analysis. Alert `2` remains the sole
evidence-dismissed retired-category result, with its prior source fix,
adversarial tests, provenance, and reopen condition recorded in GitHub.

Current local evidence: release-policy and secure-artifact gates, cross-app
ESLint and strict typecheck, all 161 Backend suites with 860 tests, and all 102
Storefront suites with 538 tests pass. Storefront coverage remains 93.5%
statements, 85.71% branches, 94.41% functions, and 93.47% lines. The production
audit reports only the three documented ignored moderates; extract-zip and
React Router behavioral security verifiers pass; Trivy reports zero
high/critical dependency, misconfiguration, or secret findings. Both
production builds pass. The Admin bundle remains within budget at 1,798,097
gzip bytes for the main asset and 2,392,689 gzip bytes total.

Release evidence: Root CI `33023621651`, Backend CI `33023621696`, and
Storefront CI `33023621523` passed for
`91fd2d59ec8e267282e576cc2f6ce3d0fe8ac926`. Railway Backend
`48181b43-e2e4-4795-ab9f-578a7cef467e` and Storefront
`2e682693-87dc-4311-9f8b-c04b9917b61c` entered `WAITING` while all three
GitHub workflows were queued or running, changed to `BUILDING` only after the
three suites succeeded, and reached `SUCCESS` on that exact SHA from
`staging`. Both deployment triggers remained on `staging` with
`checkSuites: true` and all three suites valid. GitHub reports zero open
CodeQL alerts.

Backend `/api/health`, `/live`, `/ready`, and `/app` returned 200. Storefront
`/live`, `/ready`, `/`, `/about`, `/accessibility`, `/cookies`, `/terms`,
`/catalog`, and `/api/healthcheck` returned 200; `/products` retained its
expected 308 redirect to `/catalog`. Exact-deployment log scans found no
application warning, error, non-2xx Backend request, or secret value. The only
Railway `error` levels were the already tracked successful command banners;
the build-log `secret` matches were Railpack hash/cache step labels without
assignments or values.

## Completed slice: browser and HTTP response boundaries

- [x] Replace the Storefront production script policy with a per-document,
      cryptographically random nonce and `strict-dynamic`; forward the same CSP
      in the request so Next can authorize framework scripts, and return it in
      the response with `script-src-attr 'none'` and `base-uri 'none'`.
- [x] Retain webpack SRI manifest generation for eligible assets and replace
      the one Cache Components-only catalog function with an explicit
      five-minute tagged data cache so strict nonces can make dynamic documents
      without discarding Backend/search caching.
- [x] Preconfigure Zod's supported `jitless` mode in a nonce-authorized bootstrap
      before client bundles load, preventing its eval capability probe from
      generating an enforced CSP event during hydrated catalog navigation.
- [x] Make every JSON-LD data block inherit the request nonce at the component
      boundary, including page-level product and catalog structured data.
- [x] Remove sample Medusa S3 and direct Unsplash access from the production
      CSP; retain an exact HTTPS-only Next Image allowlist entry for the
      version-controlled Unsplash news seed data, validate every configured
      dynamic image origin, and reject credentials or non-HTTP schemes.
- [x] Add global Backend/Admin HSTS, CSP, `nosniff`, frame, referrer,
      permissions, framework-disclosure removal, and default no-store response
      headers without overriding static-asset caching.
- [x] Correct the staging-only boundary gap found during acceptance: install
      the configured Backend header map in Medusa's earliest Express loader so
      framework-owned Admin and built-in API responses cannot bypass project
      route middleware; retain downstream Admin/static cache overrides.
- [x] Add safe App Router route/root recovery boundaries with deterministic
      focus, redacted digests, retry/home actions, and unit coverage.
- [x] Contain malformed and oversized cookie-consent values at the parser
      boundary with adversarial regression coverage.
- [x] Pass focused Backend lint, strict typecheck, build, and 76 header tests;
      pass Storefront lint, strict typecheck, the production build, and 29
      focused CSP/proxy/error/JSON-LD/cookie/image-configuration tests.
- [x] Remove all direct and prebundled Admin Zod eval capability probes at Vite
      build time without adding `unsafe-eval`; fail the packaged build if any
      reviewed empty-`Function` probe remains, with seven focused regression
      tests.
- [x] Pass the complete local quality, coverage, security, and production-build
      matrix; validate the recovery surface in real Chromium and capture both
      browser and full-desktop `flameshot` screenshots.
- [x] Commit and push the cohesive slice, prove Railway waits for all three
      GitHub suites, accept both exact staging deployments, and run CSP/header,
      browser-console, health, route, log, and cache-behavior probes.

Discovery: webpack SRI alone does not authorize Next's inline React Flight
bootstrap scripts. A production Chromium proof blocked 18 inline scripts and
rendered an empty body under the otherwise strict policy, so that design was
rejected before commit. Request nonces require dynamic HTML by design. Existing
Medusa, Meilisearch, product, news, shelf, category, discography, and filter
data caches remain explicit; the catalog initial-search cache is now an
explicit tagged five-minute cache.

Live staging discovery: executable scripts are authorized by the per-request
nonce; after the Zod bootstrap correction, 5 of 24 eligible Next asset tags
also serialize generated SRI metadata. Real Chromium surfaced Zod 4.4's caught
eval capability probe as an enforced CSP event during hydrated catalog
navigation. Production does not add `unsafe-eval`: the documented Zod
`jitless` configuration now skips the probe before any client schema loads.

Current local evidence: cross-app lint and strict typecheck, all 164 Backend
suites with 873 tests, and all 107 Storefront suites with 558 tests pass.
Storefront coverage is 93.67% statements, 85.98% branches, 94.59% functions,
and 93.64% lines. The production audit reports only the three documented
ignored moderates; extract-zip and React Router behavioral security verifiers
pass; Trivy reports zero high/critical dependency, misconfiguration, or secret
findings; Gitleaks reports no leaks across the full tracked history; and the
CycloneDX SBOM and production-license inventory verify. Both production builds
pass. The Admin main bundle is 1,798,138 gzip bytes and the total is 2,392,949
gzip bytes, both within budget.

The corrected local production preview served a representative seeded
Unsplash URL through `/_next/image` as HTTP 200 `image/jpeg` with a one-year
cache policy. The exact GitHub and Railway acceptance below corroborates that
local proof.

Trusted Types report-only coverage is now implemented for every Storefront
document. The response advertises the bounded
`/api/security/trusted-types-report` collector through `Reporting-Endpoints`
and sends `require-trusted-types-for 'script'` plus an explicit policy-name
allowlist without changing the enforced CSP. The collector accepts legacy CSP
and Reporting API envelopes, rejects cross-site and oversized input, caps
batches and request rate, and discards document URLs, samples, user-agent data,
and other browser payload before emitting a count, directive, runtime identity,
and correlation identifiers.

Local browser discovery removed three dependency-owned sinks instead of adding
a permissive default policy. Radix Select's static scrollbar CSS now lives in
the application stylesheet, Splide arrows render as semantic React controls,
and the pinned Stripe loader creates `remorseless-stripe-js` values for only
the exact Dahlia script URL with its one supported fraud-signals query variant.
Contract tests pin both patched packages, and the Storefront post-build verifier
rejects any Stripe loader bundle that lacks the named policy. React's inert
script construction and the already-sanitized Next JSON-LD serialization are
classified as reviewed framework events only when the source is a versioned
Next client chunk. Enforcement remains intentionally disabled until the same
matrix passes on staging and the privacy-bounded report stream completes its
reviewed observation window without an unexplained sink.

Staging acceptance discovery: commit
`29f2d59666b5571ca53b791a1d8ca06135fa3ca1` passed Root CI `33027448458`,
Backend CI `33027448442`, and Storefront CI `33027448466`; Railway correctly
held Backend `b39fbf89-b26f-4aa3-b114-79f383c8cab3` and Storefront
`82ca5fe3-16f4-4efb-826e-ee512c0cb444` in `WAITING` until all three succeeded,
then both deployments reached `SUCCESS`. Health and public-route probes passed,
and Storefront returned distinct per-request CSP nonces. Acceptance remains
open because the live probe also proved that Medusa's framework-owned `/app`
and early built-in API responses bypass project route middleware. The pinned
framework patch and config-owned global response policy now close that exact
gap; the corrective commit must pass the same CI, deploy, header, browser, and
log gates before this slice is complete. A clean local package build contains
the new framework patch hash and compiled response-header configuration; its
frozen production dependency install and executable early-loader verifier pass.

Corrective commit `e303d4cf9a293252ae66362e7514c9c695658c0e` passed Root CI
`33030346851`, Backend CI `33030346849`, and Storefront CI `33030346839`.
Railway again waited for all three suites, then Backend
`29236a59-7a58-4ba8-bc29-2d383c43c9b5` and Storefront
`15098486-9576-4a21-9a9d-a91992250f0d` reached `SUCCESS` on that exact SHA.
Backend framework and Admin headers, API no-store behavior, Admin no-cache,
and one-year immutable versioned assets all pass live probes. Storefront health
and public-route probes pass; two documents returned distinct 32-character
nonces, all 44 executable scripts and all 3 JSON-LD blocks carried the matching
request nonce, and the Zod bootstrap preceded client bundles in the document
head. Real Chromium then confirmed the prior Zod CSP event is gone, but exposed
ten HTTP 400 responses from Next Image for the version-controlled Unsplash news
seed URLs. The optimizer returned `"url" parameter is not allowed` because the
seed host had been removed with unused sample origins. The local correction
now admits only exact HTTPS `images.unsplash.com`, deduplicates configured
hosts, retains the direct-browser CSP exclusion, and passes four focused
configuration tests. The following exact deployment completed the required
image and browser repeat.

Image correction commit `c5699aba8a641dbb1fa8d7c2f7c7f915dd06fc97`
passed Root CI `33031725836`, Backend CI `33031725848`, and Storefront CI
`33031725903`. Railway held Backend
`0eac659b-08d7-420e-a3fa-d64e4b7674fb` and Storefront
`9db48aba-8561-4e4d-8e3e-0ca4a3c5e248` until all three suites passed, then
deployed that exact SHA successfully. All six seeded Unsplash images returned
HTTP 200 `image/jpeg` through `/_next/image`; the complete route, header, nonce,
SRI, JSON-LD, cache, and redirect matrix remained green. Real Chromium reported
zero Storefront CSP events, HTTP errors, page errors, unexpected request
failures, or console errors across Home, hydrated Catalog navigation, About,
and Checkout. Next's cancelled speculative RSC prefetches were classified
separately from request failures.

The same exact-SHA browser run discovered three enforced `script-src` events
on the unauthenticated Admin: three bundled Zod copies independently ran their
caught empty-`Function` capability probes. Production still does not add
`unsafe-eval`. A fail-closed Admin Vite transform now selects the non-JIT Zod
path in both direct modules and the prebundled Dashboard copy, while the
post-build verifier rejects any generated Admin index containing a reviewed
probe shape. The full Backend build, frozen packaged install, bundle budget,
164 suites/873 tests, lint, strict typecheck, and production audit pass. Real
Chromium loaded the generated login UI under strict `script-src 'self'` with
zero CSP events and zero page errors; the 1440×1000 screenshot was inspected
for clipping, hierarchy, and legibility. The exact staging deployment and
repeat Admin browser/log acceptance below close that final gate.

Admin CSP commit `2818d6540aa0f7f200d3c7e81e39b48d3c860b2d` passed
Root CI `33033295428`, Backend CI `33033295370`, and Storefront CI
`33033295409`. Railway kept Backend
`3eae1057-6432-4218-a7e6-8334345b4d7d` and Storefront
`87da9b5b-bce1-4d0c-a9b7-b752e57543a4` in `WAITING` until all three suites
passed, then both exact-SHA deployments reached `SUCCESS`. The deployed Admin
asset `/app/assets/index-Gvlwi6_m.js` contains zero reviewed eval capability
probes. Real Chromium loaded `/app/login` with zero CSP events, page errors, or
request failures; the only non-2xx responses were the two expected anonymous
`/admin/users/me` 401s. The Storefront repeat reported zero CSP events, 4xx/5xx
responses, page errors, unexpected request failures, or console errors across
Home, hydrated Catalog navigation, About, and Checkout. Navigation-cancelled
RSC prefetch and lazy-image requests were classified separately from failures.

The exact Backend and Storefront build logs contain only `info` entries, no
failure/exception terms, and no secret-like assignments. Railway's four
Backend and one Storefront runtime `error` entries are successful
`release:prepare`/storage/search and `next start` command banners; removing or
reclassifying that platform noise remains an observability task. The inspected
1440-pixel Storefront and Admin captures are
`/tmp/remorseless-staging-home-security-2818d65.png` and
`/tmp/remorseless-staging-admin-security-2818d65.png`; product/news images,
cookie controls, navigation, and both login fields render without clipping or
broken assets. This completes the browser and HTTP response-boundary slice.

Documentation commit `6fed27f6140bef24c193272658312a3887483867`
passed Root CI `33034396434`, Backend CI `33034396006`, and Storefront CI
`33034396200`. Railway held Backend
`40ece483-2486-4884-93f7-a19adf300464` and Storefront
`c3ca2efa-d749-4964-960e-ac3a92b8ddf6` until all three workflows passed, then
both exact-SHA deployments reached `SUCCESS`. Backend and Storefront `/live`,
`/ready`, plus both compatibility health aliases returned HTTP 200; every
dependency check was `ok`, and neither exact deployment emitted an error-level
startup log.

## Completed slice: correlated API and request observability boundary

- [x] Inventory 30 Storefront and 55 Backend custom route files, existing
      envelopes, request-ID handling, trace propagation, logs, contracts, and
      tests. They export 112 route operations and 110 unique path/method pairs;
      no OpenAPI document existed and only eight files emitted
      `application/problem+json`.
- [x] Validate bounded incoming request IDs or generate UUIDs, reject malformed
      W3C trace context, create a new span per hop, and return correlation
      headers from the global Backend middleware and Storefront proxy.
- [x] Propagate request and trace context through Storefront Medusa cart,
      checkout, product, bundle, news, contact, privacy, region, receipt,
      status, and tax-link calls.
- [x] Standardize shared Storefront guard/BFF failures and Backend security,
      checkout-status, and tax-reporting failures on correlated RFC
      7807-compatible responses with stable codes, safe detail, instance,
      status, request ID, trace ID, and bounded field errors.
- [x] Add structured, redacted Backend completion logs and Storefront problem
      logs containing service, environment, commit SHA, request ID, trace ID,
      and span ID without paths, queries, PII, credentials, provider bodies, or
      stack leakage.
- [x] Add request/trace validation, child-span propagation, redaction,
      validation-problem, proxy, middleware, checkout client, and route tests;
      add reusable OpenAPI 3.1 components and update client problem mapping.
- [x] Pass the complete locally runnable quality, security, coverage, and
      production-build matrix.
- [x] Correct Storefront problem-log severity after staging proved that Railway
      classifies `console.warn` as `level:error`: expected 4xx problems now use
      stdout/info while 5xx problems remain on stderr/error, with regression
      coverage for both branches.
- [x] Convert the remaining handler-specific custom Backend error envelopes
      without changing the native Medusa envelope consumed by the Admin SDK.
      The only direct outliers were `/key-exchange` and the Stripe lifecycle
      webhook; both now return correlated, redacted, no-store problems.
- [x] Add the Backend authentication, authorization, validation, provider, and
      unexpected-error ownership matrix plus installed Medusa-handler
      compatibility tests for native 401, 403, 400, and redacted 500 responses.
- [x] Add a supported Storefront request-completion hook through Next's
      OpenTelemetry root span processor and `onRequestError`, correlated by a
      bounded five-minute/10,000-entry request registry with no external
      collector or paid telemetry dependency.
- [x] Add dynamic request correlation before Medusa's first framework
      middleware and replace framework path/IP/User-Agent completion output
      with one redacted final-status event without duplicating project route
      listeners.
- [x] Apply bounded Storefront provider deadlines, distinguish typed 502
      unavailability from 504 timeout and unexpected 500 failures, redact
      caught provider details, and cap discography pagination at 25 pages.
- [x] Generate the full custom endpoint OpenAPI inventory with 85 route files,
      112 source operations, 110 unique operations, path parameters, service
      ownership, problem-envelope references, and the Storefront provider
      failure matrix; fail `qa:lint` when it becomes stale.
- [x] Push the current candidate only to `staging`; repeat exact-SHA CI,
      Railway, route, log, and browser acceptance before advancing.

Earlier accepted evidence: the OpenAPI 3.1 YAML parses and exposes the required
`ApiProblem` and `NativeMedusaError` schemas plus the detailed boundary paths;
release-policy, private-artifact, framework-header,
Storefront ESLint, and both strict typecheck gates pass. All 167 Backend suites
with 892 tests and all 109 Storefront suites with 571 tests pass. Storefront
coverage is 93.82% statements, 86.15% branches, 94.55% functions, and 93.80%
lines. Both production builds pass; the Admin main bundle is 1,799,150 gzip
bytes and the total is 2,394,099 gzip bytes, both within budget. The production
audit reports only the three documented ignored moderates, and both extract-zip
containment and React Router backport verifiers pass. During the full-suite
repeat, 16 existing call assertions exposed the new correlation argument; the
tests now prove that each route forwards its exact request context instead of
loosening the propagation contract.

Resolved framework discovery: Medusa creates its request scope before loading
the remaining framework middleware, so the installed 2.18 patch now validates
or generates correlation at that first dynamic seam. Next exposes final method,
status, and duration on the `BaseServer.handleRequest` root span, so a local
span processor can emit correlated completion events without exporting spans
or recording URLs. Both implementations are bounded and omit paths, queries,
headers, bodies, client addresses, User-Agent, exception messages, and provider
payloads.

Current implementation evidence: lifecycle-focused Storefront tests cover
request-registry TTL/cardinality, final status, privacy, repeated headers,
trace fallback, and duplicate-listener prevention. The installed Medusa patch
verifier behaviorally proves early correlation and redacted framework
completion. Provider-focused tests prove default SDK cancellation, combined
caller cancellation, safe error classification, read-only retry/backoff under
one deadline, bounded `Retry-After`, Meilisearch transport/transient-status
retry without nested catalog attempts, Meilisearch and news request
cancellation propagation, correlated Medusa Store read retry and incoming-
request cancellation without unsafe methods, cached Medusa product,
collection, category, region, and bundle reads through the same boundary,
cart retrieval, shipping and payment-provider discovery, and order-receipt
retrieval through the same boundary, fixed-field retry events, and
provider-detail redaction. Cart, checkout, and other mutations remain
single-attempt. The generated OpenAPI check inventories all route sources
deterministically and is wired into both the repository lint gate and Root CI.

Current local gate evidence: repository lint and policy checks plus both strict
typechecks pass. Backend passes 1,135 tests across 194 suites. Storefront passes
658 tests across 120 files with 92.99% statement, 86.01% branch, 93.98%
function, and 92.94% line coverage. Both production builds pass, including the
Storefront client-bundle secret scan over 127 static assets. The Admin main
bundle is 1,702,695 gzip bytes and 6,708,946 raw bytes; all 336 Admin assets are
2,297,109 gzip bytes and 8,376,872 raw bytes, within their four release
budgets. The production dependency audit has no actionable moderate-or-higher
finding beyond the three documented ignores; Trivy reports zero high/critical
filesystem vulnerability or secret findings. Checksum-verified Gitleaks 8.30.1
finds no leak across all 798 commits. The generated CycloneDX inventory
verifies 2,488 components and 2,489 dependency entries; the production license
inventory verifies 1,005 packages in 16 groups with only the five documented
upstream Medusa packages lacking manifest SPDX metadata. Exact-SHA staging CI,
Railway deployment, live-route, lifecycle-log, and browser acceptance all
passed on the final application commit recorded below.

Provider-read exact staging acceptance: commit
`c55933a9dfd9179c979461c50a9d6f4d3d5ea38d` passed Root CI `33284460763`,
Backend CI `33284460755`, and Storefront CI `33284460758`, including unit
coverage, both production builds, CodeQL, dependency/secret scans, Playwright,
pa11y, and Lighthouse. Railway held Storefront deployment
`46647945-3dce-4420-a2b5-5443f46a60c5` until those workflows passed, then
released image digest
`sha256:47797bb52413db5f3239fc78f4e2d363d8231fe05662b700762495c5fe802abd`
to `SUCCESS` on that exact SHA. Storefront `/live`, `/ready`,
`/api/healthcheck`, `/`, `/news`, `/discography`, and `/sitemap.xml` all
returned 200; readiness reported Backend and Redis healthy. The exact
deployment had no HTTP response at 400 or above. Its only Railway `error`-level
record was pnpm's successful `$ next start` command banner written to stderr,
not an application failure.

Search-read exact staging acceptance: commit
`48768472c78b2f265600ef043c43a100dc7335fa` passed Root CI `33285623225`,
Backend CI `33285623212`, and Storefront CI `33285623217`, including unit
coverage, both production builds, CodeQL, dependency/secret scans, Playwright,
pa11y, and Lighthouse. Railway held Storefront deployment
`39ea08cd-2154-477f-bf62-19ea7fbbee85` until those workflows passed, then
released image digest
`sha256:eb19d5599956fc4e0fd9e47e4d6419fdc2bb9b91c029365f267750cd43cf9092`
to `SUCCESS` on that exact SHA. Backend correctly retained deployment
`4a326c2f-2d09-43b5-8f9f-6599c9dfa4ff` because its watched paths were
unchanged. Storefront `/live`, `/ready`, `/api/healthcheck`, `/`, `/catalog`,
`/news`, `/discography`, and `/sitemap.xml` all returned 200; readiness
reported Backend and Redis healthy. Two trusted-origin search `POST` requests
returned 200 with the expected bounded envelope, and an empty-query probe
returned one of 461 indexed products. The exact deployment's only HTTP
response at 400 or above was the acceptance runner's intentional unsupported
search `GET`, which returned 405. Its only Railway `error`-level record was
pnpm's successful `$ next start` command banner written to stderr, not an
application failure.

Correlated Medusa Store-read exact staging acceptance: commit
`acd10f4788cc2b8b6531ca89f1c97888c19e6d22` passed Root CI `33286746908`,
Backend CI `33286746917`, and Storefront CI `33286746894`, including unit
coverage, both production builds, CodeQL, dependency/secret scans, SBOM and
license verification, Playwright, pa11y, and Lighthouse. Railway held
Storefront deployment `d3748c12-8d81-4240-aa94-cf290cbcf7a4` until those
workflows passed, then released image digest
`sha256:e63e9f064b56bc50ab909c496dc6dd02a88f1f8daf847574d44ca553daf9f8fc`
to `SUCCESS` on that exact SHA. Backend correctly retained deployment
`4a326c2f-2d09-43b5-8f9f-6599c9dfa4ff` because its watched paths were
unchanged. Storefront `/live`, `/ready`, `/api/healthcheck`, `/`, `/catalog`,
`/news`, `/discography`, and `/sitemap.xml` all returned 200; readiness
reported Backend and Redis healthy. The bounded product-list and product-detail
reads returned 200, and a trusted-origin catalog-hydration read returned one
hit with HTTP 200. All 11 matching exact-deployment HTTP records were 200,
with no response at 400 or above. The exact deployment's only Railway
`error`-level record was pnpm's successful `$ next start` command banner
written to stderr, not an application failure. Staging did not force a
provider fault; focused tests prove transient transport/status retry,
single-deadline cancellation, safe-method enforcement, and redacted terminal
failures without risking shared staging availability.

Cached Medusa Store-read exact staging acceptance: commit
`a8d4526200a5cc0f3fd17a5703468c51d4edf2f7` passed Root CI `33288230471`,
Backend CI `33288230489`, and Storefront CI `33288230513`, including unit
coverage, both production builds, CodeQL, dependency/secret scans, SBOM and
license verification, Playwright, pa11y, and Lighthouse. Railway held
Storefront deployment `d1e16883-23f3-44d5-92d0-6cddde18ab9a` until those
workflows passed, then released image digest
`sha256:881229559ea1082dc2290a57d3ee25a25ba2c274a744f80f4f98c9e415a851af`
to `SUCCESS` on that exact SHA. Backend correctly retained deployment
`4a326c2f-2d09-43b5-8f9f-6599c9dfa4ff` because its watched paths were
unchanged. Storefront `/live`, `/ready`, `/api/healthcheck`, `/`, `/catalog`,
`/news`, `/discography`, and `/sitemap.xml` all returned 200; readiness
reported Backend and Redis healthy. The bounded product-list and product-detail
reads returned 200, a trusted-origin catalog-hydration read returned one hit,
and both API correlation headers were present. All 13 exact-deployment HTTP
records were 200, with no response at 400 or above. The exact deployment had no
warning or unexpected error; its only Railway `error`-level record was pnpm's
successful `$ next start` command banner written to stderr. No healthy probe
needed a provider retry. Staging did not force a provider fault; focused tests
prove transient transport/status retry, shared-deadline cancellation,
safe-method enforcement, non-transient and parser failure handling, and
redacted telemetry without risking shared staging availability.

Checkout Medusa Store-read exact staging acceptance: commit
`e7ec4454922315f2644bc5c99f37c9701a66c652` passed Root CI `33289523038`,
Backend CI `33289523039`, and Storefront CI `33289523047`, including unit
coverage, both production builds, CodeQL, dependency/secret scans, SBOM and
license verification, Playwright, pa11y, and Lighthouse. Railway held
Storefront deployment `976ec437-893c-4fe8-bc2b-661694813728` until those
workflows passed, then released image digest
`sha256:33d5fac79dce28e2e9768fc2926b68a805ed38d039e4ba1336011c6761f87233`
to `SUCCESS` on that exact SHA. Backend deployment
`cf4b28cd-3dd4-429d-812a-8ef00fccd6b5` was correctly skipped because its
watched paths were unchanged, retaining healthy baseline deployment
`4a326c2f-2d09-43b5-8f9f-6599c9dfa4ff`. Storefront `/live`, `/ready`,
`/api/healthcheck`, `/`, `/catalog`, `/news`, `/discography`, and
`/sitemap.xml` all returned 200; readiness reported Backend and Redis healthy.
Anonymous `GET /api/cart` returned 200 with a null cart and both correlation
headers present. All 11 matching exact-deployment HTTP records were 200, with
no response at 400 or above. Railway returned no runtime record and no warning
or error for the exact deployment acceptance window. No cart, checkout,
payment, order, or receipt state was created or inspected in shared staging;
focused tests prove cart, shipping-option, payment-provider, and receipt reads
use the shared safe-read boundary while every mutation remains single-attempt.

TaxRate.io exact staging acceptance: commit
`85b8f4b6981ddcd7d7b4bc404ae96f2522afa264` passed Root CI `33291052970`,
Backend CI `33291052972`, and Storefront CI `33291052965`, including unit
coverage, both production builds, CodeQL, dependency/secret scans, Playwright,
pa11y, and Lighthouse. Railway held Backend deployment
`fa0169e2-80c9-4231-97ae-b44d15b9c25b` until those workflows passed, then
released image digest
`sha256:c34ac82c27c74aee77c8344b3a5dd6ace360a7fe34d218d8b904be1ae5fe82cc`
to `SUCCESS` on that exact SHA. Storefront deployment
`ce036094-9c69-4e5e-acb4-151196411156` was correctly skipped because its
watched paths were unchanged. Backend `/live`, `/ready`, and `/api/health` all
returned 200; readiness reported database, Redis, search, and object storage
healthy. All four matching exact-deployment HTTP records were 200: two
`GET /live`, one `GET /ready`, and one `GET /api/health`. The exact deployment
recorded 308 info events and four known successful command-echo banners that
Railway classified as errors, with zero warning, exception/fatal/failed-
operation, tax-retry, or quota-retry records. The health payload omitted its
optional version because Railway does not currently inject `COMMIT_SHA`; exact
deployment metadata and the immutable digest therefore anchor this acceptance,
and environment version injection remains an observability follow-up. No paid
TaxRate.io lookup or quota refresh was invoked in shared staging. The focused
12-test client suite proves bounded transient retries under one deadline,
single-attempt metered 4xx handling, strict rate/quota parsing, and redacted
errors and retry telemetry.

Stripe Tax calculation-boundary exact staging acceptance: commit
`fbdd86cc7ff70c2d19623d17ac7ac3ff6a252901` passed Root CI `33292644499`,
Backend CI `33292644500`, and Storefront CI `33292644548`, including 1,055
Backend tests, 658 Storefront tests with coverage, both production builds,
CodeQL, dependency/secret scans, SBOM and license verification, Playwright,
pa11y, and Lighthouse. Railway held Backend deployment
`65bef967-3f01-4795-98a5-50a5f10fdd46` until those workflows passed, then
released image digest
`sha256:e2ea8e34b138617ee539cd565f59b30d9bb37026b38d53b817e4ea9f97278f9f`
to `SUCCESS` on that exact SHA. Storefront deployment
`670268cd-4251-4192-b74f-10157e38540b` was correctly skipped because its
watched paths were unchanged. Backend `/live`, `/ready`, and `/api/health` all
returned 200; readiness reported database, Redis, search, and object storage
healthy. All five matching exact-deployment HTTP records were 200: two
`GET /live`, two `GET /ready`, and one `GET /api/health`, with no response at
400 or above. The exact deployment recorded 309 info events and four known
successful command-echo banners that Railway classified as errors, with zero
warning, non-command error, exception/fatal/failed-operation, Stripe Tax retry,
or other retry records. The Backend DNS log contained no Stripe lookup in the
15-minute acceptance window. The health payload still omitted its optional
version because Railway does not currently inject `COMMIT_SHA`; exact
deployment metadata and the immutable digest therefore anchor this acceptance.
No Stripe calculation, PaymentIntent, cart, or other paid or mutating provider
call was issued in shared staging. The focused 22-test Stripe Tax client and
service suite proves shared-deadline cancellation, bounded idempotent retry,
single-attempt rate-limit handling, strict request/response validation, and
redacted terminal errors and retry telemetry.

Stripe Tax readiness-boundary exact staging acceptance: commit
`45d437602d6753c246a45971fa8d096fbee42780` passed Root CI `33294007325`,
Backend CI `33294007268`, and Storefront CI `33294007293`, including 1,081
Backend tests, 658 Storefront tests with coverage, both production builds,
CodeQL, dependency/secret scans, SBOM and license verification, Playwright,
pa11y, and Lighthouse. Railway held Backend deployment
`ec02b5bf-769f-4269-a979-65f7902f8b6a` until those workflows passed, then
released image digest
`sha256:03cea48eee7caa44e73e8b7327c428ec8889f952e50d67b289e2f48d51508ab0`
to `SUCCESS` on that exact SHA. Storefront deployment
`6d27469c-679d-4277-8764-d3ea02aa1899` was correctly skipped because its
watched paths were unchanged. Backend `/live`, `/ready`, and `/api/health` all
returned 200; readiness reported database, Redis, search, and object storage
healthy. All five matching exact-deployment HTTP records were 200: two
`GET /live`, two `GET /ready`, and one `GET /api/health`, with no response at
400 or above. The exact deployment recorded 309 info events and four known
successful command-echo banners that Railway classified as errors, with zero
warning, non-command error, exception/fatal/failed-operation, Stripe Tax retry,
or other retry records. Two successful `api.stripe.com` DNS resolutions at
05:23:00Z occurred during deployment overlap and coincided exactly with the
hourly tax-evidence schedule; this timing makes scheduled reconciliation the
likely source, but does not prove which overlapping instance issued the read.
The acceptance-probe window beginning at 05:24:36Z contained 18 successful DNS
records, zero DNS failure, and zero Stripe lookup. The health payload still
omitted its optional version because Railway does not currently inject
`COMMIT_SHA`; exact deployment metadata and the immutable digest therefore
anchor this acceptance. Acceptance issued no Stripe readiness, provider-switch,
calculation, PaymentIntent, cart, paid, or mutating call in shared staging. The
focused 31-test client, readiness, and Admin-switch suite proves shared-deadline
cancellation, per-operation bounded retry, single-attempt rate-limit handling,
strict settings/registration and account-mode validation, fail-closed
pagination, and redacted terminal errors and retry telemetry.

Stripe payment-binding exact staging acceptance: commit
`d14a7f1aa35b641a27e9b367dcd068e53af7ef6f` passed Root CI `33295426131`,
Backend CI `33295426147`, and Storefront CI `33295426119`, including 1,135
Backend tests, 658 Storefront tests with coverage, both production builds,
CodeQL, dependency and secret scans, SBOM and license verification, Playwright,
pa11y, and Lighthouse. Railway held Backend deployment
`f66aa3a3-ef12-4300-bfef-d02c7a7f6b71` until all three workflows passed, then
released image digest
`sha256:50352773f54b5b89d47e617ee5cd7bff6515919d94c484b48cf0a1205336e6dd`
to `SUCCESS` on that exact SHA. Storefront deployment
`0bb955d6-ffce-4254-aa42-1cf66124511a` was correctly skipped because its
watched paths were unchanged. Backend `/live`, `/ready`, and `/api/health` all
returned 200; both readiness responses reported all four database, Redis,
search, and object-storage checks healthy. All five matching exact-deployment
HTTP records were 200: two `GET /live`, two `GET /ready`, and one
`GET /api/health`, with no response at 400 or above. The exact deployment
recorded 309 info events and four known successful command-echo banners that
Railway classified as errors, with zero warning, non-command error,
exception/fatal/failed-operation, Stripe payment-binding retry, or other retry
records. Its 384 DNS records from `05:59:56Z` through `06:02:05Z` all succeeded,
with zero Stripe lookup. The health payload still omitted its optional version
because Railway does not currently inject `COMMIT_SHA`; exact deployment
metadata and the immutable digest therefore anchor this acceptance. Acceptance
issued no Stripe tax-link, readiness, provider-switch, calculation,
PaymentIntent, cart, paid, or mutating call in shared staging. The focused
62-test payment-binding client, service, and route suite proves shared-deadline
settlement, bounded per-operation retry, stable update idempotency,
single-attempt rate-limit handling, strict identity/calculation/hook/update
validation, late-link rejection, and redacted terminal errors and retry
telemetry.

Stripe evidence-boundary exact staging acceptance: source head
`5d8b4c4278b43d6a44b5a883be495ee2e3987cbe` passed Root CI `33297307727`,
Backend CI `33297307752`, and Storefront CI `33297307728`, including 1,166
Backend tests, 658 Storefront tests with coverage, both production builds,
CodeQL, dependency and secret scans, SBOM and license verification,
Playwright, pa11y, and Lighthouse. Railway held Backend deployment
`76cbf3c3-a2bc-4604-bc53-7eeee5dd5fd5` until all three workflows passed,
then released image digest
`sha256:7ee6bce0a3eea9a1da7a060b66b5d06c052d2e25a8d9219f83074fc5c9c05587`
to `SUCCESS` on that exact source. Storefront deployment
`0db9fa40-03a4-4d78-887f-986ea13b35df` was correctly skipped because its
watched paths were unchanged. Backend `/live`, `/ready`, and `/api/health`
all returned 200; both readiness responses reported all four database, Redis,
search, and object-storage checks healthy. The exact `06:51:44Z`-through-
`06:51:45Z` acceptance window contained precisely five matching
exact-deployment HTTP records: two `GET /live`, two `GET /ready`, and one
`GET /api/health`, all 200, with no unexpected method, path, or response at
400 or above. The exact deployment recorded 307 info events and four known
successful command-echo banners that Railway classified as errors, with zero
warning, non-command error, exception/fatal/failed-operation, Stripe-evidence,
provider-unavailable, or retry records. Its 201 build-log records were all
info level with zero failure term. All 342 exact-deployment DNS records from
`06:50:13Z` through `06:51:45Z` succeeded with zero Stripe lookup; the probe
window's 14 DNS records were also all successful and contained zero Stripe
lookup. The health payload still omitted its optional version because Railway
does not currently inject `COMMIT_SHA`; exact deployment metadata and the
immutable digest therefore anchor this acceptance. Acceptance issued no Stripe
evidence reconciliation, lifecycle webhook, tax-link, readiness,
provider-switch, calculation, PaymentIntent, refund, dispute, association,
cart, paid, or mutating call in shared staging. The focused 53-test evidence,
lifecycle, and scheduled-job suite proves one cumulative deadline, bounded
safe-GET retry, single-attempt rate-limit and mutation behavior, expanded
PaymentIntent reuse, fail-closed pagination and shape validation, and redacted
terminal errors and retry telemetry.

Tax-cache boundary rollout discovery: implementation head
`598a90c180307d7e6ceda3bc282184b71a714934` passed its exact CI and health
checks, but was not accepted because provider construction is lazy and its
configuration event did not appear during process startup. The corrective
provider loader on exact head
`881a4d687a790eec7175c3b42613bdebc92c2724` validates and reports the same
bounded settings during Medusa startup while the lazy service reuses that
shared option mapping. Root CI `33309449059`, Backend CI `33309449057`, and
Storefront CI `33309449058` all completed successfully on that exact head,
including 1,191 Backend tests, 658 Storefront tests with coverage, both
production builds, CodeQL, dependency and secret scans, SBOM and license
verification, Playwright, pa11y, and Lighthouse. Railway held Backend
deployment `d6f30ea6-b8a3-4544-9694-5c1cae1e8ee7` until those workflows
passed, then released image digest
`sha256:0035b9d95abeeadc05c20d6b9d2af256908fb7a5af91d468eb2a6b694613bc4a`
to `SUCCESS` on the exact source. Storefront deployment
`14b394ff-12b8-49e4-b4e3-cf84c3f04940` was correctly skipped because its
watched paths were unchanged.

Backend `/live`, `/ready`, and `/api/health` all returned 200; both readiness
responses reported all four database, Redis, search, and object-storage checks
healthy. The exact `11:54:39Z`-through-`11:54:40Z` acceptance window contained
precisely five matching exact-deployment HTTP records: two `GET /live`, two
`GET /ready`, and one `GET /api/health`, all 200, with no unexpected method,
path, upstream error, or response at 400 or above. The exact deployment
recorded 311 info events and four known successful command-echo banners that
Railway classified as errors. Seven safe configuration events across the
release/start command lifecycle reported the reviewed `300000`/`2048`
TaxRate.io and `1800000`/`256` Stripe-quote TTL/capacity settings, with zero
warning, non-command error, capacity warning, cache failure,
exception/fatal/failed-operation, retry, or tax-provider operation record. Its
205 build-log records were all info level with zero failure term. All 386
exact-deployment DNS records from `11:52:54Z` through `11:55:04Z` succeeded
with zero Stripe lookup; the probe window's 14 DNS records were also all
successful with zero Stripe lookup. Acceptance invoked no quota refresh,
TaxRate.io lookup, Stripe calculation, PaymentIntent, cart, paid, or mutating
operation in shared staging. The focused 22-test cache configuration, loader
registration, and provider suite proves startup rejection, key-free numeric
telemetry, shared validation, expiry purge, and deterministic LRU ceilings.

Staging lifecycle discovery: the first `843c954` deployment proved Backend
completion logging and all live provider routes, but emitted no Storefront
completion event. Next compiles instrumentation and proxy code into separate
server bundles. Each bundle therefore has a distinct
`BoundedRequestRegistry` class identity, so the original cross-bundle
`instanceof` reuse check replaced the instrumentation processor's registry
when the proxy loaded. The registry now stores its bounded entries in one
`globalThis` `Map`, whose built-in identity is shared across the bundles, while
each wrapper retains the same validation, TTL, cardinality, and consume-once
behavior. Cross-wrapper regression coverage pins the production bundling
boundary. The first corrected exact-SHA staging release then exposed the
nested-span lifecycle boundary described below.

The corrected `4b91dec` deployment emitted redacted Storefront completion
events, proving that the cross-bundle state fix works, but the invalid-query
probe uncovered a second nested-span boundary: Next first ends a proxy-owned
`BaseServer.handleRequest` span without `next.route` and with status `200`,
then ends the route-bearing application span with the public response status.
Consuming correlation on the first span therefore misreported a public `400`
as `200`. The processor now ignores route-less root spans and consumes the
request only on the route-bearing root. Regression coverage pins both the
deferred consume and final status.

Final exact staging acceptance: fix commit
`64a2253842acf054e3e643c9ad12468def5c18b4` passed Root CI `33266599029`,
Backend CI `33266599004`, and Storefront CI `33266598957`, including the
Storefront production build, Playwright browser smoke, pa11y, and Lighthouse.
Railway held Storefront deployment
`e089254d-b479-4588-8b46-f13fedaf0529` until all three workflows passed, then
released it to `SUCCESS` on that exact SHA; Backend deployment record
`d445cd56-42b1-47af-8bc1-18838372db22` was correctly `SKIPPED` because no
Backend watch path changed. Storefront `/live`, `/ready`, `/api/healthcheck`,
`/`, and `/catalog` all returned 200. The deterministic
`acceptance_64a2253_completion_01` probe preserved its request ID and trace ID
in the public 400 `application/problem+json` `invalid_query` response. Railway
then emitted exact-SHA, info-level `api.problem` and `http.request.completed`
events with the same request ID, trace ID, method, and corrected status 400.
This completes the correlated API and request-observability slice.

Cache review discovery: Next includes request headers in server-fetch cache
identity. The correlated `/api/news` Backend request therefore uses `no-store`
instead of creating high-cardinality cache entries from request and trace IDs;
uncorrelated page data retains the existing tagged five-minute cache.

Staging observability discovery: exact deployment acceptance for `d28ecec`
proved that the correlated, redacted Storefront `api.problem` event was present,
but Railway mapped the `console.warn` stream to `level:error` even for the
intentional 400 `invalid_query` probe. Expected 4xx problem events now write to
stdout/info so alerting can distinguish client validation traffic from 5xx
failures. The correction was redeployed and Railway now parses the same probe as
`level:info`.

Exact staging acceptance: the foundational observability commit
`d28ecec5d2aa932e39edc600f0fa187a218f8817` passed Root CI `33036915886`,
Backend CI `33036915878`, and Storefront CI `33036915908`; Railway held both
services until all three suites passed, then Backend deployment
`f35f0536-4ad9-4ca1-9b00-9477294ade6a` and Storefront deployment
`6b0fafb0-4824-40ac-b79a-d2012b248cbe` reached `SUCCESS`. Live acceptance
found the 4xx severity issue above. Correction commit
`66064a0e3b5937c0c857a63452d587d4006723fb` then passed Root CI
`33037886660`, Backend CI `33037886752`, and Storefront CI `33037886661`;
Railway again held the release before Backend deployment
`73555e01-1359-4eeb-9eb0-3cc824c210ed` and Storefront deployment
`f7f24ab2-f8b9-4b27-bd4d-d8cfe2e2d834` reached `SUCCESS` on that exact SHA.
Backend `/live`, `/ready`, and `/api/health`; Storefront `/live`, `/ready`, and
`/api/healthcheck`; and Storefront `/` and `/catalog` all returned 200. The
deterministic `acceptance_66064a0_01` probe preserved its request ID and trace
ID across both services, returned a correlated 400 `application/problem+json`
`invalid_query` response, produced an info-level Backend completion event, and
produced a parsed info-level Storefront problem event without URL, query, body,
headers, provider detail, credentials, PII, or stack data. The exact-deployment
error sweep contained only the already tracked successful pnpm command banners,
not application failures. GitHub's two high alerts remain the documented
development-only `extract-zip` alerts `27` and `28` for
`GHSA-jmr9-qjv8-65gv`; no patched version exists and the fail-closed behavioral
verifier remains green.

Final-ledger acceptance: documentation head
`86374df78868c69217bfd96f93dde27dc8aebf2c` passed Root CI `33038755813`,
Backend CI `33038755691`, and Storefront CI `33038755660`, including unit
coverage, both production builds, Admin bundle budget, Playwright, pa11y, and
Lighthouse. Railway released only after those workflows passed; Backend
deployment `e8c87ecb-314e-4bd9-83a6-86926d57e7fe` and Storefront deployment
`8fd3252a-a197-4db4-b918-a268e9a50a40` both reached `SUCCESS` on the exact SHA.
All Backend and Storefront live/readiness/health routes plus Storefront `/` and
`/catalog` returned 200.

Backend envelope discovery: the exhaustive `status(4xx|5xx)` and shared-helper
inventory found only two project handlers still writing direct custom errors:
the legacy public `/key-exchange` route and the Stripe lifecycle webhook.
`/key-exchange` is not used by the current Storefront, which reads its validated
publishable key from environment; external-consumer review remains before
retirement. The webhook now returns 503 for persistence or queue unavailability
so Stripe receives an explicit retry signal, while invalid signatures and
payloads remain safe 400 problems. Native Medusa authentication, RBAC,
validation, and unexpected failures deliberately retain the installed
Dashboard/Admin SDK envelope, with a regression test preventing an accidental
global replacement.

Final error-contract acceptance: documentation head
`d76124cd31e1258725c14d8b928044017de283c3` passed Root CI `33040142472`,
Backend CI `33040142388`, and Storefront CI `33040142439`, including CodeQL,
Trivy, complete tests and coverage, both production builds, Admin bundle budget,
Playwright, pa11y, and Lighthouse. Railway held both services until the three
workflows passed; Backend deployment `5d89d2cc-df5f-43dd-9a77-f513083d5722`
and Storefront deployment `17d99d94-b3b3-44c4-b88d-f1833476a307` then reached
`SUCCESS` on that exact SHA. Backend `/live`, `/ready`, and `/api/health`;
Storefront `/live`, `/ready`, `/api/healthcheck`, `/`, and `/catalog` all
returned 200. A safe `/key-exchange` probe exposed only the expected field,
returned `no-store`, preserved request ID and trace ID, and produced an
info-level completion event. The exact-deployment error sweep contained only
the known successful pnpm/Medusa and `next start` command banners.

## Completed slice: public form write-boundary hardening

- [x] Inventory the browser forms, Storefront BFFs, Backend targets, rate
      limits, proof patterns, Resend adapter, configuration, tests, and docs.
- [x] Add a distinct server-only `PUBLIC_FORM_BFF_SECRET` and deterministic
      Storefront/Backend interoperability fixtures.
- [x] Bind HMAC proofs to version, endpoint purpose, exact serialized body, and
      a 30-second timestamp window; verify with constant-time comparison.
- [x] Preserve a bounded raw body on both Backend routes, share their abuse
      bucket, and fail closed before validation or provider access.
- [x] Add eight-second Storefront-to-Backend cancellation and five-second
      Backend-to-Resend cancellation with provider idempotency keys.
- [x] Treat resolved Resend error objects as failures and map configuration,
      authentication, validation, provider, timeout, and unexpected failures to
      correlated neutral problems without PII or provider diagnostics.
- [x] Add Backend route, proof, middleware, adapter, redaction, and replay tests;
      add Storefront proof, environment, route, timeout, and propagation tests.
- [x] Configure the same generated secret on Backend and Storefront staging
      with Railway deploys skipped; no value was printed or stored in VCS.
- [x] Expand environment templates, READMEs, the QA runbook, problem contract,
      and OpenAPI path enumeration.
- [x] Pass complete local release-policy, lint, strict typecheck, full test,
      coverage, audit, security-regression, production-build, and Admin bundle
      budget gates.
- [x] Commit the cohesive implementation and docs, push `staging`, and accept
      exact GitHub/Railway deployments.

Current local evidence: 171 Backend suites with 919 tests and 112 Storefront
suites with 587 tests pass. Storefront coverage is 93.89% statements, 86.24%
branches, 94.60% functions, and 93.87% lines. Repository policy, private
artifact, framework-header, ESLint, and both strict typecheck gates pass, as do
the production dependency audit (only three documented ignored moderates),
extract-zip containment, React Router backports, OpenAPI parsing, and both
production builds. The Admin main bundle is 1,799,070 gzip bytes and the total
is 2,393,760 gzip bytes, both within budget.

Discovery: the Resend SDK resolves provider HTTP errors as `{ error }` rather
than rejecting, so the previous routes could acknowledge a failed delivery.
Contact had a Backend limiter while privacy did not, and both Backend targets
were callable with only the browser-safe publishable key. The new boundary
closes all three gaps. A Backend-directory pnpm invocation also recreated a
standalone store and lockfile; it was quarantined, the untracked lock removed,
and the workspace restored from the root frozen lockfile with the Medusa patch
verified. All further pnpm commands run through root workspace filters.

Final public-form acceptance: staging head
`c5aab7364e4fa0db1cae0378e00049f5e0cf0d04` passed Root CI `33042203488`,
Backend CI `33042203479`, and Storefront CI `33042203378`, including CodeQL,
Trivy, secret scanning, all tests and coverage, both production builds, the
Admin bundle budget, Playwright, pa11y, and Lighthouse. Railway held both exact
deployments in `WAITING` until all three workflows passed; Backend deployment
`43b52bb3-e273-4a11-ada1-9abc1d6d661d` and Storefront deployment
`bc591bec-a6de-470a-9078-c77aba555940` then reached `SUCCESS`. All eight
Backend/Storefront health and public smoke endpoints returned 200, and
`/key-exchange` retained its safe one-field response. Direct Backend contact
and privacy calls with the browser-safe publishable key but no proof returned
correlated, no-store 401 problems before provider access. Invalid Storefront
contact and privacy bodies returned correlated, no-store 400 problems before
forwarding, so no acceptance email was sent. Backend recorded both expected
401 completions as redacted exact-SHA warning events. The exact-deployment
error sweep was empty for Backend and contained only Storefront's known
successful `$ next start` command banner.

Acceptance discovery: the two Storefront 400 responses preserved their request
and trace context. Follow-up raw-record inspection found the expected event on
exact request ID `storefront-log-repro-ae968321-20260827`: Railway had promoted
the JSON properties to top-level fields and left the display `message` empty,
while the earlier acceptance query searched only the display message. The
event therefore was not lost. Storefront problem logs now include a fixed,
non-sensitive message, and the checked exact-request verifier normalizes both
Railway's promoted Storefront shape and Backend JSON nested inside `message`.
Four fail-closed verifier regressions plus the existing Storefront route-guard
test cover present, absent, mismatched, malformed, and both-shape cases. The
verifier passed against the real ae968 event and its exact SHA, request ID,
trace ID, service, environment, severity, status, event, and problem code.

The documentation-only acceptance head
`ae968321e8854e202e6118eb4df8a7a39109dfea` subsequently passed Root CI
`33043262356`, Backend CI `33043262376`, and Storefront CI `33043262361`.
Railway Backend deployment `9f255efd-e9d5-495a-9782-9570ea409cdf` and
Storefront deployment `e9199859-4369-4e24-97c6-84c873fda73a` reached
`SUCCESS`; all eight health and public smoke endpoints returned 200.

Exact structured-log closure: staging head
`13941ed6bc553bfa3a31dd00b41391a0111c38fb` passed Root CI
`33044631306`, Backend CI `33044631314`, and Storefront CI `33044631336`,
including the new runtime-log regression gate, CodeQL, Trivy, secret scans,
SBOM/license verification, both complete test suites and production builds,
the Admin bundle budget, Playwright, pa11y, and Lighthouse. Railway held
Backend deployment `f1978b37-4464-48be-8341-136b83bf61e8` and Storefront
deployment `bdc001a2-f8a7-480c-905a-d8b73bf77f0f` until all three workflows
passed, then deployed that exact SHA to `SUCCESS`. All eight Backend/Storefront
health and public smoke endpoints returned 200. A deliberately empty contact
body returned a correlated, no-store 400 `invalid_request` problem before any
Backend or email-provider access. The checked verifier found the corresponding
info-level `api.problem` event on exact request ID
`acceptance_13941ed_railway_log_01`, with the expected readable message, SHA,
service, environment, trace, status, and problem fields. The promoted record
contained no path, query, header, body, PII, error, stack, or provider keys.
The exact-deployment warning/error sweep contained only four Backend and one
Storefront known successful command banners.

## Completed slice: checkout reconciliation scheduler-lock hardening

- [x] Recover the exact August 24 and 25 BullMQ repeat-job IDs, scheduled
      timestamps, handler-entry evidence, missing-lock errors, and stalled
      retries from the retained Railway Backend deployment.
- [x] Trace Medusa 2.18 scheduled jobs to the Redis workflow job worker and pin
      the installed BullMQ 5.13 lock, renewal, stalled-check, and retry defaults.
- [x] Measure current staging Redis latency, memory, persistence, connection,
      eviction, error, and latency-event baselines without exposing the Redis
      address or credentials.
- [x] Measure the current PostgreSQL cart predicate with `EXPLAIN ANALYZE` and
      retain the row count, buffer, sort, and execution-time evidence.
- [x] Give only the scheduled-workflow worker a measured five-minute lock with
      a 30-second renewal setting; leave event-bus and primary workflow workers
      unchanged.
- [x] Replace the reconciliation helper's shared-owner five-second lock with a
      unique-owner five-minute lock that cannot release a successor's lock.
- [x] Add bounded scan and run-time configuration, alert on a full scan window,
      and cover an ambiguous post-completion response loss without a second
      completion attempt.
- [x] Emit redacted structured schedule-delay, duration, event-loop, lock-wait,
      lock-release, deployment, run, cap, and aggregate-result telemetry.
- [x] Update the Backend guide, scheduled-job guide, checkout incident runbook,
      completed/discovered work, and remaining release backlog.
- [x] Pass the complete local release gates.
- [x] Commit the implementation and documentation atomically by concern and
      push to `staging`.
- [x] Require Root, Backend, and Storefront CI plus both exact Railway staging
      deployments to reach `SUCCESS`; then verify a real scheduled job record,
      the health/public route matrix, and the exact deployment logs.

Discovery: the two failure paths delayed handler entry by approximately 241
seconds and 35 seconds. Each handler then returned an idle aggregate result,
BullMQ reported its missing 30-second lock, and the job ran again about 30
seconds later. No cart was eligible or attempted in either first/retry pair.
The retained window had no Redis reconnect record. This proves scheduler lock
expiry and stalled recovery, not duplicate payment or order creation.

Discovery: staging currently has 1,306 old incomplete carts matching the base
predicate, while the job always selected the newest 500. The read-only query
plan completes in 1.446 ms from shared buffers, so an index is not justified at
this volume; the correctness risk is silent truncation that can hide an
eligible paid cart. The default bounded window is now 2,000 and reaching it is
an attention event.

First staging acceptance discovery: head
`5c44de36e48434b270e0d8f1a252bfb65cf90671` passed Root CI
`33048089410`, Backend CI `33048089436`, and Storefront CI `33048089558`.
Railway held both releases until those workflows passed, then Backend
deployment `98eb28d7-538a-48c1-9630-1dd06bc91bec` and Storefront deployment
`e3f1579c-82f5-4839-bc36-0fa8a3d545f9` reached `SUCCESS` on the exact SHA.
The first public readiness probes returned 503 while dependencies converged;
15 seconds later Backend database, Redis, search, and object-storage checks and
Storefront Backend/Redis checks were all healthy. This startup interval remains
alerting and deploy-readiness follow-up rather than being hidden by the
less-complete Railway health aliases.

The first real reconciliation record also caught a Medusa Redis scheduler
timestamp defect before this slice was accepted. The job itself safely scanned
1,306 carts in 127.629 ms, found no eligible cart, did no completion work,
released its owned lock, stayed below the scan bound, and logged no failure.
However, Medusa 2.18 supplied BullMQ's enqueue timestamp as `scheduledFor`, so
the record emitted a false 91.296-second scheduler warning. The first
correction added `job.delay`; exact head
`0649fc643ae458dfae3b7d854f14c6c6a7d64427` passed Root CI `33050059796`,
Backend CI `33050059733`, and Storefront CI `33050059770`, and exact Backend
deployment `c1323cac-e6ea-44cc-afeb-c3ecb96974ea` and Storefront deployment
`250f3d2a-2554-4fa2-97e1-40c4bf0acfab` reached `SUCCESS`. All eight smoke
routes returned 200. Its real job safely scanned 1,306 carts in 86.881 ms,
attempted no completion, released its lock, and reported no failure, but still
produced a false 48.474-second warning: BullMQ clears `job.delay` when a repeat
job becomes active and retains the intended execution timestamp in
`job.opts.prevMillis` and the repeat job ID. The final patch now prefers
`prevMillis`, with enqueue time plus delay only as the non-repeat fallback. The
checked verifier fails on either incomplete implementation. Exact CI, Railway,
live-job, smoke, and log acceptance must be repeated before closure.

Final exact staging acceptance: head
`40b2cc06ecd981b61150002a009c327ac0c8679e` passed Root CI
`33051519732`, Backend CI `33051519699`, and Storefront CI `33051519764`,
including the scheduler verifier, CodeQL, Trivy, secret and dependency scans,
complete tests and coverage, both production builds, the Admin bundle budget,
pa11y, Lighthouse, and Playwright. Railway released only after those workflows
passed; Backend deployment `a3c75368-26d1-484f-a3c7-a0c9ea073b21` and
Storefront deployment `69497ac3-6c3f-4a19-b0f0-5d34f7307147` reached
`SUCCESS` on the exact SHA. All eight health/public smoke routes returned 200.
The `08:06 UTC` reconciliation tick emitted an info-level `.completed` event
for its intended `08:06:00.000Z` schedule with 79 ms delay, 159.645 ms total
duration, 21.660 ms maximum event-loop delay, 2.136 ms lock wait, and successful
owned-lock release. It scanned all 1,306 candidates below the 2,000 bound,
found none eligible, attempted/completed/failed zero, and hit no scan, attempt,
or run-time cap. The checked event carried the exact SHA, environment, service,
run ID, and aggregate timing/result contract with none of the prohibited cart,
payment, order, email, address, provider, error, stack, request, credential, or
signature fields. The exact deployments contained zero lock/stall records and
only the four Backend plus one Storefront already tracked successful command
banners at warning/error severity.

Current local evidence: 17 focused tests cover configuration bounds, candidate
safety, time caps, full-window reporting, ambiguous response loss, owned-lock
acquire/release, overlapping retry suppression, redacted failures, timing
alerts, and the workflow-worker lock contract. The complete Backend gate passes
with 173 suites and 926 tests. The Storefront gate passes 112 suites and 587
tests with 93.89% statement, 86.24% branch, 94.60% function, and 93.87% line
coverage. Cross-app lint and strict typecheck, the checked release/security
verifiers, the new delayed-scheduler timestamp verifier, production dependency
audit, both production builds, and the Admin bundle budget pass. The Admin main
bundle is 1,797,919 gzip bytes and total is 2,392,417 gzip bytes. Exact staging
acceptance of the scheduler timestamp correction is complete.

## Completed slice: staging Railway IaC and dependency readiness

- [x] Inventory the committed and effective Railway configuration for every
      staging service without reading or exporting secret values.
- [x] Replace the deprecated per-service `railway.json` files with Railway's
      current TypeScript Infrastructure as Code model before the December 1,
      2026 Config as Code cutoff.
- [x] Scope the stable `applications` partial to Backend and Storefront so a
      Railway beta importer defect cannot rewrite databases, volumes, storage,
      search, or console resources.
- [x] Fail closed outside the exact staging project/environment and provide
      guarded, pinned plan/apply commands.
- [x] Remove Storefront's unpinned `npm i -g pnpm` predeploy and use only the
      repository-pinned pnpm workspace commands.
- [x] Gate both services on dependency-aware `/ready`; reduce Backend's deploy
      window from 720 to 300 seconds and make Storefront's 180 seconds explicit.
- [x] Pin Railway SDK 3.11.0 and CLI 5.45.0; replace CLI's vulnerable
      `tar@6.2.1` with 7.5.22 and verify every supported release archive against
      Railway's immutable SHA-256 asset digest before extraction.
- [x] Add a fail-closed CI verifier for ownership scope, preserved variables,
      application commands, readiness, tool versions, archive digests, and the
      absence of legacy config files.
- [x] Pass the complete local release gate.
- [x] Commit the cohesive infrastructure slice.
- [x] Push only to `staging`; require exact-SHA Root, Backend, and Storefront CI
      plus both Railway deployments, readiness, route, manifest, and log
      acceptance before closing the slice.

Discovery: Railway's legacy Config as Code files are deprecated and stop being
read on December 1, 2026. The live services were explicitly bound to
`/backend/railway.json` and `/storefront/railway.json`; deleting the files alone
would not transfer ownership. The staged migration therefore cleared both
paths in the same environment patch that installed equivalent dashboard
fallbacks. No variable, database, volume, domain, replica, credential, or
support-service field was changed. See Railway's
[Infrastructure as Code guide](https://docs.railway.com/infrastructure-as-code)
and [Config as Code migration guidance](https://docs.railway.com/config-as-code).

Discovery: the generated whole-project import was not idempotent. Its first
plan proposed replacing the existing Redis and PostgreSQL sources and nulling
the Bucket, Meilisearch, and Console builders. None of those changes was
applied. A stable `applications` partial now owns only Backend and Storefront;
the verifier fails if data or support resources enter that ownership boundary.

Migration acceptance: configuration-triggered Backend deployment
`a2dce79a-6e0a-4756-9636-6ad379591abc` and Storefront deployment
`df4d1610-3242-4df7-943e-a61b4b5a73e0` reached `SUCCESS`. The final IaC apply
produced Backend `f12f5c0f-797b-4218-8e9b-349ea9d0b940` and Storefront
`8bc23ef4-34e3-41bb-8c9f-64453736ab89`, both `SUCCESS`. Their effective
manifests contain the exact pnpm build/start commands, no Storefront predeploy,
`/ready`, 300/180-second windows, and `ON_FAILURE` with 10 retries. Railway's
build logs show `/ready` succeeded after 11.34 seconds for Backend and 3.02
seconds for Storefront; all eight health/public probes returned 200 and no
`npm i -g pnpm` record exists.

Discovery: Railway's IaC apply reports the two restart-policy updates as
applied and the effective deployment manifests prove them, but its environment
read model omits those fields. A subsequent plan therefore repeats only those
two already-effective updates. Do not loop the apply solely to clear that
platform phantom drift; retain manifest verification until Railway's plan/read
model converges.

Acceptance discovery: exact-SHA Storefront deployment
`7fabfc0c-affa-4118-9fd1-93d76302b37d` built successfully but failed its
dependency-aware `/ready` gate after 180 seconds. Bounded deploy and network
logs showed repeated Redis connection failures through the public TCP proxy
embedded in the provider's `REDIS_URL`, while Backend already used private
`redis.railway.internal:6379`. Storefront already referenced
`${{Redis.REDIS_URL}}`, but that provider variable itself contained the public
TCP proxy URL. The Storefront contract now composes Redis's referenced user and
password with `${{Redis.RAILWAY_PRIVATE_DOMAIN}}:6379` explicitly. This removes
public service-to-service egress and keeps rotated Redis credentials in sync
without exposing them to source or logs. Corrective source-commit exact-SHA
staging acceptance is recorded below.

Corrective configuration acceptance: the guarded plan contained zero creates,
one intentional private Redis variable change, the two known restart-policy
read-model artifacts, and zero destroys. Change set
`0ef86dac5b309309b01d169b9d94b151` produced Backend deployment
`bc015992-24ba-420f-8310-fde378ed0ea1` and Storefront deployment
`5ede0616-78e6-42ed-b141-c402b202fae0`, both `SUCCESS`. Their `/ready` gates
succeeded after 3.268 and 1.552 seconds respectively. The rendered Storefront
URL is `redis.railway.internal:6379`; network telemetry recorded private
service-to-service Redis flows with no drops. All eight health/public probes
returned 200. Build logs were info-only with no unpinned pnpm bootstrap, and
deploy warning/error levels contained only successful command banners. The
post-apply plan now contains only the two documented phantom restart updates.

CLI/API review: npm, the global binary, and the repository pin all resolve to
Railway CLI 5.45.0, the latest published version on August 27, 2026. The new
`railway api` surface was checked against live introspection and Railway's
[official CLI API guide](https://docs.railway.com/cli/api). Acceptance reads now
use exact project, environment, service, and deployment IDs with bounded JSON
queries instead of account-wide payloads. No Railway Agent/MCP configuration
was installed, no other project was read or changed, and the `store` project
still has only `staging`; production remains absent and untouched. Railway's
[variable guidance](https://docs.railway.com/variables) and
[private-networking recommendation](https://docs.railway.com/overview/best-practices)
support the corrected reference contract.

Supply-chain discovery: Railway CLI 5.45.0's npm wrapper still declared
vulnerable `tar@6.2.1` and downloaded release archives without verifying a
digest. The checked package patch uses `tar@7.5.22`, selects its named ESM
extractor, and verifies the exact official SHA-256 digest for all nine supported
platform archives before extraction. The production audit remains at the three
documented ignored moderates; the CLI's vulnerable tar chain is absent.

Current local evidence: frozen installation and supply-chain policy checks
pass; the pinned, checksum-verified CLI reports 5.45.0 and resolves only
`tar@7.5.22`. Repository lint, both strict typechecks, release/IaC/artifact/
framework/scheduler/runtime-log/extract-zip/React Router verifiers, and the
production audit pass. All 173 Backend suites with 926 tests and all 112
Storefront suites with 587 tests pass; Storefront coverage remains 93.89%
statements, 86.24% branches, 94.60% functions, and 93.87% lines. Both
production builds pass. The Admin main bundle is 1,798,588 gzip bytes and
total JavaScript is 2,393,325 gzip bytes, within the checked budgets.

Final exact staging acceptance: source commit
`362dd3bd58942b2a86b4773dd16095c000cab606` passed Root CI
`33058788745`, Backend CI `33058788794`, and Storefront CI `33058788810`.
Backend deployment `45d31915-876f-43a1-a16c-bca41109e568` and Storefront
deployment `fff6e581-5c99-4a6d-bc49-3348ca5aaa24` reached `SUCCESS` from that
exact SHA. Their effective manifests contain no legacy config file, use the
reviewed pnpm commands, gate on `/ready` for 300/180 seconds, and retain
`ON_FAILURE` with 10 retries. Readiness succeeded after 4.335 seconds for
Backend and 1.691 seconds for Storefront. All eight health/public probes
returned 200. Storefront emitted five private service-to-service Redis flows on
port 6379 with no drops and no connection-error logs. Both build logs were
info-only, contained no `npm i -g pnpm`, and deploy warning/error levels held
only the reviewed successful command banners. Production remained absent and
untouched, and no other Railway project was accessed or changed.

The documentation closure commit
`c138a7e555f9372bbbc11e538730f8b2affcd8b2` subsequently passed Root CI
`33060235931`, Backend CI `33060236032`, and Storefront CI `33060235950`.
Backend deployment `14304b34-8231-4f61-b7ff-932c2dc3b309` and Storefront
deployment `bd5c4687-5093-44cc-8e45-f2c07bd3d3dd` reached `SUCCESS` on that
exact SHA. All eight route probes returned 200. Both builds were info-only and
contained no legacy pnpm bootstrap. Runtime warning/error levels contained
only the four reviewed Backend release commands and Storefront's `next start`
banner, with no Redis connection error. Fourteen exact-deployment Storefront
flows reached the private Redis service on port 6379 with 21 packets, 2,148
bytes, and zero drops.

## Completed slice: supply-chain alert closure and deployment trigger scoping

- [x] Reconcile GitHub's two high Dependabot alerts with the production audit
      and prove alerts `27` and `28` are duplicate manifest/lockfile views of
      the same development-only `GHSA-jmr9-qjv8-65gv` occurrence.
- [x] Trace Pa11y and Lighthouse CI through Puppeteer/Core 24 to
      `@puppeteer/browsers@2.13.2`, while Puppeteer 25 already consumes the
      archive-safe browser-manager 3 line.
- [x] Replace every browser-manager version below 3 with the reviewed 3.0.6
      API-compatible resolution; remove direct `extract-zip@2.0.1`, its local
      patch, and the vulnerable lockfile occurrence.
- [x] Replace the exploit-specific package-patch test with a fail-closed gate
      that proves Pa11y and Lighthouse resolve one browser-manager 3.0.6
      instance, expose every Puppeteer 24 runtime symbol, contain no
      `extract-zip`, and retain blocked browser-download install scripts.
- [x] Raise pull-request dependency review from critical to high severity.
- [x] Add service-specific Railway watch paths with the complete shared pnpm,
      Node, lockfile, workspace-policy, and patch inputs consumed by both
      builds.
- [x] Exercise the real Pa11y and Lighthouse staging runners across `/about`,
      `/accessibility`, `/cookies`, and `/terms` using the external browser.
- [x] Fix the newly exposed Medusa build compiler ambiguity by declaring
      Framework's missing TypeScript 5.9.3 dependency and replace the
      fail-open build chain with a wrapper that removes only generated output,
      compiles, and requires fresh regular-file server artifacts before
      post-build packaging.
- [x] Pass the complete local release gate.
- [x] Commit the cohesive source slice.
- [x] Push only to `staging`; require exact-SHA Root, Backend, Storefront, and
      both current-config Railway deployment acceptance before applying IaC.
- [x] Re-run the guarded Railway plan, require zero creates/deletes, apply only
      the two reviewed watch lists plus known phantom restart fields, and
      accept both exact staging deployments.
- [x] Enable GitHub Dependabot security updates, verify alerts `27` and `28`
      close without dismissal, and document the owned remediation boundary.
- [x] Push the final documentation-only closure, require all exact-SHA GitHub
      checks, and prove Railway marks both application records `SKIPPED`
      without building an image or deploying runtime compute.

Discovery: GitHub currently reports two high alerts, but both identify the
same `extract-zip@2.0.1` development dependency and the production audit has
zero high or critical findings. Upstream still publishes no patched
`extract-zip` release. The installed Puppeteer 24 consumers use only runtime
exports preserved by `@puppeteer/browsers@3.0.6`; Node 26 can load that ESM
package through Puppeteer's CommonJS path. The frozen offline install now
resolves one v3 browser manager and no `extract-zip`. The replacement verifier,
Pa11y WCAG2AA audits, and Lighthouse assertions all pass on the four reviewed
staging routes. The first local browser launch correctly failed because this
host disables Chromium user namespaces; the documented CI no-sandbox mode
then passed without changing application data.

The first complete Backend gate exposed a separate fail-open build defect:
`@medusajs/framework@2.18.0` uses the TypeScript compiler without declaring it,
resolved the unrelated TypeScript 7 version shim introduced through Pa11y's
Cosmiconfig chain, logged a missing compiler API exception, and still returned
success before the old command packaged stale `.medusa` output. The package
extension now gives Framework the complete TypeScript 5.9.3 compiler directly.
The build wrapper removes only the ignored generated `.medusa` directory,
requires a zero-status compiler plus fresh non-symlink server artifacts, and
only then runs the existing hardened post-build packager. A dedicated fast
gate verifies both the declared dependency and the compiler API at Framework's
actual resolution boundary.

Final local validation: the frozen install and supply-chain policy accepted
1,961 lockfile entries with no peer issue. Root release, IaC, browser-manager,
Medusa compiler, private-artifact, framework-header, scheduler, runtime-log,
and React Router gates pass. The production audit retains only the three
documented ignored moderates and reports zero high/critical findings; Trivy
reports zero high/critical vulnerability, secret, or misconfiguration finding.
Backend ESLint, all 173 suites/926 tests, and the fresh Medusa/Admin production
build pass without a compiler exception. Storefront ESLint, strict typecheck,
all 112 suites/587 tests, and its 53-route production build pass at 93.89%
statements, 86.24% branches, 94.60% functions, and 93.87% lines. Pa11y and
Lighthouse pass the four reviewed staging routes, and the mobile Chrome audit
passes all 17 routes at both Pixel 7 and 320-pixel compact-phone viewports.

Railway's official monorepo contract defines watch paths as gitignore-style
deployment triggers. The guarded staging plan contains zero creates, four
changes, and zero destroys: Backend and Storefront receive their own workspace
path plus `/.nvmrc`, `/package.json`, `/pnpm-lock.yaml`,
`/pnpm-workspace.yaml`, and `/patches/**`; the other two changes are the known
read-model-only restart-policy drift. Documentation and IaC source are not
runtime build inputs. IaC changes must be applied explicitly through the exact
staging wrapper after CI, while documentation-only pushes must not spend two
application rebuilds.

Exact source acceptance: staging SHA
`a41e21a0d2ab37c5545d81958a50f6ec3528a4b9` passed Root CI `33063172516`,
Backend CI `33063172420`, and Storefront CI `33063172427`. Railway held
Backend deployment `32d54a4f-35ae-4953-a504-ad24a5fa3510` and Storefront
deployment `b59d66c1-418b-4703-8d56-dc64367e6a19` until those checks passed;
both then reached `SUCCESS`. The current-config manifests retained empty watch
lists as expected. All 207 Backend and 186 Storefront build log entries were
info-level, the missing TypeScript API exception and legacy pnpm bootstrap were
absent, and all eight public route probes returned 200. The Storefront
deployment emitted eight exact private Redis flows with 17 packets, 1,804
bytes, and zero drops.

Exact IaC acceptance: the reviewed `0 add / 4 change / 0 destroy` plan applied
only patch
`iac-change-set/799a2f98-f819-495d-b8b6-12e71af86568/a2286fed3ab815ac1c562169134799de`.
Backend deployment `4fdcf364-5fb4-4e8c-9f93-508d70b5c1e8` and Storefront
deployment `6c4eccb0-f9bb-49af-aa15-17ee6eee16b9` reached `SUCCESS` with the
exact service-specific watch lists, effective `ON_FAILURE`/10 restart policy,
empty file manifests, and accepted source SHA. Their 108 and 177 build log
entries were info-only with no banned build pattern. All eight routes returned
200, and the exact Storefront deployment emitted three private Redis flows
with 11 packets, 1,288 bytes, and zero drops. The post-apply plan is `0 add / 2
change / 0 destroy`; only the documented restart-policy readback defect
remains. No production environment exists, and no other Railway project was
accessed or changed.

GitHub marked Dependabot alerts `27` and `28` `fixed` at
`2026-08-27T10:28:22Z`; neither has a dismissal timestamp or reason. Automated
security fixes are enabled and unpaused, and the repository has zero open
high-severity Dependabot alerts.

Documentation-only acceptance: closure SHA
`0a4cbf7935d3f7286e6f484cadc329eab987f13d` passed Root CI `33064867989`,
Backend CI `33064868030`, and Storefront CI `33064868073`. Railway created
Backend record `85eefa81-b2c7-4707-8455-77138b405d95` and Storefront record
`5d7349e4-a24f-42c3-829e-0e83406e8374` as terminal `SKIPPED` metadata. Neither
record has an image digest or IaC patch, and neither service entered build,
deploy, or runtime release. This is Railway's exact watch-path contract: an
ignored commit remains visible for audit but spends no application build or
runtime compute.

## Completed slice: runtime secrets and server-only search configuration

- [x] Run a names-only staging preflight against the exact Backend and
      Storefront services without printing secret values.
- [x] Add production startup policies that require distinct, non-placeholder
      JWT, cookie, cart, checkout, receipt, public-form, and configured webhook
      secrets of at least 32 UTF-8 bytes.
- [x] Add bounded prior-key verification for checkout/public-form BFF proofs
      and 30-minute receipt grants; retain current-key-only signing.
- [x] Remove Meilisearch host/key data from the public client environment,
      CSP, image allowlist, and browser bundles; isolate search configuration
      in a server-only module with a migration fallback.
- [x] Extend staging IaC with the server-only search-host reference and optional
      prior-key slots, and remove persistent Admin email/password from normal
      Backend runtime.
- [x] Correct the missed Backend and Storefront dependency-review thresholds;
      all three workflows must reject high-severity pull-request additions.
- [x] Pass focused and complete local lint, typecheck, test, security, build,
      and client-bundle secret scans.
- [x] Push the initial expand commit only to `staging`; record the Storefront
      startup-policy failure caught by browser CI before Railway deployment.
- [x] Land the corrective CI-runtime fixture commit; accept all three exact-SHA
      workflows and the Backend source deployment.
- [x] Land the search expand-order correction; accept its exact-SHA workflows
      and the Storefront source deployment before changing staging variables.
- [x] Apply only the reviewed staging variable migration after a guarded
      zero-create/zero-service-destroy plan; accept both exact deployments.
- [x] Remove the legacy `NEXT_PUBLIC_MEILI_*` fallback and Railway variables,
      then repeat exact-SHA CI, deployment, route, log, and search acceptance.

Discovery: the staging names-only validator found no missing, weak, or reused
current application secret and confirmed the two Stripe webhook keys are
distinct. It also proved `MEDUSA_ADMIN_EMAIL`/`MEDUSA_ADMIN_PASSWORD` persisted
in normal Backend runtime, while Storefront search had no server-only host/key
pair and depended on the two legacy public-prefixed values. The existing
server-only `MEILISEARCH_API_KEY` can remain the search-only credential; the
expand phase references Backend's host without copying a secret. A second
workflow audit found that the earlier dependency-review change covered Root
CI only: Backend and Storefront still used the critical threshold. This slice
corrects all three measured gaps.

Local acceptance on August 27, 2026: `pnpm run qa:lint` passed every release,
IaC, supply-chain, response-header, scheduler, runtime-log, ESLint, and
typecheck gate. Backend passed 174 suites / 935 tests; its complete coverage
run measured 66.1% statements and 52.22% branches across the application
(there is no configured global Backend threshold), while every changed secret
and prior-key path has direct tests. Storefront passed 114 files / 599 tests at
94% statements and 86.3% branches. Both builds passed with distinct synthetic
validation-only secrets, and the Storefront post-build scanner proved 127
static assets contained neither a server-only secret value nor either legacy
public Meilisearch input name. `pnpm audit --audit-level=high` found no high or
critical issue; the three reported advisories are the existing policy-ignored
moderate findings.

CI discovery on August 27, 2026: initial expand SHA
`4914622c12a3425ab4f930cd0dcf3a8683fc4d3c` passed Root CI `33067736606` and
Backend CI `33067736623`, while Storefront CI `33067736598` correctly failed
its Lighthouse, Playwright, and Pa11y jobs before deployment. Each production
server launch rejected the omitted CI-only runtime values with
`CART_COOKIE_SECRET must contain at least 32 UTF-8 bytes`; the ordinary build
job remained green because the workflow explicitly builds under
`NODE_ENV=test`. The correction supplies distinct non-production runtime
fixtures at workflow scope so `next start` exercises the startup policy and
the existing post-build scanner proves those exact values never enter client
assets. No Railway configuration was applied after the failed gate.

Deployment discovery on August 27, 2026: corrective SHA
`774ea98e20a6065010cc2203676d29583c6040bf` passed Root CI `33068850778`,
Backend CI `33068850761`, and Storefront CI `33068850768`, including the three
corrected browser jobs. Railway Backend source deployment
`570acede-db52-42f8-a7c8-ac341e1fb44c` then succeeded on that exact SHA and
passed `/live`, `/ready`, and `/health`; readiness reported database, Redis,
search, and object storage healthy, and the zero-downtime search rebuild
validated all 461 published products. Storefront source deployment
`a4f538e9-9051-4d9f-a22b-dc66bd35ecef` failed safely during build without
replacing the running release: staging's intentionally preserved
`MEILISEARCH_API_KEY` made the migration code select the preferred pair before
`MEILISEARCH_HOST` had been applied. The correction makes the new host the
explicit expand-phase switch, retains the complete legacy pair until that
point, and still rejects invalid or incomplete host-enabled configuration.
The correction passed all 5 focused search-environment tests and lint. A local
build with variables injected read-only from the exact Storefront staging
service generated all 53 routes and proved all 127 static assets contained no
server-only secret or legacy public Meilisearch input name.

Search correction acceptance on August 29, 2026: SHA
`4ec7389a74326e6712799ad4102d08e93ae04bc5` passed Root CI `33070509096`,
Backend CI `33070509146`, and Storefront CI `33070509077`, including Pa11y,
Lighthouse, Playwright, strict typecheck, and the client-bundle scan. Railway
correctly skipped the unchanged Backend source and deployed Storefront record
`085674e4-357f-4d91-b34e-de3961dbe500` from that exact SHA. The deployment
generated 53 routes, scanned 127 client assets, and reached `SUCCESS`; its
runtime became ready in 148 ms. Backend `/live`, `/ready`, and `/health`, plus
Storefront `/live`, `/ready`, `/api/healthcheck`, `/`, and `/catalog`, all
returned HTTP 200. The server-only search POST returned HTTP 200 with one hit
and total count seven for its bounded acceptance query.

Deployment-safety SHA `3e87cff062a5834925e9699ce0fff1ea11fd3a05`
passed Root CI `33250497334`, Backend CI `33250497329`, and Storefront CI
`33250497325`, including the complete browser, accessibility, security,
coverage, build, SBOM, and license gates. Railway correctly created Backend
record `fa7b7e08-9065-4a7a-a4de-b97b6d01450b` and Storefront record
`0f4019dd-0a5d-4008-9806-3c5fe28b5ad9` as terminal `SKIPPED` metadata with no
image digest or application compute because the commit touched only docs and
deployment tooling.

Expand apply acceptance on August 29, 2026: the exact-ID wrapper supplied both
`--yes` and `--confirm-destructive` after the reviewed plan again showed zero
creates, three updates, and exactly two variable deletes. IaC patch
`d93b7b54ce8ec96b42045a225d3a3909` removed persistent
`Backend.MEDUSA_ADMIN_EMAIL` and `Backend.MEDUSA_ADMIN_PASSWORD`, added the
Storefront `MEILISEARCH_HOST` reference, and reasserted the two known
restart-policy readback entries. Names-and-predicates-only verification proved
the maintenance credentials absent; all current Backend and Storefront
application secrets remained present, distinct within each service, and at
least 32 UTF-8 bytes; both prior-key slots remained intentionally unset; and
the complete preferred and legacy search pairs remained present for the
expand window.

Backend deployment `e0e3718d-5f3d-4b27-8847-c0794a068e1a` and Storefront
deployment `4967d9d6-0d82-4286-ba7f-fa3fb295c4d4` reached `SUCCESS` on that
exact patch. Both 1,000-record build-log windows had zero warning/error-level
records and used pnpm; Storefront compiled 53 routes and passed its client-
asset scan. Backend became ready and rebuilt all 461 published search records;
its four Railway error-level runtime entries were command banners with no
failure/exception terms. Storefront's only error-level runtime entry was its
known `$ next start` banner. The eight established health/route probes plus
the `/products` redirect returned HTTP 200, and the trusted-origin server-only
search POST returned HTTP 200 with one hit and total count seven.

Contract local evidence: all five focused search-environment tests
pass, including rejection of the retired public pair when server-only values
are absent. The complete repository lint, strict Storefront and Backend
typechecks, and guarded IaC verifier pass. All 114 Storefront test files and
600 tests pass at 93.98% statement and 86.42% branch coverage. A production
build with synthetic server-only values compiled all 53 routes; the deliberately
unroutable synthetic search host exercised the catalog's Medusa fallback, and
the post-build scanner proved all 127 client assets contain neither a server-
only secret value nor either retired public input name. The high-severity audit
passes with only the three existing policy-ignored moderate findings. The
reviewed post-contract plan has zero creates, two updates, and exactly the two
expected legacy-variable deletes.

Contract source acceptance on August 29, 2026: SHA
`3b7a48408b5cf419bc37672317c8d6f627816b8e` passed Root CI `33251365470`,
Backend CI `33251365476`, and Storefront CI `33251365478`, including the
complete browser, accessibility, security, coverage, build, SBOM, and license
gates. Railway correctly created Backend record
`6ea50fc2-2ed0-4511-8759-f60e6bcf1326` as terminal `SKIPPED` metadata and
deployed Storefront record `a8cf8f67-d40a-442f-b13c-dd644d5a0fb7` from the
exact SHA. The Storefront build compiled all 53 routes, verified all 127 client
assets, exported image
`sha256:b5a76366e56366d5202e7d865c9f5913b897d2c7faacb63964ca0393f1ddced4`,
and reached `SUCCESS` with zero build warning/error entries. Its runtime became
ready with no unknown warning, error, failure, exception, fatal, panic, or
stack terms. Before variable deletion, all nine health/route probes and the
trusted-origin search acceptance returned HTTP 200; search returned one hit
and total count seven.

Contract apply acceptance on August 29, 2026: the exact-ID wrapper rechecked a
zero-create/two-update/two-delete plan, then patch
`79108384bf02424580607893ed02f623` deleted only
`Storefront.NEXT_PUBLIC_MEILI_HOST` and
`Storefront.NEXT_PUBLIC_MEILI_SEARCH_KEY` and reasserted the known restart-
policy readback entries. Names-and-predicates-only verification proved both
retired variables absent, the server-only host/key present, all required
current Backend and Storefront secrets present, non-placeholder, distinct
within each service, and at least 32 UTF-8 bytes, the two maintenance
credentials absent, and the two Backend prior-key slots intentionally unset.

Backend deployment `ae4838b9-808e-46f2-9f6d-ddde0598d937` and Storefront
deployment `ffd4c174-4b28-4bcc-8905-5998aaa94fcf` reached `SUCCESS` on the
exact patch and source SHA, with images
`sha256:e6e8bf0b5845e21b9ba08d0f0187e6a1d3d34e79c6cced765b18b79a412b8b51`
and
`sha256:f118fa62772348259407d2ba59546c8d1304dccef9cf5cf02f92bb2e37fc3c1d`.
Backend's 203-record and Storefront's 1,000-record build-log windows contained
zero warning/error entries, used pnpm, and exported their images; Storefront
again compiled all 53 routes and verified all 127 client assets. Backend's
309-record and Storefront's six-record runtime windows contained zero warning,
error, or suspicious failure terms. Backend became ready, rebuilt search, and
reported all 461 published products; Storefront became ready. All nine health,
route, and redirect probes again returned HTTP 200, and the trusted-origin
search returned HTTP 200 with one hit and total count seven. The post-apply
plan is `0 add / 2 change / 0 destroy`; only Railway's documented restart-
policy readback defect remains, so it was not reapplied. No production
environment or other Railway project was accessed or changed.

Documentation closure SHA
`40b5a3a5777677dd4af49e3dba091f4b9bcc9c7d` passed Root CI `33252304079`,
Backend CI `33252304111`, and Storefront CI `33252304036`. Railway created
Backend record `d73afd1b-5cbc-45d8-b556-026062dbd512` and Storefront record
`4ce5cd3d-d264-4289-9621-a8cbc051e225` as terminal `SKIPPED` metadata with no
image digest or IaC patch. Neither service entered build, deploy, or runtime
release.

## Completed slice: public catalog read-boundary hardening

- [x] Inventory native Medusa Store Product filtering and every custom public
      helper that reads Product records.
- [x] Add one bounded visibility helper that requires a publishable-key sales
      channel, filters published Products, and preserves requested ordering.
- [x] Apply the shared boundary to bundle, shelf, discography, related-product,
      and product-handle responses; vary their cacheable responses by key.
- [x] Replace the Backend's unbounded all-Product handle route with opaque
      100-row keyset pages.
- [x] Switch sitemap and catalog fallback callers to the keyset feed with an
      eight-second page deadline and explicit 5,000/1,000 ceilings.
- [x] Cap search pages at 60 results, the visible result window at 1,000, and
      non-index post-filter work at 2,048 raw hits; apply the same result-window
      contract to the Medusa fallback route.
- [x] Add Backend route, helper, source-inventory, cursor, and hidden-bundle
      identifier regressions; document its public visibility rule and feed.
- [x] Add Storefront fallback and search regressions; document both public
      contracts in OpenAPI and the Storefront README.
- [x] Pass complete repository lint, strict typecheck, Backend tests,
      Storefront coverage, dependency/security checks, and production builds.
- [x] Commit and accept the Backend expand phase on exact `staging` GitHub and
      Railway evidence before committing the Storefront consumer phase.
- [x] Commit and accept the Storefront phase on exact `staging` GitHub and
      Railway evidence before another hardening slice.

Discovery: Medusa 2.18's native Store Product route already injects
`published` status and the publishable key's sales-channel link. Five custom
routes bypassed that native query boundary: the handle feed offset-scanned the
entire Product module, related Products scanned 1,000 unscoped records, and the
bundle, shelf, and discography helpers did not consistently require both
publication and channel membership. Search also accepted an unbounded offset
and could perform repeated application-side post-filter batches. The Backend
expand phase closes the custom visibility gaps without changing native Store
API behavior; the ordered Storefront phase adds the explicit work ceilings.
Final route review found that an out-of-channel
bundle component could still expose its stored Product, Variant, inventory, or
SKU identifiers after its hydrated Product details were removed. Bundle
availability now queries only variants belonging to visible component Products
and emits no hidden component identifiers; a direct route regression pins that
redaction. Final Storefront review also found that bounded post-filter search
could advertise a page beyond offset 1,000 or a non-advancing page when its
2,048-hit raw-work budget found no visible match. `hasMore` now requires an
advancing page within the accepted result window, and direct regressions cover
both boundaries. Storefront also rejects a non-base64url Backend cursor before
following it.

Local candidate evidence: repository policy, IaC, private-artifact, framework-
header, scheduler, runtime-log, ESLint, and both strict typecheck gates pass.
All 180 Backend suites / 952 tests and 114 Storefront files / 605 tests pass;
Storefront coverage is 93.82% statements, 86.35% branches, 94.65% functions,
and 93.80% lines. Both production builds pass, the Storefront scanner found no
server-only value or retired public search input in 127 static assets, and the
Admin main/total gzip bundles remain within budget at 1,798,512/2,393,648
bytes. The production audit reports only the three policy-ignored moderates;
Trivy reports zero high/critical findings; changed-source Gitleaks is clean;
and the generated SBOM/license pair verifies 1,321 components, 1,322
dependency nodes, 1,004 packages, and 16 license groups.

Rollout discovery: the local Storefront production build safely rejected the
currently deployed legacy handle-feed response and completed with an empty
fallback, but that would transiently omit sitemap/fallback Products if the
Storefront deployed first. This slice therefore uses an explicit expand order:
deploy and accept the backward-compatible Backend route before committing the
Storefront consumer.

Backend expand acceptance: exact SHA
`707d50e2a37dac3613a9d185b91aa2ed5112e1bc` passed Root CI `33253902478`,
Backend CI `33253902418`, and Storefront CI `33253902385`, including build,
coverage, Playwright, accessibility, and Lighthouse gates. Railway correctly
skipped unchanged Storefront record `861ee38f-cf20-4703-b478-12cd17e926a5`
and released Backend record `00819624-47ee-4a84-9862-f1559191e695` as
`SUCCESS` with image digest
`sha256:3d38f2cb27815bd326836d4c6113fc2b09b572847a61852ebf7add3735840b3c`.
Its 196-line build log contained zero warning/error entries. Runtime contained
no failure markers, secrets, or HTTP 5xx responses; Railway classified four
successful startup command echoes as errors, and the only warning was the
intentional invalid-cursor 400 acceptance probe.

Backend `/live`, `/ready`, and `/api/health` returned HTTP 200. Two bounded
two-record handle pages returned HTTP 200 with opaque cursors, no overlap, the
required publishable-key `Vary`, and exact agreement with the native Store
visibility boundary. An invalid cursor returned a safe HTTP 400. Shelves,
discography, related Products, and bundle routes returned HTTP 200 for a visible
Product. The exact Storefront `/live`, `/ready`, `/api/healthcheck`, root, and
catalog routes remained HTTP 200; `/products` retained its intentional HTTP
308 redirect to `/catalog`.

Storefront consumer acceptance: exact SHA
`ab51f7b6a8447fed0d476bde7f3af56c4826cf3d` passed Root CI `33255244572`,
Backend CI `33255244570`, and Storefront CI `33255244584`. The gates included
audits, release-policy and Railway-IaC checks, Gitleaks, TruffleHog, CodeQL,
Trivy, lint, strict typecheck, all 605 Storefront tests with coverage, the
production build, Playwright, Pa11y, and Lighthouse. Railway correctly skipped
unchanged Backend record `febe21da-e524-4502-b78c-9834366a2135` and released
Storefront record `f6174e16-f972-4f73-a4d2-51a7bd0f23c8` as `SUCCESS` with
image digest
`sha256:abe993862e646bc07d578bf4234825e64105f75415fdf3635d88d86d32d8ae29`.

The Storefront's 196-line build log was entirely info-level. Four messages
contained failure terms only because the Railway build sandbox could not
resolve the runtime-only private Meilisearch hostname; the intentional Medusa
fallback completed and the image exported successfully. Runtime became ready
in 69 milliseconds. Its six-line startup log contained five info records and
one Railway error-level classification for the successful literal
`$ next start` command echo. The exact deployment had zero HTTP 5xx records,
and no runtime warning, exception, failed operation, secret, or stack leak was
observed.

Storefront `/live`, `/ready`, `/api/healthcheck`, root, catalog, and sitemap
returned HTTP 200; `/products` retained its intentional HTTP 308 redirect to
`/catalog`. Security headers included nonce-based CSP, HSTS, `nosniff`, frame
denial, strict referrer policy, and a bounded permissions policy. Dynamic page
responses remained private/no-store, API responses were no-store, and the
sitemap retained public revalidation semantics.

The fallback endpoint returned 60 of 461 visible Products at its maximum page
size and rejected a 61-row page plus a result window beyond 1,000 with HTTP 400
Problem Details. Search returned 24 of 461 visible Products, rejected the same
page/window violations and an inverted price range with HTTP 400 Problem
Details, and returned zero hits with `hasMore: false` at offset 999. The live
handle feed completed in five bounded pages with 461 unique Product IDs. The
sitemap contained 476 unique URLs: all 461 feed Products plus 15 static routes,
with zero missing feed URLs or duplicates. No production environment or other
Railway project was accessed or changed.

## Completed catalog authorization work

- [x] Replace or disable the native Dashboard import drawer path that begins
      with the intentionally disabled presigned-upload endpoint.
- [x] Route destructive catalog changes through audited, idempotent,
      version-checked workflows.
- [x] Prefer archive or quarantine over hard deletion where recovery is
      required.

The pinned Dashboard commit
`4d6e313dc726a2baf53a18a9c76bd8c5ba8899a3` removes the unsupported
Product Import actions and route from source, CommonJS, and ESM artifacts. The
catalog boundary commit `98d128320885c76dc037dfbe03fed5efc43d5abe`
removes Product and Variant delete actions from the same shipped artifact set.
The server independently rejects native Product, Variant, Collection,
Category, Option, Option-value, Tag, and Type hard deletion after the exact
native policy check. Direct custom artist, reference-value, Product-profile,
Variant-profile, and Product-media deletion uses the same private 409 Problem
Details contract. Audited/versioned bundle mutation, shelf archive/restore,
media quarantine/restore, and non-destructive inventory unlinking remain
available.

Exact-SHA staging acceptance passed on August 29, 2026:

- Root CI `33269499815`, Backend CI `33269499853`, and Storefront CI
  `33269499816` completed successfully, including security scans, CodeQL,
  secret scans, coverage, production builds, SBOM/license inventory,
  Playwright, accessibility, and Lighthouse.
- Railway Backend deployment `db3e7d9c-44a4-4986-8d66-3b231fb16d90`
  and Storefront deployment `8829ffdd-adc4-485f-8960-7c772067f10b`
  reached `SUCCESS` on the exact source SHA. Their image digests are
  `sha256:6afa7f10f137ac6d22840b8381f6aa79990a0403ea70d30d992c07b6f2ae0e26`
  and
  `sha256:cbd6f0aa9cd78154ff0da5f070053fc8e0c67cef036fff9604e6613fb9978191`.
- Backend `/live`, `/ready`, and `/health`; Storefront `/live`, `/ready`,
  `/api/healthcheck`, `/`, and `/catalog` all returned HTTP 200.
- Two read-only acceptance runs used an in-memory, ten-minute staging token
  derived from one existing actor and role link. Each run proved
  authentication precedes the blocker with a 401, then received thirteen
  private, no-store 409 Problem Details responses using guaranteed-nonexistent
  identifiers. No catalog row or persistent credential was created, changed,
  or deleted.
- Exact Backend HTTP logs contained two DELETE 401 responses, twenty-six
  DELETE 409 responses, and zero 5xx responses. Runtime logs contained the
  matching twenty-six `catalog_hard_deletion_disabled` completion records with
  exact commit SHA, request, trace, status, and problem fields. The remaining
  warning/error-level records were those intentional 4xx completions and four
  pnpm command banners; no exception, fatal, failed-operation, or stack term
  appeared. Storefront's only error-level record was its known `$ next start`
  banner. Both 1,000-record build-log scans had zero warning/error records and
  zero failure terms.
- A headful Brave session rendered the exact staging Product list and opened a
  row action menu. Export and Create remained visible, Import was absent, and
  the menu contained Edit without Delete. The result was inspected in a real
  Flameshot desktop capture at
  `/tmp/remorseless-catalog-deletion-after-98d1283.png` and a clean browser
  capture at
  `/tmp/remorseless-catalog-deletion-after-98d1283-browser.png`; the Wayland
  monitor selector produced a full-desktop capture, so the separate browser
  image retained the focused review artifact.

## Checkout, payment, refund, and job reliability

- [x] Diagnose the recurring BullMQ `Missing lock ... moveToFinished` failures
      for `reconcile-checkout-payments` observed on August 24 and 25, 2026.
- [x] Measure retained scheduler delay/recovery plus current Redis latency,
      reconnect-log, AOF, memory, eviction, and PostgreSQL predicate baselines
      before tuning the scheduled-workflow lock.
- [x] Observe the accepted structured job duration, event-loop delay,
      lock-wait/release, scan, and cap fields in staging.
- [ ] Add external BullMQ/Redis alerts and retain a no-recurrence observation
      window for the hardened scheduler.
- [x] Prove every scheduled money-moving job is idempotent and stalled-job
      recovery cannot duplicate a charge, completion, order, refund, or email.
- [x] Configure a separate staging Stripe lifecycle webhook secret and the
      `/webhooks/stripe/lifecycle` endpoint.
- [x] Exercise signed, duplicate, delayed, out-of-order, queue-failed, refund,
      repeated-partial-refund, and dispute events.
- [x] Prove in code that an ambiguous response loss after durable cart/order
      completion is re-read and does not make a second completion attempt.
- [x] Exercise the same response-loss recovery against a disposable Stripe
      test-mode checkout in staging and verify one PaymentIntent and one order.
- [x] Complete the exact-amount, success, 3DS, decline, browser-close,
      response-loss, duplicate-submit, concurrency, and recovery matrix in
      `docs/CHECKOUT_OPERATIONS.md`.
- [x] Verify confirmation email, receipt, Medusa order, Stripe PaymentIntent,
      and tax evidence agree.
- [x] Complete the refund and dispute reconciliation matrix in
      `docs/REFUND_OPERATIONS.md`.
- [ ] Keep all payment traffic in Stripe test mode until a separate production
      change is approved.

Local matrix closure passed on September 1, 2026 at application commit
`a8b7bd2a647cdf560f41a90e0b1b31426cf697dc`:

- The audit found and fixed one cross-feature correctness defect: evidence for
  a completed checkout with `collection_mode=disabled` and no provider was
  correctly reconciled by the tax ledger but Refund Operations labeled it
  **Not linked yet**. It now has explicit `disabled` / `not_collected`
  contracts, can reach **Verified** when Medusa and Stripe agree, and renders
  **Tax collection off** / **Tax not collected** without waiting for a tax
  provider reversal that must not exist.
- A new root `qa:commerce-reliability` contract binds 36 checkout/refund
  objectives to exact executable assertions and retained test-mode evidence.
  Root CI runs it independently, while `qa:checkout-recovery` continues to
  inspect installed Medusa 2.18 cart/payment locks, order-link guards, row
  locks, and provider idempotency keys.
- The focused Storefront checkout slice passed 24 files / 210 tests. The
  focused Backend checkout/refund/lifecycle/tax slice passed 16 suites / 171
  tests. The full Backend suite passed 273 suites / 2,051 tests. Storefront
  coverage passed 137 baseline files / 818 tests and 36 transactional files /
  321 tests; baseline coverage was 94.25% statements, 86.65% branches, 96.03%
  functions, and 94.25% lines.
- Repository QA, Biome format/check, both strict typechecks, both production
  builds, the client-bundle secret scan, and the production dependency audit
  passed. The Storefront build used the same distinct non-secret runtime
  fixtures as CI and deliberately unavailable provider endpoints; the bounded
  build fallbacks completed without copying server secrets into 130 static
  assets.
- The matrix combines deterministic branch coverage with the retained July 25
  and August 29/30 Stripe test-mode exercises. It does not create a redundant
  irreversible sandbox refund merely to repeat full, failed, canceled, or
  provider-specific branches, and it authorizes no production payment,
  refund, tax, email, or traffic change.

Exact-SHA staging acceptance passed on August 29, 2026 at
`77fd8f954ceba4cc0755f31447d8e3831bccc445`:

- Root CI `33271841421`, Backend CI `33271841358`, and Storefront CI
  `33271841347` completed successfully. The Root gate verified the installed
  Medusa 2.18 cart lock, order-link and authorization guards, capture/refund row
  locks and provider idempotency keys, notification uniqueness/failure retry,
  Resend 6.18 request-option forwarding, the durable scheduled-attempt marker,
  and the absence of Stripe mutations in lifecycle/tax reconciliation.
- Deterministic Backend coverage proved marker-before-completion ordering,
  fail-closed response loss during marker persistence, a held stalled attempt,
  one completion after a lost completion response, stale lifecycle receipt
  eligibility, terminal receipt replay, and stable Medusa/Resend order/refund
  email keys. The full local Backend suite passed 1,007 tests; Storefront
  coverage remained 93.09% statements and 85.77% branches.
- Railway Backend deployment `3cf7c5b8-1355-44a3-b987-3e622585504a`
  and Storefront deployment `a9747006-0ec3-4f81-8bbf-c8950967bf93`
  reached `SUCCESS` on the exact source SHA. Their image digests are
  `sha256:d810154c7d0dbe940fb288308ff44948916aa9abb41b5c021c34d301ab4d9525`
  and
  `sha256:8917823d6365fb2241b27dcc385f189f0a32616d036787aea50968cf26b85d0f`.
- Backend `/live`, `/ready`, and `/health`; Storefront `/live`, `/ready`,
  `/api/healthcheck`, `/`, and `/catalog` all returned HTTP 200 from those exact
  deployment IDs.
- The exact Backend deployment's `20:06:00Z` reconciliation tick scanned all
  797 candidates in 87.697 ms with 44 ms scheduler delay and 23.871 ms maximum
  event-loop delay. Eligible, attempted, completed, protected, failed, and
  `heldForReview` counts were zero; all caps were false and the owned lock was
  released. The run therefore exercised the deployed recovery boundary without
  creating an order, payment, refund, or email.
- Both 1,000-record build-log scans contained only info records and zero
  failure terms. Runtime scans found zero warning and zero
  exception/fatal/unhandled/failed-operation terms. Railway classified four
  Backend startup command banners and the known Storefront `next start` banner
  as error-level records; no operational failure or 5xx health response was
  present.

No disposable payment or provider email was created for this acceptance. Those
state-changing sandbox exercises remain separately tracked below; this item
closes the code, retry, installed-runtime, and zero-side-effect scheduled-run
proof only.

External scheduler-alert acceptance began on August 29, 2026 at exact source
SHA `151f635374adc0d0bdf337ccdf90876d1f2dbce4`:

- Root CI `33274362389`, Backend CI `33274362391`, and Storefront CI
  `33274362399` completed successfully, including CodeQL, vulnerability,
  secret, image, dependency, test, coverage, build, accessibility, browser,
  and Lighthouse gates.
- Railway Backend deployment `55c29958-ae9d-482d-af33-6371d1ec6ec6` and
  Storefront deployment `605b9555-2d09-4e93-ade8-0773d9da0f87` reached
  `SUCCESS` on that exact SHA. Their image digests are
  `sha256:c7123d950ac40241916740fd54012d1814f6ee244bf2e327ecc5c5f71960ffd2`
  and
  `sha256:c1264b40ff97c030715ebffaed96777cce6a405c74797053a2611c6ffa5d4e38`.
  Backend `/live`, `/ready`, and `/api/health`; Storefront `/live`, `/ready`,
  `/api/healthcheck`, and `/` returned HTTP 200.
- The first exact-release reconciliation tick started at `21:02:00.053Z`,
  scanned all 797 candidates, and completed in 94.505 ms with 53 ms scheduler
  delay and 20.087 ms maximum event-loop delay. It found zero eligible,
  attempted, completed, protected, failed, or held-for-review carts and
  released its owned lock after a 2.263 ms wait.
- The public scheduler health evaluator returned HTTP 200 at
  `21:02:31.708Z`, Redis `ok`, no incident latch, and a 31.484-second-old
  completed heartbeat carrying the exact source SHA. The endpoint and the
  independent evaluator both enforce a ten-minute heartbeat maximum and reject
  invalid, future, stale, replayed, or unavailable state.
- Forced-alert workflow run `33275028434` intentionally failed after fetching
  and redacting the healthy response, opened deduplicated issue `#3`, and
  retained artifact `staging-scheduler-observation-33275028434` through
  September 28. Healthy recovery run `33275062236` then succeeded, closed issue
  `#3` at `21:03:45Z`, and retained its independent redacted artifact for the
  same 30-day policy.

The 24-hour no-recurrence window therefore runs through
`2026-08-30T21:03:45Z`. The external workflow polls every ten minutes, retains
daily/manual/alert evidence, and will reopen the exact issue on Redis failure,
missing or stale heartbeat, incident latch, invalid response, or source error.
The checklist item remains open until that full window completes without an
unrecovered alert or scheduler incident.

Staging Stripe lifecycle configuration acceptance passed on August 29, 2026
at exact source SHA `bbb1b53922ef8552fdefd6ad7e815959488bda83`:

- Root CI `33275559472`, Backend CI `33275559473`, and Storefront CI
  `33275559492` completed successfully, including security scans, CodeQL,
  tests, coverage, production builds, Playwright, accessibility, and
  Lighthouse. The guarded Railway plan remained `0 add / 2 known phantom
updates / 0 destroy`.
- The `.railway/**` source change correctly produced skipped Backend deployment
  `ff98811e-5d18-4320-969d-34b63988ff4c` and skipped Storefront deployment
  `08d57abe-2450-4b1a-84a1-cb7c99b5b035`, with no image build. The subsequent
  secret-only Backend deployment `dd996c4d-236b-4446-a4db-b9654a6e2b13`
  reached `SUCCESS` on the exact SHA with image digest
  `sha256:01ae9b0efc54782ef4cea3afe972e2ce4cbfce803781638ce37a45d1c6a001e7`.
- Stripe test endpoint `we_1U9tacIM4tTeFQ3WAAK3i2cD` is enabled with
  `livemode: false` and only the three refund plus five dispute event types in
  the committed allowlist. Its one-time endpoint secret was streamed directly
  into Railway, is `whsec_`-formatted, and is distinct from Medusa's official
  Stripe webhook secret; no secret value was printed or persisted locally.
- Backend `/live` and `/ready` returned HTTP 200. An unsigned lifecycle request
  returned the expected 400 `invalid_webhook`; a correctly signed unsupported
  event returned HTTP 200 with `received: true` and `ignored: true`. Exact
  runtime logs retained the correlated 400/200 records with commit, request,
  trace, and span fields and no payload, signature, or secret.
- The ignored-event smoke returned before resolving the payment-lifecycle
  service, so it created no receipt and made no Stripe, payment, refund, order,
  tax, email, or ledger mutation. The first subsequent scheduler heartbeat at
  `21:32:00.221Z` carried the exact SHA, Redis `ok`, and no incident latch.

No production environment, credential, endpoint, object, or traffic was
accessed or changed.

Staging Stripe lifecycle event acceptance passed on August 29, 2026 across
exact source SHAs `6813b79e68e4b3c90555faf5f93e7476d8d24d7e` and
`1413aabbe009729c5f10f6d35b3e38d8f34108f5`:

- Signed delivery of four genuine refund events exposed that Stripe's Refund
  retrieval can omit `livemode`. The fail-closed integrity check retained each
  receipt as retryable instead of processing unverifiable state. Fix
  `6813b79e68e4b3c90555faf5f93e7476d8d24d7e` now compares the retrieved mode
  when Stripe supplies it and still rejects a present non-boolean or incorrect
  value. Root CI `33277187996`, Backend CI `33277187994`, and Storefront CI
  `33277187990` passed; Railway Backend deployment
  `cc73a3fa-2304-4f3f-800d-d9d662919016` reached `SUCCESS` with image digest
  `sha256:9e58ee1869b97ce24e46269ac8f0d031fc9ff63f4016fa1adad2ea0bac9d7532`.
  `/live` and `/ready` returned HTTP 200.
- Genuine dispute delivery then exposed Stripe's canonical `du_` dispute ID
  prefix. Fix `1413aabbe009729c5f10f6d35b3e38d8f34108f5` accepts exact `du_`
  identifiers while rejecting the incorrect legacy `dp_` shape. Root CI
  `33278061101`, Backend CI `33278061100`, and Storefront CI `33278061110`
  passed; Railway Backend deployment
  `c897667d-3d19-47e5-bd89-abca20563e10` reached `SUCCESS` with image digest
  `sha256:25b55b29008ed36d13c5beb621515a4a23ede43cc48599842b662cc009187bca`.
  `/ready` returned HTTP 200 with PostgreSQL, Redis, search, and object storage
  healthy.
- The disposable refund PaymentIntent
  `pi_3U9u2sIM4tTeFQ3W0Ep3Xz1Q` succeeded for 900 USD minor units in Stripe
  test mode. Partial refunds `re_3U9u2sIM4tTeFQ3W0YIBrxcI` and
  `re_3U9u2sIM4tTeFQ3W0Jh6fKuG` succeeded for 200 and 300 minor units. The four
  genuine `refund.created`/`refund.updated` receipts recovered from the
  integrity failure and reconciled on attempt five after signed replay. This
  proves repeated partial refunds without issuing a duplicate refund.
- A signed synthetic `refund.updated` receipt arrived 7,201 seconds late. Its
  exact duplicate returned `replayed: true` and retained one durable receipt.
  A newer `refund.updated` event with 63 seconds of delay was delivered before
  an older `refund.created` event with 3,603 seconds of delay; both reconciled
  current Stripe state independently and reached the same terminal result.
- The route's deterministic queue-unavailable test returned HTTP 503 only
  after persisting `event_bus_unavailable`. A guarded, transactional staging
  drill then placed only the synthetic delayed receipt in that retryable state.
  The `22:30:00Z` five-minute reconciliation pass claimed it once, advanced
  the attempt count from one to two, cleared the error and retry timestamp,
  and restored the expected terminal result. No retryable receipt remained.
- A separate disposable 700-minor-unit Stripe test PaymentIntent
  `pi_3U9uRhIM4tTeFQ3W1B0RcExZ` produced dispute
  `du_1U9uRhIM4tTeFQ3WuxqeRa3T`. Genuine `charge.dispute.created` and
  `charge.dispute.funds_withdrawn` events reconciled on attempt one against
  current `needs_response` state. Both PaymentIntents had no customer, and no
  order or email was created.
- The final bounded database matrix contains nine unique receipts: seven
  refund and two dispute receipts. All are terminal `ignored`, with zero linked
  orders, errors, scheduled retries, or retryable statuses. Every receipt
  records `tax_evidence_not_found` and `tax_association_status: not_tracked`,
  which is the expected result because these direct provider fixtures had no
  Medusa order or tax evidence. Apart from the explicitly described Stripe
  test fixtures and lifecycle receipts, the processor made no Stripe, payment,
  refund, order, tax, email, or ledger mutation.
- The two exact runtime acceptance windows contained no error-level log record
  and no webhook secret, signature, client secret, or raw-body term. Correlated
  lifecycle logs contained only internal receipt IDs, evidence presence, and
  terminal status. No production environment, credential, endpoint, object,
  funds, or traffic was accessed or changed.

Staging Stripe checkout response-loss acceptance passed on August 29, 2026
across exact source SHAs `409e89bfd11f067ade62816f3eaf8f302dc5e232`
and `0d618af0bce550d148270bb6aa6abb4babddf896`:

- The first disposable-cart attempt exposed two exact integration defects
  before payment confirmation. Fix `409e89bfd11f067ade62816f3eaf8f302dc5e232`
  removes transient shipping-method row IDs from the tax quote fingerprint so
  unchanged shipping selections converge while option and monetary changes
  still invalidate the quote. Root CI `33279930550`, Backend CI `33279930548`,
  and Storefront CI `33279930547` passed. Railway Backend deployment
  `d77235e8-1b73-483a-95be-ca9e82262d15` reached `SUCCESS` with image digest
  `sha256:0611fe8ddaeb9f47ffda45c1f819f74245daf99282690c14cd42ad58be6dbb7a`.
- The resumed cart then proved that the secure tax-binding graph requested a
  decorated cart total without selecting the item, shipping, adjustment, and
  credit-line monetary inputs required by Medusa's totals decorator. Fix
  `0d618af0bce550d148270bb6aa6abb4babddf896` loads those bounded fields and
  covers the projection with a regression test. Root CI `33281103509`, Backend
  CI `33281103513`, and Storefront CI `33281103455` passed, including security,
  CodeQL, test, coverage, build, Playwright, accessibility, and Lighthouse
  gates. Railway Backend deployment
  `d42bbaff-5a29-461d-9448-1df325bad8fc` reached `SUCCESS` on the exact SHA with
  image digest
  `sha256:53fedbae36d04176f04a5c67cea2d7eeab47a8ebb98cee1a0fd7acc4a7ddf0e1`.
  `/ready` returned HTTP 200 with PostgreSQL, Redis, search, and object storage
  healthy.
- The isolated acceptance reused cart `cart_01M17VG4Y63NGSVQ4QJ7SYM810` and
  its existing payment session; it did not create a replacement cart or
  PaymentIntent. Tax binding and cart completion returned HTTP 200 on the exact
  deployment. The fault proxy discarded the first successful 200 completion
  response after the upstream body was durable, and the Storefront performed
  one authoritative status read, received HTTP 200, and recovered the
  confirmed order without a second completion attempt.
- Stripe test PaymentIntent `pi_3U9vTxIM4tTeFQ3W0LA4YDWp` succeeded for 653
  USD minor units and has exactly one charge. PostgreSQL links the cart to
  exactly one order, `order_01M17YCNVVSE5G4BFYYYDCJPFA` / display ID `6`, and
  contains exactly one payment collection, one payment session, one payment,
  and one capture. The collection is `completed`; the payment and capture each
  retain the same 6.5325 USD high-precision Medusa amount, whose currency-minor
  rounding is 653. The single line retains quantity one and one 8.875% tax
  line.
- The ad hoc runner's final strict JavaScript decimal equality assertion
  rejected the receipt after the order was already durable, so no checkout
  retry was made. An independently signed receipt-grant read returned HTTP 200
  and confirmed the expected email, one item, order number `6`, USD currency,
  and 6.5325 total. Provider and database checks then established the one-
  PaymentIntent, one-charge, one-order, and one-capture postcondition directly.
  The three temporary acceptance processes were stopped and their local
  scripts were moved to the desktop trash after evidence collection.
- All provider operations used Stripe test mode (`livemode: false`). No
  production environment, credential, endpoint, object, funds, or traffic was
  accessed or changed.

Staging confirmation-message reconciliation passed on August 30, 2026 at
exact source SHA `68a0b40639219898f6c6f8588a1f61fe9f736984`:

- The response-loss order's notification failed at the provider boundary
  because its diagnostic recipient used the reserved `example.com` domain.
  The replacement acceptance used Resend's documented delivered test fixture,
  with a tagged local part, so it exercised provider delivery without sending
  customer mail.
- The audit also found that the order template rendered Medusa's raw 6.5325
  USD amount and supplied a placeholder reply-to. The exact-SHA fix routes
  order and refund amounts through one validated `Intl.NumberFormat` boundary,
  rejects malformed monetary template data, and removes the placeholder
  reply-to. Focused tests cover the high-precision total, item price, invalid
  values, and rendered order message.
- Local Backend lint, strict typecheck, 191-suite / 1,028-test run, production
  Medusa/Admin build, repository QA, and Storefront 119-file / 633-test
  pre-push suite passed. Root CI `33282614902`, Backend CI `33282614910`, and
  Storefront CI `33282614879` completed successfully, including security,
  CodeQL, coverage, production build, Playwright, accessibility, and
  Lighthouse gates.
- Railway Backend deployment `4a326c2f-2d09-43b5-8f9f-6599c9dfa4ff`
  reached `SUCCESS` on the exact SHA with image digest
  `sha256:5f61681f3f241f201113c2bd578499c6e2fd5b060e9f5b843576c897d4859321`.
  `/ready` returned HTTP 200 with PostgreSQL, Redis, search, and object storage
  healthy. The unchanged Storefront deployment
  `c38fffbf-6399-4e15-85d4-220bbefcfbc1` was correctly skipped by its watch
  paths.
- The one-shot acceptance created cart
  `cart_01M180TWFHX4JZHNR9GQ5RBS8P`, test PaymentIntent
  `pi_3U9wXnIM4tTeFQ3W1kprrCFD`, and order
  `order_01M180V5BWYSRCFYMP672Y98F2` / display ID `7`. Stripe reported
  `livemode: false`, 653 USD minor units, exactly one PaymentIntent, and
  exactly one charge. The signed receipt returned the same order number,
  currency, cent-rounded total, and one item.
- PostgreSQL contains exactly one order-cart link, payment collection, payment
  session, payment, capture, and successful idempotent order notification. The
  order and notification payload retain the authoritative 6.5325 USD raw
  total. The single 8.875% tax line and one generation-one `taxrate_io`
  evidence row retain 653 minor units, `succeeded` status, matching cart,
  order, and PaymentIntent references, and linked/verified timestamps.
- Resend retained one message with a provider external ID and terminal
  `delivered` state. Normalized rendered content contained `Total: $6.53` and
  the `$1.00` item price, omitted `6.5325 usd`, and had no reply-to. The exact
  Backend deployment returned HTTP 200 for both observed tax-link requests and
  the single cart-completion request, then logged one successful
  `order-placed` send to one recipient.
- The temporary one-shot harness was moved to the desktop trash after evidence
  collection. No production commerce environment, Stripe object, funds,
  customer recipient, or traffic was accessed or changed.

## Tax readiness

- [x] Default new and untouched tax controls to audited disabled mode, expose
      environment availability separately from provider readiness, disable
      unavailable choices in Admin, and repeat the configuration guard at the
      locked backend transition boundary.
- [x] Show a prominent fail-closed banner when an active provider becomes
      unavailable and a safe off-state banner when neither provider is
      configured; distinguish **Unavailable**, **Needs setup**, and **Ready**.

Local configuration-safety acceptance passed on September 1, 2026. Five
focused suites contain 39 passing readiness, transition, initialization,
Admin contract, and UI-state tests. The complete Backend contains 273 passing
suites / 2,057 tests with 91.61% statement, 85.31% branch, 95.78% function,
and 91.61% line coverage. Root Biome/policy/typecheck gates, both Storefront
coverage matrices, the Backend/Admin production build, and all 12 rendered
Admin accessibility cases pass. A real headful browser plus desktop screenshot
verified both unavailable provider cards, named environment-variable guidance,
disabled provider and metered-refresh actions, the safe off-state banner, and
the keyboard-reachable readiness refresh with zero Axe or layout findings. No
provider call, checkout, payment, refund, tax transaction, or production state
was created or changed during this local acceptance.

Exact staging acceptance for default-off revision
`f4edb6b924c5bac03d95c33ea9f165772d7ac3d0` passed Root CI
`33495704000`, Backend CI `33495703926`, and Storefront CI `33495703912`.
Railway Backend deployment `c0189b38-c283-46be-8a58-1452a25f51c8`
succeeded with image digest
`sha256:95dea6c3210367ab032d887cf78383230ed18eaea5ff9258369b707d1cf19d3c`.
Its release phase applied `Migration20260901100000` successfully. The
unchanged Storefront event `36cd6501-d87a-485c-b8d5-05a25bbd8b3c` correctly
reported `SKIPPED` because no watched source changed.

Backend `/live`, `/ready`, and `/api/health`, plus Storefront `/live`,
`/ready`, `/api/healthcheck`, `/`, and `/catalog`, returned HTTP 200. The
current Backend emitted successful checkout-reconciliation heartbeats for the
exact SHA, with the latest observed run scanning 64 candidates and completing
with zero eligible, attempted, failed, held-for-review, capped, or
unreleased-lock state. Scheduler and aggregate operations health returned 503
solely for the authoritative `scheduler_incident_latched` reason from prior
revision `039600387dd7ebafdd5093ed9574faddf92cbca1`; dependencies, retention,
operational incidents, Redis availability, and the current heartbeat were
healthy. The latch remains untouched until its 24-hour observation window
expires.

A bounded exact-deployment review found 210 informational build records, 352
runtime records, and 38 HTTP records. Railway retried one transient build
service-availability response before the successful build; the sole
error-level runtime record was the successful release-prepare command banner.
The HTTP records contained 32 successful responses and the six expected
scheduler/operations 503 responses caused only by the retained latch. No
application build, migration, startup, scheduler, or request failure appeared.

Deterministic tax golden-matrix hardening now binds 17 named objectives to
executable tests and an independent Root CI contract. Provider mapping covers
`tax.golden.taxable`, `tax.golden.nontaxable`, `tax.golden.mixed`,
`tax.golden.shipping_taxed`, `tax.golden.discounted`, and
`tax.discount.adjusted_minor_units`; raw Stripe Tax and TaxRate.io response
validation, quote-only comparison, disabled no-provider behavior, the three-way
amount invariant, committed sale transactions, `tax.refund.partial_reversal`,
`tax.refund.full_reversal`, per-refund reversals, and filing projection are also
required. The matrix uses validated provider response fixtures and creates no
external provider object or customer payment. The tax-control runbook now
separates this deterministic release gate from the disposable sandbox
procedure, specifies privacy-safe retained evidence, and preserves every
approval, test-mode, metered-lookup, and production boundary. The filing-record
and tax-control runbooks were audited against the current Connecticut DRS, New
York Tax Department, Pennsylvania Department of Revenue/code, Stripe, and
Medusa primary references on September 1, 2026; the Root contract now prevents
their purpose, jurisdiction, quality, disabled-mode, export, filing, retention,
or limitation sections from being silently removed. External sandbox evidence
remains open until the controlled state-changing exercise is run.

Local deterministic-matrix acceptance passed on September 1, 2026. Seven
focused suites cover provider boundaries, quote mapping, adjustment, binding,
transaction, reversal, and filing projection with 103 passing tests. The
complete Backend contains 273 passing suites / 2,064 tests with 91.61%
statement, 85.31% branch, 95.78% function, and 91.61% line coverage. Repository
QA (including the new
`qa:tax-golden-matrix` contract), Biome format/check, both strict typechecks,
and the Backend/Admin production build pass. Storefront source did not change;
its immediately preceding 137-file / 818-test baseline and 36-file / 321-test
transactional coverage gates remain the accepted local evidence.

- [x] Add a durable `collect` / `disabled` tax collection mode separate from
      the selected provider, using an expand-only migration and preserving the
      current provider for later re-enablement.
- [x] Serialize and audit mode/provider transitions with expected generation,
      idempotency, actor, reason, prior/next state, and an explicit versioned
      acknowledgement for disabling collection.
- [x] Emit one controlled zero-rate line per item and shipping subject in
      disabled mode, freeze the decision by generation and fingerprint, and
      prove the path makes zero TaxRate.io, Stripe Tax, or quota calls.
- [x] Extend Storefront quote parsing, Stripe PaymentIntent metadata, payment
      validation/binding, evidence, lifecycle reconciliation, tax reporting,
      CSV exports, refunds, and disputes to distinguish explicit disabled mode
      from a provider-calculated zero or missing legacy evidence.
- [x] Preserve every prepared checkout and completed order across disable,
      re-enable, and provider changes; require selected-provider readiness
      before collection can be re-enabled.
- [x] Rework Tax Control around the plain-language collection decision, with
      permission checks, readiness, impact preview, typed acknowledgement,
      reason, error focus, response-loss reconciliation, and immutable history.
- [x] Show `Tax not collected` for an explicit disabled quote in checkout and
      customer records without describing the order as legally exempt.
- [x] Complete the disabled-mode unit, integration, concurrency, payment,
      refund, reporting, no-provider-call, browser, accessibility, and real
      desktop screenshot matrix defined by ADR 0007.
- [x] Update tax-control, filing, checkout, refund, support, incident, rollback,
      and client procedures for disabled and re-enabled collection.
- [ ] Obtain business approval and qualified tax advice for provider choice,
      registrations, product tax codes, shipping treatment, filing ownership,
      disabled-mode use, and Stripe Tax pricing.
- [ ] Run the sandbox golden matrix across taxable, non-taxable, mixed,
      shipping-taxed, discounted, refunded, and partially refunded orders.
- [ ] Prove the Medusa/Stripe/provider three-way amount invariant and tax
      transaction/reversal evidence.
- [ ] Compare representative Stripe Tax results with TaxRate.io without
      charging customers.
- [x] Add reviewed TaxRate.io response bounds: total percentages must be finite
      and within 0%–100%; malformed, negative, and larger totals fail closed,
      while invalid optional jurisdiction components are discarded.
- [x] Bound Stripe Tax readiness settings and registration safe reads under one
      shared deadline, disable nested SDK retries, validate the complete
      response shape and key/account mode, and redact terminal errors and retry
      telemetry.
- [x] Bound Stripe payment-intent, calculation, and tax-hook operations under
      one shared deadline, disable nested SDK retries, preserve one idempotency
      key across update attempts, validate the complete binding acknowledgement,
      and redact terminal errors and retry telemetry.
- [x] Bound Stripe payment-evidence and refund/dispute lifecycle safe reads
      under one shared deadline, cache the expanded PaymentIntent per lifecycle
      run, disable nested SDK retries, validate complete provider response
      shapes before persistence, and redact terminal errors and retry telemetry.
- [x] Validate tax cache TTLs and entry ceilings at startup; purge expired
      entries on writes, apply deterministic least-recently-used eviction, and
      rate-limit key-free capacity telemetry.
- [ ] Configure a reviewed monitoring ZIP before enabling paid quota probes.
- [x] Complete the filing-record and tax-control runbooks and bind their
      required operating, filing, retention, limitation, and official-reference
      sections to the tax golden-matrix Root contract.
- [ ] Request separate approval before live registrations or a production tax
      provider change.

## Application and API security

- [x] Replace Storefront production `script-src 'unsafe-inline'` with a
      nonce/hash policy; set `base-uri 'none'` and evaluate Trusted Types.
- [x] Remove unused sample S3 and direct Unsplash browser origins from the
      production allowlist; permit only exact HTTPS `images.unsplash.com`
      through the same-origin Next Image optimizer for version-controlled seed
      data.
- [x] Add global Backend/Admin HSTS, CSP, `nosniff`, frame, referrer,
      permissions, and cache headers.
- [x] Run Trusted Types in report-only mode across Storefront navigation and
      checkout, collect privacy-bounded reports, remove dependency-owned sinks,
      and define an exact-URL Stripe policy with source and bundle contracts.
- [ ] Enforce Trusted Types only after the staging browser matrix and reviewed
      report-only observation window show no unexplained sink.
- [x] Add App Router `error.tsx` and `global-error.tsx` boundaries with safe,
      observable recovery UX.
- [x] Validate strong, distinct JWT, cookie, cart, checkout-BFF, receipt,
      public-form, and configured webhook secrets at production startup.
- [ ] Complete the live JWT/session-invalidating and official Medusa Stripe
      webhook rotation drills. Cart, checkout-BFF, receipt, public-form, and
      lifecycle-webhook prior-key verification is implemented and bounded;
      lifecycle startup also rejects a reused prior key.
- [x] Remove persistent bootstrap Admin credentials from normal Backend
      runtime.
- [x] Move all generic abuse controls to Redis-backed atomic rate limits.
- [x] Trust client IP headers only behind a documented Railway proxy boundary.
- [x] Remove User-Agent from the cart rate-limit identity.
- [x] Protect Backend contact and privacy routes with shared limiting, bounded
      email timeouts, neutral responses, and purpose-bound BFF authentication.
- [ ] Persist privacy requests in a protected audit store if required by the
      approved retention policy.
- [x] Cap search offset and total work.
- [x] Rename Meilisearch host/search-key inputs to server-only variables and
      remove them from browser configuration and client bundles.
- [ ] Remove any public Meilisearch domain if exact service inspection finds
      one; browser-direct search is not part of the accepted architecture.
      The 2026-08-31 Railway inspection found the active
      `meilisearch-staging-d201.up.railway.app` service domain, so removal is an
      explicit staging environment change rather than an unverified code item.
- [x] Replace the all-product handles scan with bounded keyset pagination,
      published-status filtering, and publishable-key sales-channel filtering.
- [x] Verify every public helper applies published-status and publishable-key
      sales-channel boundaries.
- [x] Add outbound deadlines, cancellation, bounded retries, and redacted
      provider errors for content, search, email, Stripe, tax, storage,
      contact, and privacy calls. Contact/privacy Backend and Resend deadlines
      are complete. Storefront news, discography, merchandising-shelf,
      product-handle, Meilisearch, and correlated or cached Medusa Store reads
      now also use shared two-attempt boundaries under one deadline. Search
      owns retries at its semantic read-operation boundary so catalog loaders
      cannot multiply attempts. TaxRate.io safe GETs now use two attempts under
      one deadline with coded errors and retry telemetry; 429 and other 4xx
      responses do not retry because lookups are metered. Stripe Tax quote
      creation/retrieval now shares one deadline, uses the SDK's canceling fetch
      transport, disables nested SDK retries, allows one transient retry,
      validates the calculation and at most 100 line items, and emits only
      coded terminal errors and retry telemetry. Stripe Tax readiness now reads
      settings and active registrations concurrently under one shared
      deadline, disables nested SDK retries, permits only one bounded transient
      retry per safe GET, rejects rate-limit retries and incomplete pagination,
      strictly validates settings and registrations, and emits only fixed retry
      metadata. Stripe payment binding now retrieves the PaymentIntent and
      calculation concurrently and performs the tax-hook update under one
      shared deadline, disables nested SDK retries, preserves one idempotency
      key across bounded update retries, rejects rate-limit retries, strictly
      validates identity, amount, currency, mode, metadata, status, calculation,
      hook, and update acknowledgement, and emits only fixed retry metadata.
      Stripe evidence and lifecycle processing now shares one eight-second
      deadline across the current refund/dispute, cached expanded PaymentIntent,
      optional Tax association, and bounded refund-page safe reads. Nested SDK
      retries are disabled, each eligible transient GET can retry once, rate
      limits remain single-attempt, response shapes are validated before
      persistence, and retry/error telemetry cannot copy provider payloads. The
      Stripe order annotation now shares one eight-second deadline, disables
      nested SDK retries, preserves idempotency keys across one eligible
      transient retry, rejects rate-limit retries, validates exact returned
      annotations, and emits only fixed retry metadata. The pinned Medusa S3
      adapter now aborts requests and streams, limits SDK attempts, redacts
      provider failures, and propagates delete failures for compensation.
      Unused SendGrid support was removed after staging proved Resend is the
      sole configured email provider, closing the remaining project-owned
      provider families.
- [x] Harden malformed cookie decoding so invalid percent encoding cannot throw
      outside the parser boundary.
- [x] Make browser query persistence opt-in. Only explicitly declared public
      product-detail and catalog-definition queries can reach the new bounded
      cache; free-form search, cart, checkout, receipt, and mutation data do
      not opt in, and the former default-on cache key is removed on startup.

## Upload and media hardening

- [x] Decode and re-encode uploaded images in a sandboxed pipeline.
- [x] Cap dimensions, total pixels, frame count, decompressed size, input size,
      and processing time.
- [x] Strip metadata and quarantine/scan files before immutable public storage.
- [x] Define managed-media quarantine retention and an audited purge policy.
- [x] Verify migrated media no longer depends on Big Cartel URLs.
- [x] Complete the managed-media and discography cutover evidence required by
      `docs/adr/0005-managed-media-and-discography-rebuild.md`.

The 2026-08-30 media boundary is documented in
`docs/MEDIA_SECURITY.md`. Catalog and News images now pass fast signature
validation and then a separate Linux `prlimit`/Node-permission/Sharp process.
The worker deeply decodes a single bounded frame, rejects warnings and MIME
mismatches, auto-orients, emits metadata-free WebP, and independently reopens
the result before any File Module write. Per-image input, dimensions, pixels,
channels, estimated decoded bytes, output bytes, CPU, wall time, descriptors,
and worker output are bounded; failure is closed. Catalog assets retain source
and normalized checksums plus pipeline evidence, while logs contain only route
class, result, timing, counts, and byte totals. The Big Cartel probe/stager uses
the same pipeline and rejects version-1 state.

Quarantine remains actor-audited, version checked, unlinked-only, reversible,
and retained for at least 30 days. Physical purge remains deliberately
unavailable: eligibility is only a review date. The documented future purge
gate requires an off-site checksum/restore drill, exact dry-run manifest,
independent review, explicit apply confirmation, linkage/version recheck,
durable operation audit/tombstone, holds, and idempotent provider
reconciliation. The Big Cartel zero-reference and discography cutover evidence
were accepted read-only against staging on 2026-08-30. The hardened
managed-media inventory found zero Big Cartel sources across native Products,
Catalog assets, artists, Variant profiles, and News. Its empty-source
fingerprint was `e3b0c44298fc`. The discography planner reported 442 current
active entries, 442 projected music releases, zero unpublished profiles, zero
creates, updates, or archives, and 20 correctly excluded non-music profiles.
Both commands explicitly reported that no files or database records changed.

## Infrastructure, data protection, and recovery

- [ ] Design and obtain approval for the Railway production environment,
      domains, services, capacity, and cost before provisioning it.
- [ ] Replace the Backend PostgreSQL superuser connection with a least-privilege
      runtime role and a separate migration/DDL role.
- [x] Require TLS for every non-private database connection.
- [x] Move Storefront Redis to the Railway private service reference and prove
      exact-deployment port-6379 service flows complete without drops.
- [ ] Remove public Redis and PostgreSQL TCP proxies unless a reviewed,
      encrypted administrative path requires them.
- [ ] Put MinIO Console behind private access/SSO or remove its public domain.
- [ ] Configure PostgreSQL backups/PITR and perform a timed restore drill.
- [ ] Configure off-site media backup and verify object checksums and restores.
- [x] Document Redis recovery semantics and Meilisearch rebuild/snapshot
      recovery.
- [ ] Set and test a capacity-aware Redis memory ceiling and compatible
      persistence/eviction policy; staging currently reports `maxmemory=0` and
      `noeviction` with zero evictions and zero server latency events.
- [ ] Pin Redis, PostgreSQL, MinIO, and Meilisearch images by tested version and
      immutable digest; remove floating `latest` tags.
- [ ] Enable `pg_stat_statements`, slow-query logging, I/O timing, and relevant
      database/volume metrics with an overhead budget.
- [x] Define availability, latency, recovery-time, and recovery-point goals
      before adding replicas, PgBouncer, overlap/draining, or paid monitoring.
- [x] Gate Backend Railway releases on `/ready` rather than the less-complete
      `/api/health` alias after migration and dependency startup budgets are
      measured; keep `/live` as the liveness-only signal.
- [x] Reduce the Backend 720-second deploy health timeout after startup and
      migration behavior is measured.
- [ ] Replace the temporary `applications` partial with a clean whole-project
      import after Railway's beta importer can represent the existing database
      and support-service sources idempotently.
- [ ] Remove the restart-policy phantom drift after Railway's IaC read model
      returns the settings already present in effective deployment manifests.
- [x] Apply and accept service-specific Railway watch paths.
- [x] Prove a documentation-only staging push triggers no application
      rebuild.

The local infrastructure/recovery control plane is now documented in
`docs/INFRASTRUCTURE_RECOVERY.md`. Application startup and standalone database
tools share one fail-closed URL policy: Railway private networking or local
loopback is accepted, while every other host must require TLS. The read-only
role auditor rejects the default `postgres` identity, superuser, database/role
creation, replication, RLS bypass, and read/write-all membership outside the
reviewed backup profile; it also verifies actual TLS negotiation for public
transport.

Release preparation now isolates `db:migrate` and `db:sync-links` behind the
optional `DATABASE_MIGRATION_URL` before returning to `DATABASE_URL` for
runtime storage and search readiness. `DATABASE_ROLE_SPLIT_REQUIRED=true`
fails closed unless the two URLs are distinct. Enforcement remains off until
staging roles and grants are created and accepted; the superuser-removal item
therefore remains open.

Portable PostgreSQL protection now has credential-safe, no-shell tooling. The
backup command emits a custom-format `0600` archive plus SHA-256 manifest after
`pg_restore --list` verification. Restore defaults to dry-run, rejects
non-canonical/symlink inputs, checksum drift, the source service, and non-empty
targets, and requires the dry-run target fingerprint before applying to a
disposable database. Railway volume schedules/PITR and an off-site media target
still require controlled environment changes and timed drills, so those items
remain open rather than being closed on documentation alone.

The same runbook defines launch objectives, a 70% Redis memory ceiling with
`noeviction` plus AOF-every-second durability, authoritative-source recovery,
Meilisearch snapshot/dump/rebuild semantics, current staging public exposure,
floating support images, and the exact production cost/domain approval packet.

## GitHub, CI, supply chain, and test depth

- [x] Protect `staging` and `master` according to the release runbook; require
      pull requests and conversation resolution on `master`, and block
      force-push/delete on both long-lived branches.
- [ ] Consolidate duplicate GitHub deployment environments and add environment
      protection rules for production.
- [x] Enable Dependabot security updates or document an equivalent owned
      remediation SLA.
- [x] Complete exact-SHA CI acceptance for the six remediated active CodeQL
      alerts; the stranded legacy search-analysis alert is evidence-dismissed.
- [x] Mitigate `GHSA-jmr9-qjv8-65gv` in `extract-zip` with fail-closed symlink
      containment, a malicious-archive regression gate, and explicit denial of
      Puppeteer browser-download install scripts.
- [x] Remove the local `extract-zip` patch and vulnerable package version by
      consolidating Pa11y/Lighthouse on the reviewed browser-manager 3 API,
      without losing accessibility or performance coverage.
- [x] Run Storefront build, Playwright, accessibility, and Lighthouse jobs on
      every `master` release pull request and every long-lived branch push.
- [x] Run Chromium, Firefox, and WebKit for critical home, catalog, product,
      cart, checkout, and receipt paths; upload failure artifacts. Customer
      authentication is intentionally absent from this guest-only Storefront.
- [x] Expand Storefront coverage to cart, checkout, BFF routes, components, and
      critical user flows instead of measuring only the current narrow include
      set.
- [x] Raise Redis client branch/function coverage from the current low level.
- [x] Add Backend coverage enforcement of at least 80% for core and critical
      paths.
- [x] Add disposable PostgreSQL/Redis integration, migration, API-contract,
      payment failure/retry, and queue recovery tests.
- [x] Replace ESLint and Prettier with one pinned root Biome policy for linting
      and formatting in local hooks, package scripts, and CI.
- [x] Keep both strict `tsc --noEmit` gates alongside Biome because semantic
      TypeScript checking remains a separate compiler responsibility.
- [x] Complete boundary hardening from the pre-migration debt baseline of 97
      unsafe assignments, 34 member accesses, and 15 unsafe arguments.
- [x] Remove the two CodeQL-reported post-build file rewrite races with
      same-descriptor, no-follow regular-file updates and symlink regression
      coverage.
- [x] Complete the broader custom Backend post-build dependency install/patch
      reproducibility review beyond the two remediated file rewrite races.
- [x] Remove the Storefront Railway `npm i -g pnpm` pre-deploy bootstrap and
      use the repository-pinned pnpm/Corepack toolchain without an unpinned
      package-manager install.
- [ ] Remove the Railway CLI package patch when upstream uses a non-vulnerable
      archive extractor and verifies immutable release digests itself.
- [ ] Scan final runtime images, generate image-linked SBOM/provenance, and sign
      or attest the deployed artifacts.
- [ ] Move hardened-runner egress from audit mode to an explicit allowlist after
      observing required endpoints.
- [x] Add a real dependency cooling window and keep only narrowly justified
      security exceptions.
- [ ] Update or replace the pinned Shai-Hulud detector action when an upstream
      release declares a supported Node 24 action runtime; GitHub currently
      forces its deprecated Node 20 action runtime onto Node 24 and annotates
      all three otherwise-successful workflows.
- [ ] Plan isolated compatibility upgrades for Medusa, Next.js, TanStack,
      Stripe, AWS SDK, and other outdated dependency families.

Disposable integration closure on 2026-09-01 adds a release-blocking Backend
CI job backed by official PostgreSQL 18.6 and Redis 8.10.1 images pinned to
tested versions and immutable multi-platform digests. The Backend build now
depends on both unit and integration jobs. A repository boundary verifier
prevents drift in the image pins, test objectives, CI dependency, root command,
loopback bindings, and cleanup behavior.

The local orchestrator uses only a named disposable Compose project, binds its
ports to loopback, injects non-production credentials with payment providers
disabled, and always removes containers, network, and ephemeral volumes. It
also handles interrupts so partial startup cannot silently leave services
running. The real Medusa runner applies every core and custom migration, boots
the application, proves `/live`, `/ready`, and `/api/health`, verifies the
audited tax-off safe default, persists and retries an idempotent payment
failure, serializes distributed locks, and proves lock release/reacquisition.

Exact local acceptance passed all 4 real-infrastructure tests, 5 focused
payment and queue suites / 41 tests, and 3 generated API-contract tests in one
run. Compose health checks passed and the final project inventory was empty.
No shared, staging, or production database, Redis service, provider, payment,
or queue was read or mutated.

Complete local section acceptance also passed the 1,265-file repository
Biome, policy, format, and strict TypeScript gate; all 273 Backend suites /
2,064 tests at 91.61% statements, 85.31% branches, 95.78% functions, and
91.61% lines; and the production Backend/Admin build with its frozen
1,085-package server install.

Quality-depth closure on 2026-08-30 preserves the original Storefront coverage
baseline while adding a separate transactional suite for cart, checkout, BFF
routes, server boundaries, and critical components. The baseline reports
94.16% statements, 86.69% branches, 95.94% functions, and 94.15% lines; the
transactional scope reports 81.86%, 72.16%, 84.39%, and 82.02%, respectively,
across 34 files and 230 tests. Redis now reports 98.21% statements/lines, 100%
branches, and 94.11% functions. Backend's explicit checkout, database,
payment-lifecycle, refund, security, tax, reporting, and upload scope enforces
an 80% global floor and passed 219 suites / 1,297 tests at 90.99% statements,
82.89% branches, 95.13% functions, and 91.12% lines.

Before the Biome migration, the final Backend ESLint increment narrowed
thirteen unsafe call/return findings at import, workflow, search, Stripe Tax,
and reconciliation boundaries. Those source-level boundary improvements
remain, while the remaining unsafe assignment/member/argument counts above are
preserved as a dated debt baseline rather than misrepresented as Biome rules.

The first post-migration boundary tranche now centralizes fail-closed record,
graph-envelope, workflow-row, and counted-page readers for the tax-reporting
and refund-operations paths. Neither path silently filters primitive provider
rows or trusts declared Medusa return types. Refund evidence pagination rejects
a short page before its declared total, tax payment hydration validates every
graph response, and financial primitives reject JavaScript boolean/blank/date
coercion. Eighty-seven focused provider, tax-reporting, and refund-operation
tests pass with strict TypeScript and Biome. The broader dated debt item remains
open for the other service, workflow, and import boundaries.

The second post-migration boundary tranche applies the same shared readers to
tax-control workflow hooks, stored calculation context, and historical
order-rate preservation. Complete graph and relationship arrays now validate
before subject derivation; booleans and other JavaScript numeric coercions,
malformed partial maps or frozen quotes, duplicate taxable entities, and
ambiguous historical shipping rates fail closed instead of being filtered or
partly applied. Direct workflow-hook registration and execution tests cover all
three Medusa hooks and prove both malformed-row rejection and valid amount
normalization. Thirty-five focused boundary, context, hook, and
rate-preservation tests pass with strict TypeScript and Biome, including
missing or ambiguous graph rows and missing or duplicate relationship IDs. The
complete Backend gate passes 223 suites / 1,352 tests, and the repository gate
checks 1,160 files with Biome before both strict TypeScript builds and the
policy verifiers.

The third post-migration boundary tranche hardens the tax invariant and
operator-projection layer. Subject fingerprints reject malformed or duplicate
relationships and normalize only explicit finite numeric values; controlled
quote extraction validates complete subjects, generations, and 0%–100% rates.
Payment binding validates the pending session, one-row evidence queries, and
persistence acknowledgement before success. Refund-ledger comparison rejects
primitive rows, duplicate or invalid PaymentIntent identities, invalid amounts,
and malformed stored evidence rather than converting them to zero. Impact
pagination validates graph envelopes, metadata, unique carts, complete pages,
and consistent prepared-session tax identities. A prepared checkout validates
the hardened subject before matching its exact prior fingerprint projection,
preserving frozen carts without creating new legacy hashes. Fifty-three focused
fingerprint, quote, payment-binding, refund-ledger, and impact tests pass with
strict TypeScript and Biome. The complete Backend gate passes 223 suites / 1,376
tests, while the repository gate remains clean across 1,160 Biome-managed
files, both strict TypeScript builds, and every policy verifier.

The fourth post-migration boundary tranche makes the complete checkout data
path fail closed on malformed Medusa or Stripe projections. Storefront payment
reuse, checkout projection and revision, tax identity, payment-session
metadata, and order receipts now share strict record, array, numeric, integer,
bounded-text, and timestamp readers. Primitive relationship rows, array-shaped
records, boolean money or inventory, ambiguous quantities and generations,
invalid client secrets, incomplete receipt envelopes, and malformed optional
identities cannot silently become a payable checkout or customer receipt.
Backend completion applies the same record and canonical-integer contract to
cart items, shipping methods, payment collections, sessions, PaymentIntent
minor units, and frozen tax metadata before `completeCartWorkflow` can proceed.
One hundred ten Storefront and ninety-three Backend focused tests pass
alongside both strict TypeScript compilers and Biome. The broader dated debt
item remains open for provider families outside checkout. Complete local
acceptance passes the 1,164-file repository QA gate, all 225 Backend suites and
1,437 tests, all 129 Storefront files and 740 tests, both production builds,
the frozen packaged Backend install, and the Admin bundle budget. Backend
coverage is 90.79% statements, 83.64% branches, 95% functions, and 90.86%
lines. Storefront baseline coverage is 94.22/86.73/96/94.22 and transactional
coverage across 34 files and 266 tests is 82.25/73.77/84.17/82.38. The Admin
main bundle is 1,808,086 gzip bytes and total JavaScript is 2,388,388 gzip
bytes. The production audit retains only three documented ignored moderate
findings; Trivy reports zero high/critical dependency, misconfiguration, or
secret findings.

The fifth post-migration boundary tranche closes the cart-to-fulfillment data
path. Storefront Medusa cart envelopes now validate bounded USD totals, unique
structured line items, product/variant identity, quantities, inventory policy,
and amounts both at the server adapter and again before entering the browser
cache. Cart mutation schemas no longer coerce numeric strings, booleans, or
nulls. Shipping-option lists validate pagination, unique identities, names,
price types, inventory flags, and normalized amounts; calculated responses
must return the requested option identity. Customer UI derivation uses the same
strict amount and quantity readers, so malformed values cannot become `NaN`, a
phantom item count, or a fallback subtotal. Backend per-item fulfillment now
rejects primitive rows, missing item identities, coercive or excessive
quantities, malformed option values, non-USD contexts, and unsafe totals rather
than applying defaults to present invalid data. Eighty-one Storefront and
twenty-four Backend focused tests pass with Biome and both strict TypeScript
compilers. The broader dated debt item remains open for unrelated provider and
service families. Complete local acceptance passes the 1,166-file repository
QA gate, all 225 Backend suites and 1,458 tests, all 130 Storefront baseline
files and 787 tests, all 35 transactional files and 313 tests, both production
builds, the frozen packaged Backend install, and the Admin bundle budget.
Backend coverage remains 90.79/83.64/95/90.86; Storefront baseline coverage
remains 94.22/86.73/96/94.22 and transactional coverage is
83.28/76.09/85.76/83.37. The Admin main bundle is 1,807,810 gzip bytes and
total JavaScript is 2,388,605 gzip bytes. The production audit retains only
three documented ignored moderate findings; Trivy reports zero high/critical
dependency, misconfiguration, or secret findings.

The sixth post-migration boundary tranche closes the signed Stripe
refund/dispute lifecycle and persisted-state family. Supported events now
require exact Stripe identities, a boolean mode, a safe USD minor-unit amount,
a valid timestamp, and bounded provider status; malformed present references
cannot collapse to absence. Receipt creation, processing claims, terminal
completion, and retry scheduling independently validate full stored rows and
their exact database acknowledgements. Immutable replays must match, terminal
replays must agree with the prior order/result, retry counters and delays are
bounded, and terminal metadata is limited to fixed tax-evidence fields. The
five-minute recovery job validates every candidate, excludes corrupt rows from
provider reads, and emits an aggregate `invalid` attention count. Jest's
existing SWC transform now supports Medusa legacy decorators, allowing the
transactional service contract to run directly under an isolated manager.

Sixty-three focused projection, persistence, processor, webhook, and scheduled
recovery tests pass with strict TypeScript and Biome. Complete Backend
acceptance passes 229 suites and 1,507 tests at 91.01% statements, 84.21%
branches, 95.18% functions, and 91.07% lines. The broader dated debt item
remains open for unrelated provider and service families. The 1,171-file
repository QA gate, production Backend/Admin build, frozen packaged install,
and Admin bundle budget also pass. The Admin main bundle is 1,807,696 gzip
bytes and total JavaScript is 2,388,013 gzip bytes. The production audit
retains only the three documented ignored moderate findings; Trivy reports
zero high/critical dependency, misconfiguration, or secret findings.

The first Storefront CI run after the cart-boundary tranche exposed three
responsive Playwright fixtures that still emitted pre-contract cart rows.
Their missing item totals/product/variant projections and non-canonical mocked
Medusa IDs were correctly rejected by the customer-side boundary, leaving
quantity actions disabled in seven Desktop, Pixel 7, and iPhone 15 Pro cases.
All E2E cart responses now pass through the production cart-envelope validator
and use complete canonical fixtures. The seven previously failing cases pass
focused, and the complete responsive production-artifact suite passes 55 with
two intentional device/desktop skips across all 57 scheduled cases. The
Storefront production build, client-secret scan, strict TypeScript, and Biome
also pass locally.

The seventh post-migration boundary tranche closes TaxRate.io response, tax
cache, quota persistence, Admin readiness, and email money projection as one
family. TaxRate.io's documented `rate` and jurisdiction component percentages
remain percentages, while only fractional `rate_pct` is multiplied by 100;
when both total fields are present they must agree. Numeric literals, response
text, usage counts, ranges, and optional metadata are bounded before entering
the tax line or quota snapshot. Redis rate and Stripe quote values are
reconstructed through allowlisted contracts that validate jurisdiction,
calculation identity, future expiry, mode, currency, safe integer amounts, no
more than 100 references, and exact item-plus-shipping tax totals. Invalid
Stripe cache entries are deleted before recalculation. Quota snapshots must
remain coherent across provider response, Redis, database persistence,
readiness, and Admin projection; malformed persisted rows fail closed instead
of becoming provider availability through JavaScript coercion. Customer email
money uses the shared strict decimal reader, rejecting hexadecimal, trailing
text, non-finite, negative, and malformed wrapper values.

Sixty-six focused provider, cache, quota, Admin switch, and email projection
tests pass with strict TypeScript and Biome. Complete local acceptance passes
the 1,173-file repository QA gate, all 230 Backend suites and 1,538 tests, the
production Backend/Admin build, frozen packaged install, and Admin bundle
budget. Backend coverage is 91.35% statements, 84.60% branches, 95.52%
functions, and 91.39% lines. The Admin main bundle is 1,808,259 gzip bytes and
total JavaScript is 2,389,091 gzip bytes. The production audit retains only
the three documented ignored moderate findings; Trivy reports zero
high/critical dependency, misconfiguration, or secret findings. The broader
dated debt item remains open for unrelated provider and service families.

The eighth post-migration boundary tranche closes the complete Product-import
lifecycle. Managed upload content, CSV matrices and records, Product graph
envelopes and relationships, Medusa normalizer trees, persisted plans, and
batch-workflow acknowledgements are now validated at runtime. Imports accept at
most 12 MiB, 25,000 data rows, 256 columns, and 5,000 create/update operations;
plans require at least one operation, reject duplicate update IDs, and expire
after 24 hours. Preparation and confirmation serialize on distributed locks.
Confirmation supplies a stable hashed Medusa workflow transaction ID, retains
the plan after workflow/acknowledgement failure, and deletes it only after the
created and updated result sets exactly match the plan with no deletions.
Preparation deletes the upload only after persistence returns a valid opaque
plan ID and attempts plan rollback if upload cleanup fails. Filenames are
basename-normalized, File Module identifiers are separately bounded, and logs
contain only fixed event classes plus aggregate counts.

Twenty-six focused contract, preparation, rollback, replay, expiry, graph,
workflow-acknowledgement, and option-reuse tests pass with strict TypeScript and
Biome. Complete local acceptance passes the 1,176-file repository QA gate, all
232 Backend suites and 1,562 tests, the production Backend/Admin build, frozen
packaged install, and Admin bundle budget. Backend coverage remains 91.35%
statements, 84.60% branches, 95.52% functions, and 91.39% lines. The Admin main
bundle is 1,807,790 gzip bytes and total JavaScript is 2,388,253 gzip bytes. The
production audit retains only the three documented ignored moderate findings;
Trivy reports zero high/critical dependency, misconfiguration, or secret
findings. The broader dated debt item remains open for unrelated import,
provider, and service families.

The ninth post-migration boundary tranche closes the Catalog mutation and
bundle-inventory persistence family. Product, Variant, stock-location,
shipping-profile, store, inventory-link, bundle-profile, bundle-component,
bundle-provenance, and orphan-media results are now treated as untrusted
runtime data. Envelopes, canonical identifiers, expected-set membership,
relationship agreement, uniqueness, positive quantities, exact Product-create
acknowledgements, stable Variant creation keys, and counted-page consistency
must all validate before a missing entity, inventory plan, or orphan page can
be accepted. Malformed rows can no longer be silently discarded or converted
into a misleading 404, empty result, or default quantity of one.

Declared bundle mapping metadata is all-or-nothing: malformed mappings fail as
invalid operator input or unexpected persisted state instead of falling back
to a different component link. Bundle reconciliation re-reads both Medusa's
remote inventory links and the project-owned provenance rows after mutation.
It reports success only when affected links and quantities exactly match the
plan; otherwise it restores and verifies the pre-mutation remote and provenance
snapshots. Orphan-media count and row identities likewise fail closed instead
of coercing a malformed database count to zero.

Thirty-eight focused contract, Admin assertion, Product-create, bundle
planning/reconciliation, and orphan-media tests pass with strict TypeScript and
Biome. Complete local acceptance passes the 1,179-file repository QA gate, all
234 Backend suites and 1,582 tests, the production Backend/Admin build, frozen
packaged install, and Admin bundle budget. Backend coverage remains 91.35%
statements, 84.60% branches, 95.52% functions, and 91.39% lines. The Admin main
bundle is 1,807,723 gzip bytes and total JavaScript is 2,388,267 gzip bytes.
The production audit retains only the three documented ignored moderate
findings; Trivy reports zero high/critical dependency, misconfiguration, or
secret findings.

The tenth post-migration boundary tranche closes the custom Store Product-read
family. Product candidate, sales-channel link, published Product, and keyset
page graph results now require valid envelopes, canonical expected identities,
unique rows, bounded results, and strict cursor order. Malformed Product data
cannot silently become a false not-found, a skipped feed entry, or a cursor that
advances past corrupt state. Product-handle timestamps, discography links, and
shelf creation timestamps are validated before serialization. Related-product
responses are reconstructed from an allowlisted public projection and retain
only the artist/album metadata used for ranking.

The Store bundle projection validates the project-owned active profile, every
component invariant and declared mapping, public Product/Variant ownership,
bundle Variant targets, and the complete availability map. Variant mappings are
scoped to their exact component Product, so an identical or corrupt cross-
Product identifier cannot become an available option. Missing channel
visibility remains unavailable and redacted; malformed persistence or provider
state fails closed rather than defaulting a quantity, title, type, or mapping.

Ninety-one focused query, projection, route, bundle, persistence, and pagination
tests pass with strict TypeScript and Biome. Complete local acceptance passes
the 1,184-file repository QA gate, all 237 Backend suites and 1,648 tests, the
production Backend/Admin build, frozen packaged install, and Admin bundle
budget. Backend coverage is 91.35% statements, 84.60% branches, 95.52%
functions, and 91.39% lines. The Admin main bundle is 1,807,690 gzip bytes and
total JavaScript is 2,388,398 gzip bytes. The production audit retains only the
three documented ignored moderate findings; Trivy reports zero high/critical
dependency, misconfiguration, or secret findings.

The eleventh post-migration boundary tranche closes the project-owned Store
module-read family. Discography and News counted pages now require exact tuple
shape, safe counts, bounded page sizes, canonical unique identities, coherent
lifecycle state, due timestamps, bounded text and lists, safe HTTP(S) media
URLs, and consistent catalog linkage before serialization. The exact News
detail path rejects multiple or mismatched rows instead of selecting the first
result, while a genuine empty result remains a not-found response.

Catalog shelves independently validate active, unarchived, uniquely identified
shelf rows, schedule ranges, modes, limits, and ribbon state. Memberships must
belong to the exact requested shelf set and remain unique per shelf/Product;
automatic profiles remain unique per Product. Only the public
`lookbackDays` and `source_created_at` automation inputs survive metadata
projection, preventing arbitrary project-owned metadata from crossing the
Store response boundary. Twenty-nine focused contract and route tests cover
valid projections plus malformed counts, ownership, lifecycle, schedule,
identity, URL, list, duplicate, and exact-result cases.

Complete local acceptance passes the 1,188-file repository QA gate, all 240
Backend suites and 1,673 tests, the production Backend/Admin build, frozen
packaged install with Medusa 2.18.0, and the Admin bundle budget. Backend
coverage remains 91.35% statements, 84.60% branches, 95.52% functions, and
91.39% lines. The Admin main bundle is 1,807,700 gzip bytes and total JavaScript
is 2,388,594 gzip bytes. The production audit retains only the three documented
ignored moderate findings; Trivy reports zero high/critical dependency,
misconfiguration, or secret findings.

The twelfth post-migration boundary tranche closes the Admin News and
Discography persistence family. Counted list pages, exact retrieval, Product
hydration, create/update acknowledgements, and lifecycle results now validate
complete bounded records before serialization. News lifecycle, sanitized rich
text, safe HTTP(S) cover URLs, slugs, timestamps, tags, and versions remain
coherent. Discography source/Product linkage, release date/year, lists,
availability, media URL, identity, and version must likewise agree.

Idempotency operation reads reject primitive, duplicate, malformed, or
ambiguous rows. Pending and succeeded transitions preserve the exact actor,
aggregate, command, expected version, idempotency key, request SHA-256, result,
and completion state. News replays validate the entire stored response;
Discography replays require the retained entry version to equal the recorded
result so a later edit cannot masquerade as an earlier command response.
Forty-four focused contract, route, lifecycle, replay, form, and
Product-hydration
tests cover both valid authoring and adversarial persistence acknowledgements.

Complete local acceptance passes the 1,192-file repository QA gate, all 243
Backend suites and 1,701 tests, the production Backend/Admin build, frozen
packaged install with Medusa 2.18.0, and the Admin bundle budget. Backend
coverage remains 91.35% statements, 84.60% branches, 95.52% functions, and
91.39% lines. The Admin main bundle is 1,807,718 gzip bytes and total JavaScript
is 2,388,451 gzip bytes. The production audit retains only the three documented
ignored moderate findings; Trivy reports zero high/critical dependency or
secret findings.

The thirteenth post-migration boundary tranche closes the Admin Merchandising
shelf persistence family. Counted pages, individual shelves, Product
memberships, and Product-profile ownership now require canonical identities,
bounded row counts, coherent schedules and lifecycle state, unique
relationships, and safe bounded metadata before serialization. The Admin list
accepts at most 100 shelves and the service read remains bounded to 200
memberships per shelf.

Create and update verify every acknowledged shelf field and next version.
Membership changes validate Product/profile ownership inside the serializable
transaction, verify the exact create result, and read back the exact final set.
Archive and restore verify both the mutation acknowledgement and retained
lifecycle state. Pending-to-succeeded audit transitions require the same exact
operation identity, actor, aggregate, expected version, idempotency key,
request SHA-256, result, and terminal timestamp; replays must still match the
recorded shelf version and archive state. Handle allocation is deterministic
and fails after 50 collisions rather than introducing a time-derived value.

Thirty-eight focused contract, route, transaction, replay, lifecycle,
membership, profile, mutation, and cost-bound tests cover valid authoring and
adversarial persistence acknowledgements.

Complete local acceptance passes the 1,195-file repository QA gate, all 245
Backend suites and 1,729 tests, the production Backend/Admin build, frozen
packaged install with Medusa 2.18.0, and the Admin bundle budget. Backend
coverage remains 91.35% statements, 84.60% branches, 95.52% functions, and
91.39% lines. The Admin main bundle is 1,807,790 gzip bytes and total JavaScript
is 2,388,187 gzip bytes. The production audit retains only the three documented
ignored moderate findings; Trivy reports zero high/critical dependency or
secret findings.

Exact staging acceptance for the shelf tranche: source head
`1b22391200b715a64cb4a8ea85241abf1e0d0074` passed Root CI `33351485972`,
Backend CI `33351486033`, and Storefront CI `33351486101`. Railway released
Backend deployment `b20711b8-2de4-4657-87b1-9c7e7958f695` at `SUCCESS` with
image digest
`sha256:f4f565de3b4d606557926eddcee2817660326f264a3b44da8fcdd358c63e81e7`.

The preceding content tranche also exposed one generic-key false positive for
a synthetic UUID shared by two content-authoring tests. The Gitleaks exception
is limited to that exact value and those exact test paths; the pinned 8.30.1
full-history scan still inspects all 885 commits and reports zero findings.

The fourteenth post-migration boundary tranche closes the Admin Catalog
taxonomy and Product/Variant profile persistence family. Artist and controlled
reference pages, detail reads, natural-key resolution, and create/update
acknowledgements require bounded complete rows, canonical unique identities,
safe HTTP(S) media, bounded text and recursive JSON, valid kinds/ranks, and
exact echoed fields. Missing details remain distinct from malformed present
data. Natural-key queries request two rows and reject ambiguity rather than
silently reusing one duplicate.

Product and Variant authoring validate singleton profile state, exact saved
fields and next versions, relation ownership and uniqueness, exact relation
creation, final readback, snapshots, restores, and orphan checks. Relationship
queries request a sentinel row beyond the 100-row command limit so oversized
state cannot hide at pagination. Pending, succeeded, and compensated audit
rows preserve the exact actor, aggregate, command, expected version,
idempotency key, request SHA-256, result, timestamps, and terminal error.
Response-loss replay additionally requires the recorded profile identity and
version to remain stored; compensation refuses any operation that is no longer
pending.

Seventy-two focused contract, route, resolution, authoring, replay,
compensation, restore, and cost-bound tests pass with strict TypeScript and
Biome. Complete local acceptance passes the 1,201-file repository QA gate, all
250 Backend suites and 1,782 tests, the production Backend/Admin build, frozen
packaged install with Medusa 2.18.0, and the Admin bundle budget. Backend
coverage remains 91.35% statements, 84.60% branches, 95.52% functions, and
91.39% lines. The Admin main bundle is 1,807,431 gzip bytes and total JavaScript
is 2,388,023 gzip bytes. The production audit retains only the three documented
ignored moderate findings; Trivy reports zero high/critical dependency,
misconfiguration, or secret findings. The remaining dated boundary-hardening
item stays open for unrelated provider and service families.

The staged Gitleaks scan classified the contract test's synthetic UUID as a
generic key because of its `idempotencyKey` label. The exception is limited to
that exact value and exact test path; it does not suppress other UUIDs, paths,
or rules.

Exact staging acceptance for the taxonomy/profile tranche: source head
`f6e14833c5e55236e747e8e738d453d3eee61cf1` passed Root CI `33353517479`,
Backend CI `33353517345`, and Storefront CI `33353517361`. Railway released
Backend deployment `8befe592-d2a7-4ab4-aa4f-eee7e4d1df74` at `SUCCESS` with
image digest
`sha256:9d2a1c1793466508d7e354c7164639a283b2b2216b0b7396fb66fb7ee882ebdb`.

The fifteenth post-migration boundary tranche closes the Catalog media and
bundle transaction persistence family. Media asset, Product-media item,
upload, lifecycle, bundle profile, bundle component, inventory provenance, and
authoring-operation responses now require complete bounded records, canonical
identities, safe URLs, coherent lifecycle timestamps, unique relationships,
and exact ownership before Admin can serialize or acknowledge them. Product
authoring hydration and Media Cleanup use the same contracts, so malformed
state cannot become a plausible editor default, incomplete media strip, or
false orphan count.

Every media and bundle mutation validates its create/update/delete response
and reads back the exact final relationship set before completing the audit
operation. Upload replay also matches the original file count, names, MIME
types, sizes, unique File Module IDs, and URLs. Pending-to-succeeded and
pending-to-compensated transitions preserve the exact operation identity,
actor, aggregate, command, expected version, UUID idempotency key, SHA-256
request hash, result, timestamps, and stable error; terminal operations cannot
be compensated again. Bundle rollback verifies both the restored component
snapshot and the owned inventory-link provenance.

One hundred two focused contract, stateful service, route, authoring, upload,
lifecycle, replay, compensation, rollback, hydration, and cost-bound tests pass
across 13 suites. Complete local acceptance passes the 1,206-file repository
QA gate, all 253 Backend suites and 1,813 tests, the production Backend/Admin
build, frozen packaged install with Medusa 2.18.0, and the Admin bundle budget.
Backend coverage remains 91.35% statements, 84.60% branches, 95.52% functions,
and 91.39% lines. The Admin main bundle is 1,808,021 gzip bytes and total
JavaScript is 2,388,859 gzip bytes. The production audit retains only the three
documented ignored moderate findings; Trivy reports zero high/critical
dependency, misconfiguration, or secret findings. This server-side tranche
does not change rendered layout, so the previous Product-authoring, bundle, and
Media Cleanup screenshot evidence remains applicable.

Exact staging acceptance for the media/bundle transaction tranche: source head
`85d6f548e9de61dd655b1a078e0f8a2d52b0af8b` passed Root CI `33355179119`,
Backend CI `33355179110`, and Storefront CI `33355179107`. Railway released
Backend deployment `efadaaa1-cf90-4435-a37e-859c7afc6ba1` at `SUCCESS` with
image digest
`sha256:52e16bac1cc6eaa2301bef07a3846c6348d16c8e4d6f2fb191d2caba9c440115`.

The sixteenth post-migration boundary tranche closes the Catalog authoring
audit and release-readiness persistence family. The Admin audit route,
operator command, and complete Product authoring-view release check now share a
strict loader for native Products, Catalog profiles, controlled Product Types,
and bundle profiles. Required service methods, complete records, canonical
identities, bounded recursive metadata, known Product lifecycle status,
control-free operator text, and relationship ownership must validate before
classification begins.

Every family is read in deterministic ID order through exact 250-row counted
pages with a 25,000-record ceiling. Page totals must remain stable, every
non-final page must be complete, and identities must remain unique across page
boundaries. Profiles and bundles must belong to a Product in the same audit;
bundle-to-profile links must preserve that Product ownership. Product Type
natural keys remain globally unique. A short, drifting, duplicate, malformed,
or orphaned result is therefore an operational incident rather than a partial
or falsely healthy cutover report.

Twenty-six focused persistence, pagination, relationship, classification, and
route tests pass across four suites. Complete local acceptance passes the
1,209-file repository QA gate, all 255 Backend suites and 1,831 tests, the
production Backend/Admin build, frozen packaged install with Medusa 2.18.0,
and the Admin bundle budget. Backend coverage remains 91.35% statements,
84.60% branches, 95.52% functions, and 91.39% lines. The Admin main bundle is
1,807,582 gzip bytes and total JavaScript
is 2,388,193 gzip bytes. The production audit retains only the three documented
ignored moderate findings; Trivy reports zero high/critical dependency,
misconfiguration, or secret findings. The read-only live-catalog command
cannot use Railway's private Postgres hostname from a local process; exact
staging execution remains an after-deploy acceptance check inside the service
network.
This server-side tranche changes no rendered layout, so the existing Catalog
workspace and authoring audit screenshot evidence remains applicable.

Exact staging acceptance for the authoring-audit/readiness tranche: source head
`605420e2f4a611653ef1b73cf1c9d6a24bfc63c2` passed Root CI `33356129860`,
Backend CI `33356129833`, and Storefront CI `33356129812`. Railway released
Backend deployment `03330403-bf30-4ba7-b91d-c4334a5dc7df` at `SUCCESS` with
image digest
`sha256:853d37489321c156be45f76b65341d7570ee1a4337de952611baf03db2bcb7b6`.
Backend `/live`, `/ready`, and `/api/health` each returned HTTP 200, `ok`, and
that exact SHA. Two bounded Railway SSH attempts did not establish a command
session, so the read-only live-catalog command remains explicitly pending
rather than being represented as successful acceptance evidence.

The custom Medusa packager now selects the exact Backend lockfile importer and
fails if it cannot do so, executes pnpm without a shell, rejects malformed
pnpm policy rather than falling back, and renders stable sorted workspace
policy. Explicit build-script denials override defaults, closing a discovered
gap that had re-enabled Puppeteer's install script inside `.medusa/server`.
Bootstrap, lock, workspace, and patch files use no-follow regular-file reads
and exclusive creates; patches must stay canonically inside the reviewed
workspace and cannot use symlink sources or colliding filenames. Ten focused
regression tests and a fresh frozen production build pass; the generated
runtime retains
`puppeteer: false`, contains only the normalized Backend importer, installs 65
top-level production dependencies, and contains no Puppeteer package.

The local production artifact passed 21 non-destructive critical journeys in
Chromium, Firefox, and WebKit. They cover home hydration, a contained cart and
empty state, quick-shop mutation, a real catalog Product detail, stable desktop
filter refresh, checkout, and receipt confirmation. The Storefront has no
customer account/auth route; checkout explicitly remains guest-only, and the
database-reset starter-template authentication suite is not an application
acceptance surface. Failure screenshots and traces are retained for 14 days in
CI. Real WebKit screenshots of the cart, quick shop, checkout, and receipt were
inspected. That run exposed and fixed a genuine CSP bug: production-mode local
HTTP documents no longer upgrade their own subresources to HTTPS, while secure
deployed requests retain `upgrade-insecure-requests` and
`block-all-mixed-content`.

One root Biome 2.5.11 configuration now owns supported JavaScript, TypeScript,
JSX, TSX, JSON/JSONC, and CSS formatting plus static analysis. It parses the
Backend's parameter decorators and Storefront Tailwind v4 directives, enables
Storefront Next/React/test/type domains, preserves the packaged-workflow import
boundary, and limits reviewed HTML-sink exceptions to three exact files.
Biome does not parse YAML or provide compiler-equivalent semantic TypeScript
checking, so workflow YAML remains covered by repository policy verifiers and
GitHub while both strict `tsc --noEmit` gates remain mandatory. ESLint,
typescript-eslint, JSX-a11y ESLint, and Prettier dependencies/configurations are
removed; `biome check --error-on-warnings .` processes 1,162 files cleanly.

Current local acceptance passes the complete repository QA policy, both strict
compiler checks, all 225 Backend suites and 1,405 tests, the 128-file/693-test
Storefront baseline suite, and the 34-file/230-test transactional Storefront
suite. Both production builds and the Storefront client-secret scan pass. The
production audit retains only the three documented ignored moderate findings
and reports no high or critical finding. Backend coverage is 90.74% statements,
83.43% branches, 95% functions, and 90.81% lines. The CI quick-shop regression
now scopes its action to the labelled Catalog results region so the same
Product in another valid section cannot make the locator ambiguous; Chromium,
Firefox, and WebKit all pass that focused production-artifact journey.

Exact staging acceptance for the Storefront transition correction: source head
`6b929965e3b269c4c2a154bdcbcaa0c91a1b7ca6` passed Root CI `33338604763`,
Backend CI `33338604765`, and Storefront CI `33338604764`. Railway released
Backend deployment `8a777529-5e5a-43ac-9d58-ff881aa21ec6` with image digest
`sha256:33717d30b0ee2b4f59a6e775875a8a59afefbde9942be098afc7625e4a37ad29`
and Storefront deployment `9bc15486-ec59-432e-be3d-9ac76158bfe3` with image
digest
`sha256:a8266010284455586aa4ade95fb7e3f03146e9c1cfc4f27de0e97f15c5f03746`;
both reached `SUCCESS` on that exact SHA. Backend `/live`, `/ready`, and
`/api/health`; Storefront `/live`, `/ready`, `/api/healthcheck`, `/`, and
`/catalog` all returned HTTP 200. Every health payload reported the exact SHA,
and Backend readiness reported database, Redis, search, object storage, and all
seven capability checks healthy.

Resolved discovery: GitHub Dependabot alerts `27` and `28` classified the same
`GHSA-jmr9-qjv8-65gv` / `CVE-2026-56876` high-severity development-only
`extract-zip@2.0.1` symlink path-traversal risk. Alert `27` tracks the root
lockfile occurrence; alert `28` was created when the behavioral verifier made
that already-transitive package explicit in `package.json`. The package was
installed only for browser QA by `@puppeteer/browsers` through Pa11y and
Lighthouse, not into either deployed application, and no patched
`extract-zip` release exists. Consolidating those consumers on the compatible
browser-manager 3 API removed the vulnerable package from both manifests and
the lockfile. GitHub marked both alerts fixed without dismissal, while the
production-only pnpm audit and Trivy source scan remained clean of
high/critical findings. Automated security fixes are now enabled as the owned
remediation boundary for future supported updates.

CI discovery: pinned Shai-Hulud detector `v2.1.0` passed in Root, Backend, and
Storefront CI, but GitHub annotated each run because the action still declares
the deprecated Node 20 action runtime and is being forced onto Node 24. This is
not a current scan failure, but it is retained as explicit supply-chain
maintenance rather than suppressing the platform warning.

## Observability and operations

- [x] Remove or classify Railpack npm wrapper warnings and successful pnpm
      command banners currently recorded at error severity so deployment-log
      alerts remain actionable.
- [x] Correct the misleading blank Storefront `api.problem` display record and
      add a tested exact-request-ID Railway verifier that fails when correlated
      events disappear or their deployment/correlation fields mismatch.
- [x] Add structured JSON logging with redaction, request ID, trace ID, span ID,
      service, environment, and commit SHA; inject Railway `COMMIT_SHA` so
      health responses expose the accepted artifact version.
- [x] Add OpenTelemetry traces and RED metrics for HTTP, database, Redis,
      search, storage, Stripe, tax, email, queues, and scheduled jobs.
- [x] Add privacy-conscious Web Vitals and frontend error reporting.
- [x] Alert on Redis reconnects/latency, BullMQ stalls, payment/tax mismatches,
      reconciliation backlog, webhook failures, readiness failures, database
      saturation, storage errors, and elevated error/latency rates.
- [x] Define an SLO, severity, owner, escalation path, and runbook for every
      alert.
- [x] Add payment, tax, notification, lifecycle, search, storage, and RBAC
      capability checks to startup/readiness without exposing secrets.
- [x] Verify anonymous-cart and abandoned-checkout retention jobs execute and
      report auditable counts.

Local implementation closure installs the Backend OpenTelemetry SDK before the
Medusa CLI import, restricts automatic instrumentation to PostgreSQL/Knex,
Redis/ioredis, and Node runtime signals, and emits project-owned privacy-bounded
HTTP and commerce operation spans/RED metrics. Redis statements retain only a
validated command name; automatic HTTP, Undici, and AWS instrumentation remain
disabled so URLs, query strings, postal codes, object keys, and provider
payloads cannot become span attributes. Search, storage, Stripe, tax, email,
queue, and scheduled-job operations use fixed compile-time names and only
`ok`/`error` result classes. Railway preserves optional OTLP configuration and
the Backend performs no exporter network connection when neither an endpoint
nor an explicit exporter is configured.

Backend and Storefront startup plus Backend pre-deploy now use pnpm's silent
wrapper mode, removing lifecycle success banners from runtime logs while
retaining application output and failures. Runtime identities accept Railway's
immutable `RAILWAY_GIT_COMMIT_SHA` directly, so a duplicate manually managed
`COMMIT_SHA` is optional rather than required. `/health/operations`, the
alternate ten-minute staging monitor, the post-retention daily observation,
24-hour incident latches, capability probes, Redis latency, and retained
aggregate retention snapshots complete the alert evidence boundary. The full
SLO, alert, escalation, privacy, OTLP, and first-response contract lives in
`docs/OBSERVABILITY_OPERATIONS.md`.

The August 30 staging monitor correctly surfaced missing retention heartbeats
after snapshot persistence was deployed later than that day's two daily job
runs. Exact Railway deployment logs prove the pre-instrumentation jobs executed
under their reviewed 37-day policies: anonymous-cart retention scanned and
deleted 444 eligible carts at `04:17` UTC, while abandoned-checkout retention
scanned zero and deleted zero at `04:37` UTC. The instrumented anonymous-cart
wrapper's explicit Node imports were valid but misplaced after the exported job
configuration; they now follow the normal top-of-module convention. Neither
instrumented wrapper had direct execution tests. New job tests cover the fixed
schedules, disabled heartbeats, distributed-lock execution, payment-session
cancellation, aggregate success events, and failure events for both jobs.
Twenty-eight
focused retention tests, all 227 Backend suites and 1,466 tests, strict
TypeScript, Biome, the production Backend/Admin build, frozen packaged install,
and the Admin bundle budget pass locally. Coverage remains
90.79/83.64/95/90.86. The main Admin bundle is 1,808,078 gzip bytes and total
JavaScript is 2,388,689 gzip bytes. The external incident intentionally remains
open until the next ordinary `04:17` and `04:37` UTC schedules write real
heartbeats; no synthetic evidence or manual destructive cleanup is permitted.

## Client Admin experience

- [x] Research Medusa 2.18 extension/form constraints, Medusa UI conventions,
      WCAG 2.2 form requirements, and inventory every project-owned Admin input
      surface in `docs/ADMIN_EXPERIENCE_REWORK.md`.
- [x] Establish the task-oriented Catalog, Content, and Operations information
      architecture with needs-attention, common-action, recent-change, and
      recovery/help priorities.
- [x] Build shared schema, field, hint/error, validation-summary, error-focus,
      pending/save, unsaved-change, draft, success, and response-loss form
      primitives with accessible tests.
- [x] Rework composite catalog creation around safe defaults, progressive
      disclosure, searchable choices, plain-language units, customer-visible
      availability, resumable drafts, and final review.
- [x] Split and rework existing Product authoring into task-sized product,
      variant, price, inventory, media, bundle, publication, and diagnostic
      sections without creating a second write authority.
- [x] Split the Product/Variant profile widget monolith into independently
      tested query, schema, presentation, and short edit-Drawer modules.
- [x] Rework merchandising shelf creation/settings/product selection with
      persistent selection context, preview, ordering, and recovery.
- [x] Rework news creation/editing with one publishing model, content/media
      preview, schedule clarity, archive/restore, and accessible error recovery.
- [x] Rework discography creation/editing with consistent release metadata,
      controlled choices, cover preview/alternative text, availability, and
      archive/restore behavior.
- [x] Integrate the audited tax collection-mode workflow and plain-language
      compliance/impact copy from ADR 0007.
- [x] Standardize permission-denied, empty, loading, failed, stale-version,
      pending, success, and incident states across all custom Admin routes.
- [x] Keep technical IDs and diagnostics behind disclosures while preserving
      exact audit/recovery data for authorized support operators.
- [x] Add focused component/interaction coverage for each objective and pass
      the complete Backend lint, strict typecheck, tests, coverage, API/RBAC,
      and production Admin build gates before the section push.
- [x] Complete keyboard-only, screen-reader, 200% zoom, focus, contrast,
      target-size, reduced-motion, mobile, laptop, and wide-screen validation.
- [x] Capture and inspect real desktop screenshots of all critical Admin form
      states, then update the client and support guides with task walkthroughs.

The August 31 final Admin acceptance runs the exact compiled Medusa Admin with
GET-only authenticated fixtures across 12 critical route and dialog states.
The 760-, 800-, 1,440-, and 1,920-pixel cases cover narrow/mobile,
200%-equivalent, laptop, and wide layouts. All cases return zero axe violations,
zero incomplete checks, zero failed responses, no document overflow, no
unnamed or undersized controls, no dangling ARIA relationships, no
reduced-motion animation, and visible unobscured keyboard focus. Product
authoring was also opened in headed Helium and inspected from a real graphical
desktop screenshot captured with `flameshot`.

The pass corrected shared search/action/sort accessible names, decorative icon
semantics, nested heading levels, hidden tab stops, stale Radix
`aria-controls`, opaque sticky action surfaces, and keyboard focus hidden by
sticky bars. Those vendor corrections are pinned patches and a new repository
boundary verifier makes their loss fail the standard QA gate. The client guide
now includes keyboard, zoom, narrow-screen, and privacy-safe recovery guidance;
`docs/ADMIN_SUPPORT_GUIDE.md` supplies task-specific retry, escalation, and
mutation-authority decisions.

Final local gates pass the 1,247-file repository QA check, all 272 Backend
suites and 2,037 tests at 91.46/84.87/95.62/91.48 coverage, both Storefront
coverage groups with 169 suites and 1,110 tests, both strict compilers, both
production builds, the Admin bundle budget, and the React Router
production-artifact verifier. The dependency audit retains only the three
documented ignored moderate findings. The Admin's largest JavaScript bundle is
1,809,126 gzip bytes and total JavaScript is 2,389,710 gzip bytes.

The August 30 second-pass audit makes the guided Catalog creation workflow the
canonical native Product-list create destination and adds current-catalog
release presets, SKU assistance, controlled Format choices, catalog-health
guidance, and UI/API enforcement against missing SKUs or zero-dollar drafts.
Local acceptance passes repository QA, Backend Biome and strict typecheck, all
214 Backend suites and 1,271 tests, the product-create vendor-boundary
verifier, production Backend/Admin build, and the Admin bundle budget. The
production dependency audit retains only three documented ignored moderate
findings; Trivy reports zero high/critical dependency, misconfiguration, or
secret findings. Exact production-bundle screenshots at 1,600×1,000 and
760×900 show no horizontal overflow, console error, or failed response. The
complete create surface and scoped Product-list Catalog workspace both report
zero axe violations and zero incomplete checks after correcting the
availability preview's group semantics. The second-pass layout audit also
found Medusa 2.18 discarding `.before`/`.after` widget placement. The pinned
compatibility patch and repository verifier now preserve that intent across
source, CommonJS, and ESM bundles so catalog health precedes the Product table
by default while saved operator layouts remain authoritative.

The August 30 payment-lifecycle tranche validates the exact `order.placed`
graph row, Stripe provider projection, PaymentIntent/Charge write
acknowledgements, and bounded idempotency keys before reporting annotation
success. It rejects conflicting duplicate PaymentIntent relationships and
malformed event envelopes instead of silently dropping them. Refund
notifications now validate the payment service result, exact collection/order
graph, every relationship identifier, and every refund before sending the
whole event batch or none. The order widget renders an explicit unavailable
state for malformed projections and disables a Dashboard link when test/live
mode is unknown, directing operators to the read-only refund audit instead of
guessing or hiding the incident.

Local acceptance passes 38 focused payment/refund/Admin tests, all 225 Backend
suites and 1,405 tests, the complete 1,162-file repository QA gate, both strict
compiler checks, 90.74/83.43/95/90.81 Backend coverage, the production
Backend/Admin build and frozen packaged install, and the Admin bundle budget.
The Admin main bundle is 1,808,138 gzip bytes and total JavaScript is 2,388,642
gzip bytes. The production audit retains only the three documented ignored
moderate findings; Trivy reports zero high/critical dependency,
misconfiguration, or secret finding. The exact unavailable-state markup was
rendered in headed Chromium against production Admin CSS and inspected at
1,600×1,000 and 760×900 with clear hierarchy, contained wrapping, and no
horizontal overflow.

## Financial persistence and reconciliation hardening

- [x] Validate every Stripe lifecycle receipt and full state transition before
      accepting a replay or write acknowledgement.
- [x] Reject duplicate PaymentIntent, Stripe Tax calculation, quote-evidence,
      control-audit, and quota singleton results by querying beyond one row.
- [x] Validate complete tax control, audit, quote-evidence, and quota records,
      including exact identifiers, provider/mode relationships, generations,
      amounts, timestamps, statuses, UUIDs, and bounded JSON metadata.
- [x] Require exactly one full mutation acknowledgement and compare every
      persisted field for quote creation/reverification, evidence lifecycle,
      provider transition, audit creation, control update, and quota writes.
- [x] Re-read quote, lifecycle, control, and audit state before transactional
      success, rejecting stale replay after a later tax transition.
- [x] Apply the same contracts to checkout payment binding, Stripe evidence
      reconciliation, Admin counts/incidents/history, refund operations, quota
      synchronization, and the hourly reconciliation queue.
- [x] Validate direct module inputs before persistence access and keep provider,
      customer, address, payment metadata, and raw error payloads out of errors
      and logs.

The financial persistence boundary does not coerce database values or trust a
generated service method's return shape. It accepts only canonical USD quote
evidence, requires a Stripe Tax calculation exactly when the recorded provider
is Stripe Tax, preserves the selected provider while collection is disabled,
and keeps an old idempotency replay valid only while its audited target remains
the active control generation. The hourly job requests one row beyond its
100-record work limit, validates the entire returned set, and reports a real
backlog only when that additional row exists.

Eighty focused financial persistence, lifecycle, payment-binding,
reconciliation, quota, and refund-operation tests pass. Complete local
acceptance passes the 1,212-file repository QA gate, all 257 Backend suites and
1,850 tests, strict TypeScript, the production Backend/Admin build, frozen
packaged install with Medusa 2.18.0, and the Admin bundle budget. Backend
coverage is 91.29% statements, 84.60% branches, 95.55% functions, and 91.33%
lines. The Admin main bundle is 1,807,782 gzip bytes and total JavaScript is
2,388,421 gzip bytes. The production dependency audit retains only the three
documented ignored moderate findings; Trivy reports zero high/critical
dependency, misconfiguration, or secret findings.

Remote acceptance is complete for financial persistence commit
`467a7e451bcff84ecc5e4cd7fb7fb9c350da5f43`: Root CI `33357363933`, Backend CI
`33357363963`, and Storefront CI `33357363965` passed. Railway staging
deployment `c9fabb3d-260c-4cf9-add6-6efe7feade39` succeeded with image digest
`sha256:2e0342991ae8e178de067c50371d63af089d21939f534bf5d45c0c678dd2b1b8`;
external `/live`, `/ready`, and `/api/health` probes were healthy and reported
the exact commit SHA before the next queued release.

## Discography projection persistence hardening

- [x] Replace the unbounded 10,000-row replacement read with stable, exact
      250-row pagination and a 25,000-row fail-closed ceiling.
- [x] Validate the complete catalog projection, including exact keys, canonical
      Product identities, unique handles, release date/year coherence, media,
      bounded lists, availability, source mode, and initial version.
- [x] Reject duplicate stored identities/Product links/handles, invalid archive
      timestamps, unsafe version increments, count drift, short pages, and
      malformed counted tuples before writing.
- [x] Preserve explicit operator archives for Products that remain projected,
      create missing links, and archive only active stale links.
- [x] Write updates, creates, and archives in bounded 100-row batches and require
      complete exact acknowledgements for every requested record.
- [x] Re-read the full Discography inside the serializable transaction and
      verify the exact linked set, versions, archive states, total count, and
      preservation of every pre-existing identity before reporting success.
- [x] Make rebuild source pagination reject malformed, oversized, short, or
      drifting pages and apply the strict Discography reader to both plan and
      completion snapshots.

The projection boundary treats both generated module-service results and the
rebuild payload as runtime input. Manual history is never included in catalog
mutation batches. Existing catalog rows remain identity-stable, newly created
rows are bound back to their exact Product IDs, and a successful return means
the complete final linked projection—not only the write counts—matches the
transaction plan.

Thirty-four focused projection, transactional service, content-contract, and
rebuild-pagination tests pass. Complete local acceptance passes the 1,214-file
repository QA gate, all 259 Backend suites and 1,866 tests, both strict
TypeScript checks, the production Backend/Admin build, frozen packaged install
with Medusa 2.18.0, and the Admin bundle budget. Backend coverage remains
91.29% statements, 84.60% branches, 95.55% functions, and 91.33% lines. The
Admin main bundle is 1,808,228 gzip bytes and total JavaScript is 2,388,963 gzip
bytes. The production dependency audit retains only the three documented
ignored moderate findings; Trivy reports zero high/critical dependency,
misconfiguration, or secret findings.

Remote acceptance is complete for Discography projection commit
`0b2092d5a4cfcc06b4d19af8f4d5c501b2ec8e87`: Root CI `33358225469`, Backend CI
`33358225458`, and Storefront CI `33358225554` passed. Railway staging
deployment `1b9d52f3-312c-44e4-8590-c2a135c68a5a` succeeded with image digest
`sha256:227c7ae1f5fab7414406d28221eeade25f2d3b8aa762fd0650e1555c218a2921`;
external `/live`, `/ready`, and `/api/health` returned healthy responses with
the exact commit SHA before the next queued release.

## Checkout recovery and retention persistence hardening

- [x] Validate complete reconciliation, guest-retention, anonymous-retention,
      and internal-status Cart projections before applying any state decision.
- [x] Request beyond singleton cardinality for Cart and order-link reads and
      reject duplicate, mismatched, malformed, or unexpected identities.
- [x] Bound payment collections/sessions and validate canonical provider,
      session, collection, status, timestamp, customer, and Cart values.
- [x] Bound reconciliation metadata depth, width, strings, and keys and reject
      non-JSON objects, non-finite values, or prototype-sensitive keys.
- [x] Require deterministic `updated_at`/`id` page order and unique identities
      for both reconciliation and daily retention scans.
- [x] Re-read the exact durable reconciliation marker and current payment state,
      then recheck the order link before invoking Medusa complete-cart.
- [x] Re-read every anonymous and guest Cart after deletion and count success
      only when the exact bounded ID read proves the row is gone.
- [x] Cover ambiguous rows, malformed payment graphs, unsafe metadata,
      marker/order races, and false delete acknowledgements with adversarial
      tests and strengthen the checkout-recovery source verifier.

The shared boundary treats Medusa graph envelopes and generated module-service
DTOs as runtime input. Malformed persistence aborts the scheduled operation and
therefore its existing health heartbeat; it is never silently filtered into a
safe-to-complete or safe-to-delete result. Unknown but canonical retention
payment states remain protected, while recovery/status accepts only the known
Medusa payment-session state machine.

Eighty-nine focused persistence, reconciliation, status, retention, route, and
scheduled-job tests pass. Complete local acceptance passes the 1,216-file
repository QA gate, all 260 Backend suites and 1,900 tests, both strict
TypeScript checks, the production Backend/Admin build, frozen packaged install
with Medusa 2.18.0, and the Admin bundle budget. Backend coverage is 91.41%
statements, 84.70% branches, 95.61% functions, and 91.43% lines. The Admin main
bundle is 1,808,056 gzip bytes and total JavaScript is 2,388,626 gzip bytes
across 330 files. The production dependency audit retains only the three
documented ignored moderate findings; Trivy reports zero high/critical
dependency or secret findings.

## News durable-state persistence hardening

- [x] Require complete, runtime-validated News entries with canonical
      identities, lifecycle state, safe rich text, accessible HTTP(S) covers,
      bounded lists, versions, and creation/update timestamps.
- [x] Require complete Admin and Store counted-page windows for the requested
      offset/limit instead of accepting false short pages or empty tails.
- [x] Request beyond singleton cardinality for slug, Store detail, and
      idempotency reads and reject duplicate or mismatched results.
- [x] Require canonical UUID idempotency keys, empty operation metadata, exact
      pending/succeeded transitions, and the complete historical replay DTO.
- [x] Compare every mutation acknowledgement with the requested entry state,
      including unchanged fields across edits and lifecycle transitions.
- [x] Re-read the exact entry and succeeded operation inside the serializable
      transaction and compare their full durable result before returning.
- [x] Reject unsafe stored Store rich text and cover/alternative-text mismatch
      instead of sanitizing corruption into plausible public content.

The News boundary treats generated module-service records as runtime input and
does not infer success from declared TypeScript DTOs. Historical replay remains
stable after a legitimate later edit, while a new command proves its exact
entry and audit pair before commit. No additional operator field or technical
choice was added to the Admin form.

Sixty-seven focused persistence, command, Admin route, Store route, serializer,
visibility, and ordering tests pass. Complete local acceptance passes the
1,216-file repository QA gate and all 260 Backend suites / 1,912 tests. Backend
coverage remains 91.41% statements, 84.70% branches, 95.61% functions, and
91.43% lines. The production Backend/Admin build and frozen packaged install
pass with Medusa 2.18.0. The 330-file Admin bundle measures 1,807,796 gzip bytes
for its main file and 2,388,484 gzip bytes total. The production dependency
audit retains only the three documented ignored moderate findings; Trivy
reports zero high/critical dependency, misconfiguration, or secret findings.

## Transactional notification delivery hardening

- [x] Validate administrator invite, order-receipt, payment, refund, cart,
      recipient, address, item, amount, currency, and event projections at
      runtime before provider or persistence access.
- [x] Persist only the receipt fields rendered by the order template instead
      of the complete Medusa Order DTO and unrelated metadata.
- [x] Require one stable Medusa and provider idempotency key for every order,
      refund, and invite notification; derive invite keys from an opaque token
      digest rather than a raw token or email address.
- [x] Accept Medusa's empty replay acknowledgement only after an exact durable
      query proves one successful stored notification and provider delivery ID.
- [x] Reject missing, duplicate, failed, foreign, malformed, or mismatched
      acknowledgement/readback state across complete notification batches.
- [x] Remove invite URLs and tokens from stored template data immediately after
      verified delivery, then validate both the update acknowledgement and
      final readback while accepting an already-redacted replay.
- [x] Restrict the Resend adapter to one validated recipient, the configured
      sender, known templates, subject-only options, no attachments, a bounded
      deadline, and an exact external-ID success response.
- [x] Propagate subscriber/provider failures for retry and keep recipient,
      credential, provider response, raw Order, and exception detail out of
      logs and errors.

The boundary follows pinned Medusa 2.18 behavior: successful replays can return
an empty create array, while the generated notification model retains a unique
idempotency key and update method. The application therefore verifies stored
state rather than weakening replay checks. If invite-data redaction fails after
Resend accepted the message, the same provider key prevents a duplicate email
while the event retry completes and proves redaction.

One hundred eleven focused notification, subscriber, refund-builder, provider,
template, pinned-package, and persistence-contract tests pass. Complete local
acceptance passes the 1,220-file repository QA gate, all 263 Backend suites and
2,000 tests, both strict TypeScript projects, and the production Backend/Admin
build with a frozen packaged Medusa 2.18.0 install. Backend coverage is 91.44%
statements, 84.81% branches, 95.62% functions, and 91.46% lines. The 330-file
Admin bundle measures 1,808,081 gzip bytes for its main file and 2,388,159 gzip
bytes total. The production dependency audit retains only the three documented
ignored moderate findings; Trivy reports zero high/critical dependency,
misconfiguration, or secret findings.

## Application provider and browser-persistence hardening

- [x] Change TanStack Query persistence from default-on to explicit opt-in,
      isolate the new public-only cache behind a versioned key and 15-minute
      maximum age, and remove the legacy cache without depending on storage
      availability.
- [x] Persist only public product-detail and catalog-definition queries; keep
      free-form search terms, cart identity/state, checkout contact/address,
      receipt grants/data, and mutations in memory.
- [x] Give Stripe order/Charge annotations one shared deadline and one
      application-owned transient retry while keeping SDK retries disabled and
      the same idempotency key across attempts.
- [x] Validate returned Stripe descriptions, metadata, object identities, and
      Charge linkage before acknowledging synchronization, and replace provider
      diagnostics with fixed coded failures.
- [x] Accept one distinct previous lifecycle-webhook secret during a bounded
      rotation window while new deliveries use the current secret; cover the
      prior-key path and duplicate-secret startup rejection.
- [x] Remove unused SendGrid configuration and dependencies after exact
      staging inspection proved Resend is the sole configured email provider.
- [x] Patch the pinned Medusa S3 provider reproducibly so every direct request
      and upload stream has cancellation, SDK attempts are bounded, provider
      errors are redacted, and failed deletes propagate into compensation.
- [x] Pin the installed S3 package version and runtime source/behavior contract
      with adversarial tests so a dependency refresh cannot silently restore
      raw logging or swallowed deletion failures.

Local acceptance passes 47 focused Backend tests across six suites and nine
focused Storefront tests across two files, the 1,222-file QA and format gates,
264 Backend suites with 2,007 tests, 131 Storefront baseline files with 789
tests, and 35 Storefront transactional files with 313 tests. Backend coverage
is 91.44% statements, 84.81% branches, 95.62% functions, and 91.46% lines;
Storefront baseline coverage is 94.22%, 86.73%, 96%, and 94.22%, respectively,
while transactional coverage is 83.28%, 76.09%, 85.76%, and 83.37%. The
production Backend/Admin build and frozen packaged install pass with the
patched S3 provider and without SendGrid. The 330-file Admin bundle measures
1,807,795 gzip bytes for its main file and 2,388,226 gzip bytes total. The
production dependency audit retains only the three documented ignored moderate
findings; Trivy reports zero high/critical dependency, misconfiguration, or
secret findings.

Privacy-request persistence intentionally remains policy-gated: the current
route delivers the request to the monitored privacy mailbox with a generated
request ID but does not create another long-lived PII copy. Add a protected
audit store only after counsel/client approves its fields, access rules,
retention, deletion, and breach-response policy. Exact Railway inspection also
found the public staging Meilisearch service domain; removing it changes
staging service state and remains the explicit environment action recorded in
the application-security checklist.

## Trusted Types report-only and carousel control hardening

- [x] Send a document-only Trusted Types report-only policy, advertise one
      same-origin collector, and leave the enforced CSP unchanged.
- [x] Bound and validate legacy CSP plus Reporting API envelopes while
      discarding URLs, samples, browser data, and all other unneeded payload
      fields before metrics or structured logs.
- [x] Remove the Radix Select and Splide HTML-string sinks, render semantic
      carousel controls with 44 px mobile and 48 px desktop targets, and keep
      the controls available as a non-drag interaction.
- [x] Patch the pinned Stripe loader to create Trusted Script URLs only for its
      two exact supported URLs, and fail the production build if the named
      policy is absent from any emitted Stripe loader asset.
- [x] Keep only exact, source-bounded classifications for the two understood
      React/Next framework events; reject every other browser violation in the
      production-artifact acceptance suite.

Complete local acceptance passes the 1,227-file Biome, strict typecheck, API
contract, IaC, framework-boundary, and repository verifier gate. Storefront
coverage passes 134 baseline files with 797 tests at 94.24% statements, 86.73%
branches, 96.02% functions, and 94.24% lines, plus 35 transactional files with
313 tests at 83.28%, 76.09%, 85.76%, and 83.37%, respectively. All 264 Backend
suites and 2,007 tests pass at 91.44%, 84.81%, 95.62%, and 91.46%. Both
production builds pass; the Storefront scan verifies 127 client assets and the
named Stripe policy.

The final responsive production-artifact matrix passes 54 tests with two
intentional project exclusions, and the critical Chromium, Firefox, and WebKit
matrix passes all 21 flows. Mobile Chrome passes all eight Pixel 7 and compact
phone legal/accessibility route checks without overflow, undersized standalone
controls, or axe violations; pa11y reports no WCAG 2 AA violations and
Lighthouse passes all four routes. The final 1,366 px desktop and 412 px Pixel
7 screenshots were inspected from real production browser rendering at
`/tmp/remorseless-carousel-desktop-final.png` and
`/tmp/remorseless-carousel-pixel-7-final.png`; the controls measured 48 px and
44 px, respectively, and remained visible and unobstructed.

The production audit retains only the three documented ignored moderate
advisories. Trivy reports zero high/critical dependency or secret findings, and
the generated CycloneDX/license pair verifies 2,517 components, 2,518
dependency entries, 16 license groups, and 1,007 production packages. Trusted
Types enforcement remains blocked on the documented clean staging observation
window; report-only coverage is the safe rollback-free boundary for this
slice.

## Catalog and notification persistence boundary hardening

The next post-migration boundary tranche removes four copies of an unchecked
generic catalog-service dispatcher. One bounded adapter now accepts only a
small unique list of valid method names, preserves the service receiver, uses
the supported generated-name fallback, returns `unknown`, and distinguishes a
missing runtime capability from a provider failure. Store and Admin callers
must pass its result through the existing catalog persistence projections
before using it.

Catalog seeding now validates complete shelf rows, unique handle results,
creation versions, existing memberships, every new membership acknowledgement,
and the metadata/version update acknowledgement. Homepage-copy reconciliation
validates every source row and requires an exact, version-incremented update
acknowledgement before performing its independent readback. The managed-media
migration uses Medusa's actual file-module interface, sends the documented
base64 public-upload DTO, and validates the returned file identity and URL
before writing resumable state. Catalog profile, shelf, transaction, source
metadata, and discography projections use the shared record readers rather
than repeated structural assertions.

Notification delivery now proves that the runtime service exposes both durable
listing and redaction-update capabilities before sending. It validates the
create acknowledgement, exact idempotency-key readback, retained-data update,
and final retrieval without trusting a widened service cast. Eleven focused
catalog, media, notification, route, and maintenance suites pass all 164 tests
with strict Backend TypeScript and Biome. The dated debt item remains open for
the remaining Storefront and service-container projections.
Complete local acceptance passes the 1,229-file repository QA gate and all 265
Backend suites / 2,017 tests at 91.44% statements, 84.81% branches, 95.62%
functions, and 91.46% lines.

## Storefront projection and JSON-default boundary hardening

Shipping-option reads no longer widen provider records into Medusa's complete
shipping type. The Storefront validates bounded pagination, unique canonical
IDs, names, price modes, amounts, inventory state, and optional descriptions,
then returns an application-owned allowlist. Provider IDs, service zones,
metadata, and every other upstream field are discarded before the checkout
route receives the options. Calculated prices must still return the exact
requested option identity.

Checkout payment inspection now rebuilds Stripe-session projections from a
canonical session ID, finite amount, three-letter currency, bounded provider
and status, and structured data. The customer checkout projection retains only
provider, status, and validated data needed for its state machine. Cart
snapshots use an explicit runtime assertion contract after validating the USD
cart, bounded amounts and quantities, unique items, complete Product/Variant
relationships, and inventory policy. Music-release structured data reads only
valid ISO publication or creation timestamps.

The last production double assertion was Medusa DML's object-only TypeScript
definition for JSON defaults applied to the intentionally array-shaped
`tracklist` column. The pinned `@medusajs/utils` declaration now broadens only
the JSON property's `default` input to accept arrays, matching Medusa's runtime
and PostgreSQL JSONB without widening the model's stored field type. A native
`Array` remains the runtime and database default; a model-metadata test pins
`Array.isArray`, the exact native prototype, and JSON serialization. Six
focused Storefront suites pass 132 tests, the model regression passes, and
strict TypeScript plus Biome are clean. No production `as unknown as` escape
hatches remain in Backend or Storefront source. The dated debt item remains
open for service-container declarations and test-only fixtures that do not
cross a production provider boundary.

Complete local acceptance passes the 1,230-file repository QA gate, all 266
Backend suites / 2,018 tests at 91.44/84.81/95.62/91.46 coverage, 134
Storefront baseline files / 797 tests at 94.28/86.77/96.02/94.28, and 35
transactional files / 313 tests at 83.35/75.98/85.81/83.43. This tranche
changes server-side validation and response projection only; it does not alter
rendered layout or interaction behavior.

## Service-container resolution hardening

Backend workflows, routes, subscribers, catalog operations, maintenance
scripts, and Meilisearch transforms now declare their expected service port at
the Medusa/Awilix resolver call. Catalog, news, discography, query, logger,
file, fulfillment, store, event-bus, remote-link, and purpose-built narrow
service contracts no longer resolve an unknown value and widen it afterward.
The small transformer container ports expose the same typed resolver contract
as Medusa's pinned container while retaining optional registration detection.

Repository QA now scans every production Backend TypeScript file and fails if
a container or request-scope lookup is followed by a type assertion. This pins
the declaration at the dependency-injection boundary and prevents a future
refactor from silently restoring post-resolution widening. Production runtime
behavior is unchanged; the improvement is compile-time boundary ownership and
an explicit regression gate.

Complete local acceptance passes the 1,231-file repository QA gate, including
the new 440-file production resolver scan, all 266 Backend suites / 2,018 tests
at 91.44/84.81/95.62/91.46 coverage, strict TypeScript, and the complete
Backend production build with its frozen packaged-server dependency install.

## Provider payload and persisted-state decoding

Meilisearch maintenance no longer treats successful response JSON as the
caller's requested generic type. Task responses now retain only a non-negative
safe task id, while index listings enforce a 1,000-row cap, canonical unique
identities, and valid ISO creation timestamps before cleanup logic sees them.
Malformed success payloads fail closed and have dedicated regression coverage.

The Big Cartel media migration now reconstructs its entire persisted checkpoint
from unknown JSON. Schema and normalizer versions, row limits, timestamps,
source-key identity, credential-free HTTP(S) URLs, unique original URLs, SHA-256
digests, supported MIME types, file keys, byte sizes, and dimensions are all
validated before any resume operation. Checkout receipt grants likewise rebuild
signed payloads from a record plus exact numeric primitives instead of trusting
a partial type assertion.

Admin upload errors, news actor lookups, product import metadata and rows,
catalog command hashing, Meilisearch settings, invite-email data, catalog search
variants, Storefront cookie preferences, product metadata, cart import metadata,
slugs, and search normalization now use the shared unknown-record boundaries.
This removes duplicated permissive object casts and consistently rejects arrays
where keyed records are required. The component changes affect data validation
only and do not alter rendered layout or interaction behavior.

Complete local acceptance passes the 1,232-file repository QA gate, 267 Backend
suites / 2,021 tests at 91.44/84.81/95.62/91.46 coverage, 134 Storefront
baseline files / 797 tests at 94.25/86.65/96.02/94.24, and 35 transactional
files / 313 tests at 83.37/76.02/85.81/83.46. Seven focused Backend suites pass
25 tests, eight focused Storefront files pass 65 tests, both strict TypeScript
projects pass, and both production builds complete with the client secret and
Stripe Trusted Types scanner green.

## Admin response and Store product projection boundaries

The legacy catalog authoring and merchandising workspaces now use the shared
Admin SDK request client instead of direct generic `fetch` wrappers. Every
request inherits the existing timeout, caller-cancellation, HTTP error, and
invalid-response handling. Products, variants, profiles, artists, references,
bundles, shelves, shelf products, lists, and lifecycle acknowledgements are
projected through bounded Zod contracts that reject invalid enums, timestamps,
counts, foreign shelf identities, and duplicate record identities. Mutation
bodies are also passed as structured SDK data instead of manually serialized
JSON strings.

Discography rebuild pagination now decodes every Product and catalog record
before identity or projection work. The catalog authoring audit reconstructs
explicit callable service adapters after verifying every required method,
rather than returning an unchecked caller-selected generic type. Store product
visibility likewise requires each route to provide its exact row decoder, so
bundle, shelf, related-product, handle, and discography rows are validated and
allowlisted before they leave the shared visibility boundary. The old generic
row assertion is gone, and projection-specific failures retain their stable
error contract.

Complete local acceptance passes the 1,235-file repository QA gate and all 269
Backend suites / 2,027 tests at 91.44/84.81/95.62/91.46 coverage. Twelve focused
Backend suites pass 110 tests, strict Backend and Storefront TypeScript pass,
and the Backend production build completes with the frozen packaged-server
dependency install. These changes alter data decoding only; rendered layout and
interaction behavior are unchanged.

## Public catalog runtime regression and synthetic acceptance

The first Storefront browser failures after `1414f1d` were traced to the live
Backend rather than Playwright: the standard Store Product list returned 200
with 461 Products, while `/store/products/handles` and
`/store/catalog/shelves` returned 500 with a validated query-projection error.
The only Backend runtime change since the last healthy deployment had replaced
the `tracklist` JSON default with an `Array` subclass to satisfy Medusa's narrow
declaration. Medusa's model/query machinery requires the native JSON value.
The model again supplies a native array, and the pinned declaration patch
removes the need for a runtime-altering workaround or type escape hatch.

The external staging operations monitor now performs authenticated, bounded
reads of both public catalog projections in addition to operations health and
readiness. It fails on transport errors, non-200 responses, malformed or
duplicate identities, an empty Product feed, empty shelves, or zero visible
shelf memberships. Retained JSON/Markdown evidence contains only HTTP status
and aggregate counts; Product IDs, handles, titles, response bodies, and the
publishable key are never retained. The release and observability runbooks now
make these projections an explicit release and P1 incident boundary.

Complete local acceptance passes the 1,235-file repository QA gate, all 269
Backend suites / 2,027 tests at 91.44% statements, 84.81% branches, 95.62%
functions, and 91.46% lines, 134 Storefront baseline files / 797 tests at
94.25/86.65/96.02/94.24, and 35 transactional files / 313 tests at
83.37/76.02/85.81/83.46. Focused acceptance includes all 34 model, route, and
visibility tests plus six external-monitor tests. Strict Backend and Storefront
TypeScript, Biome, the complete Backend production build with frozen packaged
dependencies, and the Storefront production build with its client-secret and
Stripe Trusted Types scanner are green. Deployed endpoint and browser evidence
follows on this section's exact release SHA.

## Admin native browser type boundary

The Backend TypeScript project now declares DOM and iterable DOM libraries for
the Medusa Dashboard it compiles. Admin inputs, textareas, selects, buttons,
file lists, refs, focus restoration, scrolling, media queries, animation
frames, storage, location, document lookup, and HTML parsing use their native
browser contracts instead of widening through `unknown`. Dataset commands such
as rich-text actions and News publication intent are narrowed against explicit
allowlists before entering domain state.

The repository gate scans all 97 production Admin TypeScript files. It requires
the browser libraries and fails on double assertions or assertion bridges
rooted in `globalThis`, a React event target, or a ref. This prevents missing
compiler context from being hidden locally again while preserving runtime
guards for test or server contexts where a browser service can be absent.

The slice changes types and event-boundary access only. It does not alter
rendered layout, copy, focus order, or motion, so existing Admin visual
acceptance remains applicable.

Complete local acceptance passes the 1,236-file repository QA gate, its new
97-file Admin browser-boundary scan, all 269 Backend suites / 2,027 tests at
91.44/84.81/95.62/91.46 coverage, both strict TypeScript projects, and the
complete Backend/Admin production build with a frozen 1,085-package server
install.

## Deterministic pre-deploy provider acceptance

Storefront CI previously built its local Next server with the live staging
Backend URL. That became a cyclic gate when a Backend catalog correction was
ready to release: Railway correctly waited for GitHub checks, Browser Smoke
tested the previous Backend deployment, and the resulting browser failure kept
Railway from deploying the correction. The four failed mobile journeys in
Storefront CI run `33374906692` were this release-control defect, not a new
Storefront rendering regression; every other job in the run, including
accessibility and Lighthouse, passed.

Browser Smoke now starts a loopback-only deterministic Medusa read fixture
before `next build`. The fixture owns one music release and the exact Product,
Product-handle, shelf, collection, region, discography, and news projections
used by the responsive and cross-browser journeys. It requires one fixed
non-secret CI publishable key, accepts only `GET` and `HEAD`, sends no-store and
defensive response headers, bounds its server timeouts, and fails closed for
unknown routes. Both Playwright configurations also declare the fixture as a
web server so local runs cannot accidentally fall back to staging.

The repository gate tests the fixture responses and pins the workflow plus both
Playwright configurations to it. Live provider health remains a separate
post-deploy requirement: the staging operations monitor must authenticate to
the exact Railway Backend and reject empty or malformed Products, handles,
shelves, memberships, or discography. This separation preserves both a
deterministic pre-deploy artifact gate and an authoritative live synthetic
check without weakening Railway's `checkSuites` hold.

Local acceptance passes the 1,239-file repository gate, the three fixture and
release-wiring tests, strict Storefront TypeScript, and the production
Storefront build with all 127 client assets clear of server secrets. The
responsive Chromium matrix passes 54 journeys with two intentional project
exclusions, and the critical Chromium, Firefox, and WebKit matrix passes all 21
journeys. The browser rerun also removed an existing mobile pagination race:
the test now accepts automatic advancement beyond the first 60 results and
proves the offset-60 request plus a monotonic loaded count instead of requiring
one transient label. Storefront coverage remains 94.25/86.65/96.02/94.24
across 134 baseline files and 797 tests, and 83.37/76.02/85.81/83.46 across 35
transactional files and 313 tests.

## Catalog and scheduler production-shape recovery

Exact release `039600387dd7ebafdd5093ed9574faddf92cbca1` passed Root GitHub
run `33377766721`, Backend run `33377766746`, and Storefront run
`33377766736`, including the 54-journey responsive matrix, 21-journey critical
cross-browser matrix, Pa11y, and Lighthouse. Railway Backend deployment
`0ee3d0fb-1868-470c-ace0-f03e188f5a37` and Storefront deployment
`009facee-dd15-4555-b961-b100b29e4b00` also succeeded at that exact SHA. The
release was not accepted: authenticated live reads found 461 standard Products
and 442 discography entries, while the Product-handle and shelf projections
returned HTTP 500 and `/health/operations` returned fail-closed HTTP 503.

Read-only production-shaped diagnostics identified four transport/runtime
contracts rather than catalog-data corruption:

- PostgreSQL returns the numeric `tax_provider_quotas.usage_percent` as a
  decimal string. The quota projection now normalizes a finite 0–100 number at
  the persistence boundary and rejects values outside the invariant.
- A cart may legitimately have no payment collection before checkout begins,
  while Medusa can represent a populated singleton relation as either a record
  or a one-element array. Reconciliation now accepts exactly those shapes and
  rejects ambiguous multi-row relations.
- Medusa 2.18 does not apply Query Graph `take` to this link projection unless
  pagination is activated by `skip` or `cursor`. The initial sales-channel
  link page now sends `skip: 0`, retaining the 101-row fail-closed decoder and
  keyset cursor for subsequent pages.
- Medusa auto-discovers every direct source module under a custom module's
  `models`, `repositories`, and `services` directories. Co-located Jest modules
  made directory import fail before repository-manager injection, leaving the
  Catalog service's base repository without a manager. Those tests now live
  outside runtime-discovery directories, and a repository test prevents any
  direct `test` or `spec` module from returning there.

No staging row was changed. A local Medusa process against a read-only staging
database connection restored the Catalog repository manager, returned a
bounded 100-handle page with a continuation cursor, and listed all three
shelves. The operations monitor now validates the standard Product list and
discography projection as well as handles and shelves, retaining only bounded
status and aggregate-count evidence. The existing 24-hour scheduler incident
latch remains authoritative; recovery requires healthy real job heartbeats and
the full observation window, never synthetic or manual latch deletion.

Complete local acceptance passes the repository QA gate and all 270 Backend
suites / 2,033 tests at 91.46% statements, 84.87% branches, 95.62% functions,
and 91.48% lines. Strict Backend and Storefront TypeScript, six external
operations-monitor tests, focused production-shape tests, and the complete
Backend/Admin production build with its frozen packaged-server install are
green.

Corrected release `f271f1bb24a6f0145e561e0be3bff715ae365034` passed Root
GitHub run `33382962642`, Backend run `33382962660`, and Storefront run
`33382962647`. Railway Backend deployment
`8848c273-9750-43b3-b70d-b0eb126e7ac3` waited for those checks and succeeded;
the unchanged Storefront correctly skipped deployment. `/live` and `/ready`
returned 200 on the exact Backend SHA. Authenticated bounded reads returned 461
Products, 442 discography entries, one requested handle, three shelves, and 25
shelf memberships. Three ordinary two-minute reconciliation runs completed
with no failed, held, capped, or unreleased-lock state, and the ordinary
five-minute quota schedule emitted no persistence/synchronization error. The
latest scheduler failure cleared without synthetic state; operations now
reports only the deliberate 24-hour `scheduler_incident_latched` reason.

Manual external-monitor run `33384744955` independently retained those same
catalog counts, healthy dependencies, the exact SHA, and only the latch reason.
It also exposed a report-delivery defect: the alert-issue step treated the
artifact directory output as the report file, then substituted the generic
`observation_evaluation_failed` fallback. The workflow now joins that directory
with `observation.md`, and its repository test prevents the ambiguous parameter
expansion from returning. Exact workflow acceptance and the no-recurrence
observation window remain open; the catalog/runtime corrections themselves are
accepted.

## Production parsed-response boundary closure

The dated ESLint unsafe-TypeScript baseline is now closed at the production
boundary rather than recreated as a second linter beside Biome. Every
production Backend and Storefront TypeScript file is scanned for explicit
`any`, double assertions, asserted `Response.json()` or `JSON.parse()` values,
direct parsed-value decoder arguments, and unbounded parsed-value returns.
Decoded JSON is first held as `unknown`, then validated or projected. The gate
is part of `qa:lint` and currently covers 713 production files; tests and
fixtures remain governed by strict TypeScript and Biome without being confused
with runtime provider trust boundaries.

News list/detail payloads now enforce bounded fields, publication state,
timestamps, unique ids/slugs, exact requested pagination, and an application
allowlist that discards persistence metadata. Discography pages enforce bounded
enums, timestamps, totals, stable counts, and unique identities across pages.
Bundle composition validates every nested identity, quantity, component,
availability option, declared count, and derived unavailable state. Product
list/detail reads validate bounded records, nested runtime shapes, counts, and
unique ids/handles before Storefront BFF, cache, search, quick-view, or prefetch
consumers receive them. Public form errors retain only a bounded message or
Problem detail and otherwise use neutral fallback copy.

The closure also routes every remaining persisted JSON, health snapshot,
checkout response, Admin draft/upload response, filter/search response, tax
cache value, and migration checkpoint through an explicit `unknown` boundary
before its existing decoder. Focused response, route, cache, checkout, and
Admin regression tests, both strict TypeScript projects, and the production
boundary verifier pass. The product decoder is isolated in a client-safe shared
contract so browser query consumers cannot pull `server-only` data adapters
into their bundle.

Complete local acceptance passed the 1,270-file repository Biome, policy, and
strict TypeScript gate; all 273 Backend suites / 2,064 tests at 91.58%
statements, 85.31% branches, 95.78% functions, and 91.58% lines; all 139
Storefront baseline files / 828 tests at 94.37%, 86.06%, 95.83%, and 94.39%;
and all 36 transactional files / 322 tests at 83.73%, 76.50%, 85.81%, and
83.86%. Both production builds pass, including the frozen 1,085-package Backend
server install and the Storefront scanner proving 130 client assets contain no
server-only secret or public Meilisearch input. These changes affect decoding
and failure behavior only; they do not alter rendered layout or interaction
behavior, so no new visual screenshot was required for this section.

## Dependency supply-chain cooling closure

All three pnpm workspace entry points now enforce an explicit seven-day
(`10080` minute) release-age window. Strict resolution is enabled, missing
registry publication times fail closed, frozen lockfiles are rechecked rather
than trusted implicitly, and exotic transitive Git/tarball sources are
blocked. The Backend packager carries the same values into
`.medusa/server/pnpm-workspace.yaml` and refuses to render a weakened policy,
so the production-only install cannot silently shed the repository controls.

The previous `minimumReleaseAgeExclude` inventory contained 152 exact
selectors. Registry publication-time review showed that 151 had already aged
past the full window and needed no exception. The remaining exception is the
exact `@railway/cli@5.45.0` release: it cannot float, and its downloader is
locally patched to verify reviewed immutable release digests before archive
extraction. Biome 2.5.11 and Sharp 0.35.4 were still inside the window, so they
were moved to the newest mature releases, 2.5.10 and 0.35.3, instead of being
added as bypasses.

`scripts/security/dependency-supply-chain-policy.json` is the reviewed
exception manifest. Its verifier rejects non-exact cooling selectors, missing
evidence, policy weakening, configuration drift across workspaces, unreviewed
audit ignores, or removal of the required CI checks. The three remaining pnpm
audit ignores are limited to the Medusa-compatible React Router 6 backports;
each is tied to exact patched packages and the production-artifact behavioral
verifier. Root, Backend, and Storefront security jobs all execute both policy
checks.

Local acceptance passed the frozen 1,822-entry root install, the focused
policy and Backend packager suites, all 273 Backend suites / 2,065 tests at
91.58% statements, 85.31% branches, 95.78% functions, and 91.58% lines, all
139 Storefront baseline files / 828 tests at 94.37%, 86.06%, 95.83%, and
94.39%, and all 36 Storefront transactional files / 322 tests at 83.73%,
76.50%, 85.81%, and 83.86%. Both production builds passed. The generated
Backend server performed a policy-verified frozen install of 1,085 production
packages, and the Storefront scanner verified 130 client assets. The
production audit reports only the three documented ignored moderate findings
and no unreviewed moderate, high, or critical finding. This section changes
dependency resolution and packaging only, not rendered UI, so screenshot
validation was not applicable.

## Legal, accessibility, and launch acceptance

- [ ] Obtain qualified counsel/client approval for all legal page copy,
      jurisdiction coverage, retention periods, and operating procedures.
- [x] Verify exact-total checkout disclosures immediately before paid and free
      order submission.
- [x] Validate that only necessary cookies operate before consent and that
      optional telemetry/embeds follow stored consent and revocation.
- [x] Verify the signed privacy request path end to end through the Storefront
      BFF and expose only the opaque request reference to the customer.
- [ ] Staff and monitor the privacy/support delivery channels, and complete an
      operator response rehearsal without placing request PII in artifacts.
- [ ] Train support staff on shipping delay, cancellation, return, refund,
      dispute, privacy, and accessibility procedures.
- [x] Complete automated keyboard, focus, screen-reader semantics, contrast,
      target-size, reduced
      motion, and error-summary validation.
- [x] Capture and inspect automated real-browser screenshots for checkout,
      catalog, Product, cart, content/legal, privacy, confirmation, and
      recovery, plus real graphical-desktop Admin and Storefront Catalog
      captures.
- [x] Complete the remaining real graphical-desktop Storefront captures for
      checkout, Product, cart, content/legal, confirmation, and recovery.
- [x] Complete repeated Lighthouse budgets and production-like local
      performance testing across six representative routes.
- [ ] Obtain named business, legal, tax, support, security, and
      production-change sign-offs.

Final local graphical acceptance used the production Storefront build, the
loopback-only deterministic Medusa boundary, and a headed Chromium window on
the active desktop. Product, Terms, populated cart, ready free checkout,
confirmation, and recovery were each captured with Flameshot and inspected at
`/tmp/remorseless-storefront-desktop-{product,terms,cart,checkout,confirmation,recovery}.png`.
The six surfaces retained readable hierarchy, complete primary actions, and no
visible clipping, overlay collision, or horizontal document overflow. These
manual desktop captures complement the 14-case launch screenshots and browser
assertions; they do not replace them.

### Final launch and News compatibility acceptance — August 31, 2026

The launch gate was corrected without weakening its assertions. Initial launch
revision `9e6e8b7` introduced the complete matrix; `48a473e` isolated browser
acceptance from live providers; `5ff20fe` kept the external operations monitor
out of the release check suite; `014a751` reduced catalog startup work but
exposed a stale mobile filter definition; and `255903b` refreshed that
definition on intent. The accepted Storefront revision passed Root CI
`33462146850`, Backend CI `33462146807`, and Storefront CI `33462146792`.
Railway Storefront deployment `fe3169b7-b737-4bf8-80cb-29fba7a99736`
succeeded with image digest
`sha256:09a69d66f49d710fa21ff83a6ce9ea443e44a08dbfe7af0de7c933ded2dd8a05`.

Final News compatibility revision
`8e904890e949f9833cff4f1adaf9ff13f1512a73` preserves authored cover
alternative text and derives `<title> cover artwork` only for legacy records
that have a cover but no stored alternative. Admin and Store reads normalize
those legacy rows; alternative text without a cover still fails closed, every
new Admin write remains strict, and the seed path persists authored text. The
focused 64-test boundary suite, strict Backend TypeScript, repository Biome
gate, full 273-suite / 2,044-test Backend coverage gate, and Backend/Admin
production build all passed locally.

The exact revision passed Backend CI `33464166082`, Storefront CI
`33464166101`, and Root CI `33464166091`. Storefront CI passed 54 responsive
journeys with two expected skips, 14 launch journeys, all 21 critical journeys
across Chromium, Firefox, and WebKit, and Pa11y on `/about`, `/accessibility`,
`/cookies`, and `/terms`. Lighthouse artifact
`storefront-lighthouse-33464166101` has artifact ID `9784491753`, SHA-256
`307dd7563a9458496411c1bab8f28a40821e1ab0f7dacf18b69bb7a8f117c6f0`,
and 37 files.

Railway Backend deployment `1690f323-3358-47e7-b668-701a973ec2e4`
succeeded with image digest
`sha256:c5cda97578e78a96478396db869df428c5214be60e650e647500a1df2293dbbe`
and active instance `ddedcd4b-ed77-46b7-b4cf-857c3a7087f4`. The unchanged
Storefront deployment correctly reported `SKIPPED` with no watched-file
changes. Backend `/live` and `/ready`, Storefront `/live`, `/ready`, and
`/news`, Backend `/store/news`, and Storefront `/api/news` returned HTTP 200.
Both News APIs returned all six visible entries and proved every cover had
non-empty alternative text. A bounded 20-minute Railway log review found zero
Backend or Storefront HTTP 5xx responses and zero News/projection failures.
The sole Backend error-level record was Railway's successful release-prepare
command banner, not an application failure.

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
