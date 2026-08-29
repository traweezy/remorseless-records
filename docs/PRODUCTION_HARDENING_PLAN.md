# Production Hardening Plan

Last verified: August 29, 2026

This is the authoritative launch-readiness backlog for Remorseless Records. It
supersedes the local `tmp/HARDENING_NEXT_STEPS.md` working note. Detailed
operating procedures remain in the linked runbooks and ADRs; this document
tracks what is still required before production traffic is approved.

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
- After each push, watch all GitHub Actions jobs and the affected Railway
  staging deployments to `SUCCESS`, then run health, route, API, log, and
  browser validation before beginning another slice.
- Do not change production traffic, paid services, credentials, domains,
  replicas, data, or destructive migrations without explicit approval.

## Verified baseline

- Git branches: `staging` is the default/integration branch; `master` is the
  protected production-candidate branch. Retired `main` was deleted.
- Latest application-changing staging SHA accepted:
  `64a2253842acf054e3e643c9ad12468def5c18b4`.
- Latest documentation-bearing staging SHA accepted:
  `64a2253842acf054e3e643c9ad12468def5c18b4`.
- Railway project: `store`; only the `staging` environment exists.
- Application acceptance Backend deployment:
  `2e7a3db4-f7fc-4e5a-b1a8-c46c44ac4dfa` (`SUCCESS`).
- Application acceptance Storefront deployment:
  `e089254d-b479-4588-8b46-f13fedaf0529`
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

Trusted Types enforcement is not included in this slice. Stripe dynamically
loads additional approved scripts and documents the need for a compatible
default policy when Trusted Types are required; Next and every checkout path
must first pass a report-only staging rollout. That follow-up remains below
rather than introducing an untested production-enforced policy.

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
caller cancellation, safe error classification, Meilisearch signal forwarding,
request-bound news timeout propagation, and provider-detail redaction. The
generated OpenAPI check inventories all route sources deterministically and is
wired into both the repository lint gate and Root CI.

Current local gate evidence: repository lint and policy checks plus both strict
typechecks pass. Backend passes 964 tests across 182 suites. Storefront passes
633 tests across 119 files with 93.09% statement, 85.77% branch, 93.77%
function, and 93.04% line coverage. Both production builds pass, including the
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
- [ ] Configure a separate staging Stripe lifecycle webhook secret and the
      `/webhooks/stripe/lifecycle` endpoint.
- [ ] Exercise signed, duplicate, delayed, out-of-order, queue-failed, refund,
      repeated-partial-refund, and dispute events.
- [x] Prove in code that an ambiguous response loss after durable cart/order
      completion is re-read and does not make a second completion attempt.
- [ ] Exercise the same response-loss recovery against a disposable Stripe
      test-mode checkout in staging and verify one PaymentIntent and one order.
- [ ] Complete the exact-amount, success, 3DS, decline, browser-close,
      response-loss, duplicate-submit, concurrency, and recovery matrix in
      `docs/CHECKOUT_OPERATIONS.md`.
- [ ] Verify confirmation email, receipt, Medusa order, Stripe PaymentIntent,
      and tax evidence agree.
- [ ] Complete the refund and dispute reconciliation matrix in
      `docs/REFUND_OPERATIONS.md`.
- [ ] Keep all payment traffic in Stripe test mode until a separate production
      change is approved.

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

- [x] Replace Storefront production `script-src 'unsafe-inline'` with a
      nonce/hash policy; set `base-uri 'none'` and evaluate Trusted Types.
- [x] Remove unused sample S3 and direct Unsplash browser origins from the
      production allowlist; permit only exact HTTPS `images.unsplash.com`
      through the same-origin Next Image optimizer for version-controlled seed
      data.
- [x] Add global Backend/Admin HSTS, CSP, `nosniff`, frame, referrer,
      permissions, and cache headers.
- [ ] Run Trusted Types in report-only mode across Storefront navigation and
      checkout, define the narrow Stripe-compatible policy if violations are
      understood, and enforce only after browser acceptance.
- [x] Add App Router `error.tsx` and `global-error.tsx` boundaries with safe,
      observable recovery UX.
- [x] Validate strong, distinct JWT, cookie, cart, checkout-BFF, receipt,
      public-form, and configured webhook secrets at production startup.
- [ ] Document and exercise remaining JWT and direct Stripe webhook rotation;
      cart, checkout-BFF, receipt, and public-form prior-key verification is
      implemented and bounded.
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
- [x] Replace the all-product handles scan with bounded keyset pagination,
      published-status filtering, and publishable-key sales-channel filtering.
- [x] Verify every public helper applies published-status and publishable-key
      sales-channel boundaries.
- [ ] Add outbound deadlines, cancellation, bounded retries, and redacted
      provider errors for content, search, email, Stripe, tax, storage,
      contact, and privacy calls. Contact/privacy Backend and Resend deadlines
      are complete; the other provider families remain.
- [x] Harden malformed cookie decoding so invalid percent encoding cannot throw
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
- [x] Move Storefront Redis to the Railway private service reference and prove
      exact-deployment port-6379 service flows complete without drops.
- [ ] Remove public Redis and PostgreSQL TCP proxies unless a reviewed,
      encrypted administrative path requires them.
- [ ] Put MinIO Console behind private access/SSO or remove its public domain.
- [ ] Configure PostgreSQL backups/PITR and perform a timed restore drill.
- [ ] Configure off-site media backup and verify object checksums and restores.
- [ ] Document Redis recovery semantics and Meilisearch rebuild/snapshot
      recovery.
- [ ] Set and test a capacity-aware Redis memory ceiling and compatible
      persistence/eviction policy; staging currently reports `maxmemory=0` and
      `noeviction` with zero evictions and zero server latency events.
- [ ] Pin Redis, PostgreSQL, MinIO, and Meilisearch images by tested version and
      immutable digest; remove floating `latest` tags.
- [ ] Enable `pg_stat_statements`, slow-query logging, I/O timing, and relevant
      database/volume metrics with an overhead budget.
- [ ] Define availability, latency, recovery-time, and recovery-point goals
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
- [x] Remove the two CodeQL-reported post-build file rewrite races with
      same-descriptor, no-follow regular-file updates and symlink regression
      coverage.
- [ ] Complete the broader custom Backend post-build dependency install/patch
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
- [ ] Add a real dependency cooling window and keep only narrowly justified
      security exceptions.
- [ ] Update or replace the pinned Shai-Hulud detector action when an upstream
      release declares a supported Node 24 action runtime; GitHub currently
      forces its deprecated Node 20 action runtime onto Node 24 and annotates
      all three otherwise-successful workflows.
- [ ] Plan isolated compatibility upgrades for Medusa, Next.js, TanStack,
      Stripe, AWS SDK, and other outdated dependency families.

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

- [ ] Remove or classify Railpack npm wrapper warnings and successful pnpm
      command banners currently recorded at error severity so deployment-log
      alerts remain actionable.
- [x] Correct the misleading blank Storefront `api.problem` display record and
      add a tested exact-request-ID Railway verifier that fails when correlated
      events disappear or their deployment/correlation fields mismatch.
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
