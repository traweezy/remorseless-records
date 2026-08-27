# Production Hardening Plan

Last verified: August 26, 2026

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
  `2818d6540aa0f7f200d3c7e81e39b48d3c860b2d`.
- Latest documentation-only staging SHA accepted:
  `6fed27f6140bef24c193272658312a3887483867`.
- Railway project: `store`; only the `staging` environment exists.
- Application acceptance Backend deployment:
  `3eae1057-6432-4218-a7e6-8334345b4d7d` (`SUCCESS`).
- Application acceptance Storefront deployment:
  `87da9b5b-bce1-4d0c-a9b7-b752e57543a4`
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

## Active slice: correlated API problems and request observability

- [x] Inventory 25 Storefront and 55 Backend custom route handlers, existing
      envelopes, request-ID handling, trace propagation, logs, contracts, and
      tests. No OpenAPI document existed and only eight files emitted
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
- [ ] Convert the remaining handler-specific custom Backend error envelopes
      without changing the native Medusa envelope consumed by the Admin SDK.
- [ ] Add a supported Storefront request-completion timing hook. The Next proxy
      can correlate every response but cannot observe final route status and
      duration.
- [ ] Add dynamic request correlation at Medusa's early Express loader.
      Framework-owned Admin static responses and built-in pre-router failures
      receive the patched static security/cache headers but bypass project API
      observability middleware.
- [ ] Complete the authentication, authorization, timeout, provider, and
      unexpected-error contract matrix across both boundaries and enumerate all
      custom endpoint responses in generated or contract-first OpenAPI.
- [x] Deploy only through `staging`, and repeat exact-SHA CI, Railway, route,
      log, and browser acceptance before advancing.

Current local evidence: the OpenAPI 3.1 YAML parses and exposes the required
`ApiProblem` schema; release-policy, private-artifact, framework-header,
Storefront ESLint, and both strict typecheck gates pass. All 165 Backend suites
with 882 tests and all 109 Storefront suites with 571 tests pass. Storefront
coverage is 93.82% statements, 86.15% branches, 94.55% functions, and 93.80%
lines. Both production builds pass; the Admin main bundle is 1,798,873 gzip
bytes and the total is 2,393,961 gzip bytes, both within budget. The production
audit reports only the three documented ignored moderates, and both extract-zip
containment and React Router backport verifiers pass. During the full-suite
repeat, 16 existing call assertions exposed the new correlation argument; the
tests now prove that each route forwards its exact request context instead of
loosening the propagation contract.

Review discovery: the earlier Medusa response-boundary work established that
framework-owned `/app` and built-in pre-router responses mount before project
API middleware. The static framework patch covers their security and cache
headers, but the new request-dependent IDs and completion timing cannot be
supplied by that static map. This slice therefore scopes Backend correlation to
responses traversing project API middleware and records the earlier dynamic
framework seam as remaining work rather than overstating coverage.

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

- [x] Protect `staging` and `master` according to the release runbook; require
      pull requests and conversation resolution on `master`, and block
      force-push/delete on both long-lived branches.
- [ ] Consolidate duplicate GitHub deployment environments and add environment
      protection rules for production.
- [ ] Enable Dependabot security updates or document an equivalent owned
      remediation SLA.
- [x] Complete exact-SHA CI acceptance for the six remediated active CodeQL
      alerts; the stranded legacy search-analysis alert is evidence-dismissed.
- [x] Mitigate `GHSA-jmr9-qjv8-65gv` in `extract-zip` with fail-closed symlink
      containment, a malicious-archive regression gate, and explicit denial of
      Puppeteer browser-download install scripts.
- [ ] Remove the local `extract-zip` patch and the vulnerable package version
      when Pa11y/Lighthouse ship a reviewed fixed chain or can be replaced
      without losing accessibility and performance coverage.
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
- [ ] Scan final runtime images, generate image-linked SBOM/provenance, and sign
      or attest the deployed artifacts.
- [ ] Move hardened-runner egress from audit mode to an explicit allowlist after
      observing required endpoints.
- [ ] Add a real dependency cooling window and keep only narrowly justified
      security exceptions.
- [ ] Plan isolated compatibility upgrades for Medusa, Next.js, TanStack,
      Stripe, AWS SDK, and other outdated dependency families.

Discovery: GitHub Dependabot alerts `27` and `28` classify the same
`GHSA-jmr9-qjv8-65gv` / `CVE-2026-56876` high-severity development-only
`extract-zip@2.0.1` symlink path-traversal risk. Alert `27` tracks the root
lockfile occurrence; alert `28` was created when the behavioral verifier made
that already-transitive package explicit in `package.json`. The package is
installed only for browser QA by `@puppeteer/browsers` through Pa11y and
Lighthouse, not into either deployed application, and GitHub currently lists
no patched `extract-zip` version. Production-only pnpm audit and the Trivy
source scan remain clean of high/critical findings; that does not close or
dismiss either development-tooling alert. The checked mitigation contains the
current behavior; the separate removal item remains open until the parent chain
can be upgraded or replaced so the vulnerable package version leaves the
lockfile.

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
