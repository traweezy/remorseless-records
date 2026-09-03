# Dependency Migration Audit — 2026-07-23

This audit covers the dependency refresh begun in commit `a697093` and
completed in commit `578ad0e`. The review used upstream migration guides,
release notes, published peer ranges, and the installed Medusa package
contracts.

## Follow-up refresh — 2026-07-25

The registry and GitHub Actions were checked again on July 25. Compatible
releases were updated in isolated CI, backend, storefront UI, and storefront
framework/test commits. Each application chunk passed its own lint, strict
typecheck, tests, peer check, security audit, and production build before the
next chunk began.

| Dependency                   | Change            | Upstream finding                                                                                                                                                                                                                                                     | Repository action                                                                                                                                                                                          |
| ---------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TruffleHog Action            | 3.95.9 → 3.96.0   | [v3.96.0](https://github.com/trufflesecurity/trufflehog/releases/tag/v3.96.0) adds detectors, fixes GitLab caching and clone retries, and updates its embedded `go-git` dependency for security. The Action inputs used here are unchanged.                          | Updated all three verified-secret scan jobs.                                                                                                                                                               |
| AWS SDK S3 / core            | 3.1093 → 3.1095   | The [3.1095 comparison](https://github.com/aws/aws-sdk-js-v3/compare/v3.1093.0...v3.1095.0) includes revised clock-skew correction. AWS deprecated `@aws-sdk/core` 3.977.0 for incorrect JSON exponent handling and published 3.977.1 as its compatible replacement. | Updated the S3 client and set a workspace-wide 3.977.1 minimum. The built Medusa server resolves only the fixed core version.                                                                              |
| PostHog Node                 | 5.46.0 → 5.46.1   | [v5.46.1](https://github.com/PostHog/posthog-js/releases/tag/posthog-node%405.46.1) fixes V8 Promise-combinator stack-frame normalization without changing the SDK API.                                                                                              | Updated the direct SDK and Medusa peer resolution.                                                                                                                                                         |
| Radix UI                     | 1.6.5 → 1.6.7     | The current [Radix release notes](https://www.radix-ui.com/primitives/docs/overview/releases) cover accessibility, form-control, slider, overlay, and tree-shaking fixes in the active primitive line.                                                               | Updated the unified package and every exact primitive in the fresh-release allowlist. Browser tests exercised dialogs, drawers, checkboxes, selects, and the dual price slider.                            |
| Lucide React                 | 1.25.0 → 1.27.0   | [v1.26](https://github.com/lucide-icons/lucide/releases/tag/1.26.0) and [v1.27](https://github.com/lucide-icons/lucide/releases/tag/1.27.0) add icons and revise a small named set of existing glyphs.                                                               | Audited every storefront import; none of the revised glyphs are used. Updated the React type-isolation package extension.                                                                                  |
| PostCSS                      | 8.5.22 → 8.5.23   | The [8.5.23 comparison](https://github.com/postcss/postcss/compare/8.5.22...8.5.23) fixes source-map loading when `opts.from` is absent and updates dependencies.                                                                                                    | Updated the declared and enforced workspace minimum.                                                                                                                                                       |
| Next.js / Next ESLint plugin | 16.2.11 → 16.2.12 | The [16.2.12 comparison](https://github.com/vercel/next.js/compare/v16.2.11...v16.2.12) adds an opt-in TypeScript CLI backend for TypeScript 7, improves `paths` resolution without `baseUrl`, and replaces a TypeScript 7 crash with actionable guidance.           | Updated both matched packages. The TypeScript CLI backend remains disabled because the repository is on supported TypeScript 5.9; enabling it would add no value until the lint and Medusa blockers clear. |
| Playwright                   | 1.61.1 → 1.62.0   | [v1.62](https://github.com/microsoft/playwright/releases/tag/v1.62.0) adds cancellable operations, isolated retries, WebP screenshots, a new component-testing model, and Chrome 151.                                                                                | Enabled isolated retries in both configs, installed Chrome 151 locally, and passed all 28 desktop, Pixel 7, and iPhone 15 Pro smoke journeys.                                                              |
| Baseline Browser Mapping     | 2.11.1 → 2.11.3   | The [2.11.3 comparison](https://github.com/web-platform-dx/baseline-browser-mapping/compare/v2.11.1...v2.11.3) contains refreshed browser and feature data only.                                                                                                     | Updated the development data package; no application migration was required.                                                                                                                               |

## Supported migrations completed

| Dependency                  | Change       | Upstream migration finding                                                                                                                                                                                                                                                                                                                                    | Repository action                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js / `@types/node`     | 22 → 26      | [Node 26](https://nodejs.org/en/blog/release/v26.0.0) enables Temporal by default, updates V8 and Undici, and removes several deprecated internals.                                                                                                                                                                                                           | Pinned `.nvmrc` to 26.5.0 and audited the repository for removed `_stream_*`, `writeHeader`, and deprecated runtime APIs; none are used.                                                                                                                                                                             |
| pnpm                        | 11.9 → 11.17 | [pnpm 11.17](https://github.com/pnpm/pnpm/releases/tag/v11.17.0) republishes affected package-manager releases and includes security/authentication hardening.                                                                                                                                                                                                | Pinned all package manifests to 11.17.0 and regenerated the lockfile with supply-chain policy validation.                                                                                                                                                                                                            |
| Medusa                      | 2.17 → 2.18  | The [Medusa 2.18 release](https://github.com/medusajs/medusa/releases/tag/v2.18.0) changes the default database load strategy from `SELECT_IN` to `BALANCED` and broadens generated-service delete return types for composite primary keys. The official [update guide](https://docs.medusajs.com/learn/update) requires framework packages to move together. | Updated every backend and storefront `@medusajs/*` package as a matched set, audited generated-service delete consumers and query-count assertions, and aligned the admin runtime with React 18.3.1 and `@medusajs/ui` 4.2.0. No affected delete-result consumer or query-count snapshot exists in application code. |
| Zod                         | 3 → 4        | [Zod 4](https://zod.dev/v4/changelog) replaces instance error formatting helpers with top-level helpers and changes several schema APIs.                                                                                                                                                                                                                      | Replaced deprecated `error.flatten()` calls with `z.flattenError(error)` and verified record/error configuration call sites.                                                                                                                                                                                         |
| node-redis                  | 4 → 6        | The [v4→v5](https://github.com/redis/node-redis/blob/master/docs/v4-to-v5.md) and [v5→v6](https://github.com/redis/node-redis/blob/redis%406.0.0/docs/v5-to-v6.md) guides rename `disconnect()` to `destroy()`, require explicit error handling, and document RESP3/default timeout changes.                                                                  | Added an error listener, RESP3, a two-second connect timeout, bounded reconnect backoff, unknown-error narrowing, and `destroy()` cleanup while preserving in-memory fallback.                                                                                                                                       |
| Meilisearch JS              | 0.53 → 0.60  | [v0.57](https://github.com/meilisearch/meilisearch-js/releases/tag/v0.57.0) is ESM-only and renames `MeiliSearch` to `Meilisearch`.                                                                                                                                                                                                                           | Updated every runtime and diagnostic-script import. Search remains behind the validated server route.                                                                                                                                                                                                                |
| csv-parse                   | 5 → 7        | The [official changelog](https://csv.js.org/parse/changelog/) states that v7.0 was published as a major by mistake and has no breaking behavior; v6 improves generic inference.                                                                                                                                                                               | Removed a redundant result assertion and retained the supported delimiter/relaxed-column options.                                                                                                                                                                                                                    |
| ULID                        | 2 → 3        | [ULID v3](https://github.com/ulid/javascript/releases/tag/v3.0.0) removes AMD/script bundles and deprecated `factory`/`detectPrng` exports.                                                                                                                                                                                                                   | Audited usage; the backend only uses the supported named `ulid()` export.                                                                                                                                                                                                                                            |
| dotenv                      | 16 → 17      | dotenv 17 emits injection messages unless quiet mode is enabled.                                                                                                                                                                                                                                                                                              | Moved storefront usage to development dependencies, added the backend runtime dependency used by its initializer, and enabled `quiet: true` in automation scripts.                                                                                                                                                   |
| Stripe.js                   | 8 → 9        | [Stripe.js v9](https://github.com/stripe/stripe-js/releases/tag/v9.0.0) makes `elements.update()` asynchronous and removes legacy Source types.                                                                                                                                                                                                               | Audited imports and calls; neither removed Source APIs nor `elements.update()` are used. Checkout behavior was intentionally left unchanged.                                                                                                                                                                         |
| TanStack Pacer              | 0.15 → 0.21  | The current [debouncing guide](https://tanstack.com/pacer/latest/docs/guides/debouncing) retains `Debouncer`, `maybeExecute`, and `cancel`.                                                                                                                                                                                                                   | Audited the search pacing call site; no migration was required.                                                                                                                                                                                                                                                      |
| Immer                       | 10 → 11      | [Immer 11](https://github.com/immerjs/immer/releases/tag/v11.0.0) changes loose-iteration defaults and build targets.                                                                                                                                                                                                                                         | Audited Zustand middleware usage; drafts contain plain objects/arrays and do not rely on Map/Set or strict iteration.                                                                                                                                                                                                |
| Lucide React                | 0.x → 1      | [Lucide 1.0](https://lucide.dev/guide/version-1) removes brand icons and makes decorative icons hidden from assistive technology by default.                                                                                                                                                                                                                  | Verified every imported icon exists; brand marks come from Simple Icons.                                                                                                                                                                                                                                             |
| Simple Icons                | 13 → 16      | The [v14](https://github.com/simple-icons/simple-icons/releases/tag/14.0.0), [v15](https://github.com/simple-icons/simple-icons/releases/tag/15.0.0), and [v16](https://github.com/simple-icons/simple-icons/releases/tag/16.0.0) releases remove and rename icons.                                                                                           | Verified the used `siBandcamp` and `siInstagram` exports remain available.                                                                                                                                                                                                                                           |
| jest-dom                    | 6 → 7        | [jest-dom 7](https://github.com/testing-library/jest-dom/releases/tag/v7.0.0) requires Node 22+ and declares `@testing-library/dom` as a peer.                                                                                                                                                                                                                | Added the peer explicitly; Node 26 satisfies the runtime floor.                                                                                                                                                                                                                                                      |
| eslint-plugin-react-refresh | 0.4 → 0.5    | [v0.5](https://github.com/ArnaudBarre/eslint-plugin-react-refresh/releases/tag/v0.5.0) is ESM-first and exposes the flat-config plugin through the named export.                                                                                                                                                                                              | Migrated the flat ESLint config to `reactRefresh.plugin`.                                                                                                                                                                                                                                                            |
| Playwright                  | 1.56 → 1.61  | [Playwright releases](https://github.com/microsoft/playwright/releases) remove `page.accessibility`, component-testing selectors, `:light`, and several deprecated browser options across 1.57–1.60.                                                                                                                                                          | Audited config and tests; none of the removed APIs are used. Device projects remain the responsive validation source.                                                                                                                                                                                                |
| esbuild                     | 0.25 → 0.28  | [esbuild 0.27](https://github.com/evanw/esbuild/releases/tag/v0.27.0) raises supported OS floors and changes binary-loader behavior on older Node releases.                                                                                                                                                                                                   | Audited direct API/loader usage; the workspace has none and runs Node 26.                                                                                                                                                                                                                                            |
| Lefthook                    | 1 → 2        | [Lefthook 2](https://github.com/evilmartians/lefthook/releases/tag/v2.0.0) removes regex `exclude`, `skip_output`, and legacy CLI forms.                                                                                                                                                                                                                      | Audited `lefthook.yml`; removed keys are not used and `lefthook validate` passes.                                                                                                                                                                                                                                    |
| dependency-review-action    | 4 → 5        | [v5](https://github.com/actions/dependency-review-action/releases/tag/v5.0.0) moves to Node 24 and requires runner 2.327.1+.                                                                                                                                                                                                                                  | Updated all workflows; GitHub-hosted runners satisfy the required runner version.                                                                                                                                                                                                                                    |
| TruffleHog Action           | 3.91 → 3.96  | [v3.96.0](https://github.com/trufflesecurity/trufflehog/releases/tag/v3.96.0) retains the action interface and adds detector, retry, cache, and embedded dependency security fixes.                                                                                                                                                                           | Updated all secret-scan jobs while retaining verified-only scanning.                                                                                                                                                                                                                                                 |
| Shai-Hulud Detector Action  | 2.1 → 2.2.0  | The official [v2.2.0 release](https://github.com/gensecaihq/Shai-Hulud-2.0-Detector/releases/tag/v2.2.0) declares the supported Node 24 action runtime and retains configurable critical-finding, lockfile, and installed-module scan controls.                                                                                                                                        | Pinned all three security jobs to the resolved v2.2.0 commit, enabled fail-on-critical and lockfile scanning explicitly, disabled redundant installed-module scanning before install, and enforced the configuration with the CI runtime-security policy.                                                            |
| Harden-Runner               | 2 → 2.21.0   | [v2.21.0](https://github.com/step-security/harden-runner/releases/tag/v2.21.0) uses Node 24 and includes the DNS-over-HTTPS bypass remediation introduced in the supported 2.16+ line.                                                                                                                                                                                                | Pinned all five hardened jobs to the exact mature commit, replaced audit mode with reviewed per-workflow allowlists, and fixed Root Trivy database retrieval to GHCR so cold-cache behavior stays inside the declared boundary.                                                                                         |

Direct dependencies that were unused were removed: the storefront no longer
declares `@tanstack/virtual-core` separately from `@tanstack/react-virtual`, and
the removed TanStack Zod adapter is not used by the current form code.

## React type isolation in the pnpm workspace

The backend admin must remain on React 18.3.1 while the storefront uses React
19.2.8. A shared pnpm virtual store can otherwise expose one hidden
`@types/react` version to declarations from both applications. This is the
failure documented in the still-open
[pnpm issue 6053](https://github.com/pnpm/pnpm/issues/6053).

The workspace follows pnpm's documented
[hoisting](https://pnpm.io/settings#hoistpattern),
[peer-resolution](https://pnpm.io/settings#resolvepeersfromworkspaceroot), and
[package-extension](https://pnpm.io/settings#packageextensions) controls:

- React and React DOM type packages are excluded from the shared hidden hoist.
- Workspace-root peer resolution is disabled so each application supplies its
  own declared React runtime and types.
- The former workspace-wide React 19 peer exception was removed; the complete
  graph passes `pnpm peers check` without suppressing version mismatches.
- Optional React type peers are added only to the exact Next, Lucide, Medusa
  Icons, and Medusa UI releases whose public declarations import React without
  declaring those type peers.

A fresh install resolves Lucide, Next, and Medusa Icons in the storefront with
React 19 types, while Medusa UI and Medusa Icons in the backend resolve with
React 18 types. Both strict application typechecks pass from that one lockfile.
TypeScript's documented
[`preserveSymlinks`](https://www.typescriptlang.org/tsconfig/preserveSymlinks.html)
mode was also tested and rejected: it fixed those four declaration boundaries
but caused other transitive declarations to resolve outside their pnpm peer
contexts.

## Medusa and React Router compatibility/security correction

The dependency refresh temporarily forced React Router and React Router DOM
7.18.1 and patched back the removed `json` and `defer` exports. That is not a
supported Medusa configuration:

- `@medusajs/dashboard@2.18.0` depends on `react-router-dom` **6.30.4**.
- `@medusajs/draft-order@2.18.0` declares the same exact peer contract.
- React Router 7 removed the legacy data helpers rather than promising
  compatibility through user patches.

The supported override is therefore exactly 6.30.4. Three React Router
advisories published on July 22–23 have fixes only in v7.18, and one explicitly
has no patched v6 release:

- [GHSA-wrjc-x8rr-h8h6](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6)
  and upstream [PR 15176](https://github.com/remix-run/react-router/pull/15176)
- [GHSA-jjmj-jmhj-qwj2](https://github.com/remix-run/react-router/security/advisories/GHSA-jjmj-jmhj-qwj2)
  and upstream [PR 14718](https://github.com/remix-run/react-router/pull/14718)
- [GHSA-337j-9hxr-rhxg](https://github.com/remix-run/react-router/security/advisories/GHSA-337j-9hxr-rhxg)
  and upstream [PR 15175](https://github.com/remix-run/react-router/pull/15175)

The upstream fixes were backported to the framework-supported package split:
URL/path/redirect normalization in `@remix-run/router@1.23.3`, and link parsing
plus hydration-error constructor restrictions in
`react-router-dom@6.30.4`. Both development and production artifacts were
rebuilt from the official 6.30.4 source tag. The focused upstream suite passed
293 tests.

pnpm’s audit is version-based and cannot detect a patched package, so these
three React Router GHSA records are listed under `auditConfig.ignoreGhsas`.
This is paired with a required `pnpm run qa:react-router-security` CI check
that loads the installed production artifacts and verifies mixed-separator
navigation, redirect handling, link handling, and blocked custom hydration
constructors. pnpm 11 also fails installation if either exact patch stops
applying.

The exception contract is machine-readable in
`scripts/security/dependency-supply-chain-policy.json`. The repository gate
requires those exact three advisory ids, exact patched package selectors, and
regular non-symlink evidence files. No `brace-expansion` advisory is ignored:
the affected dependency ranges resolve to fixed 2.1.4 or 5.0.9 artifacts.

## Dependency publication cooling

The root, Backend, and Storefront pnpm workspaces explicitly enforce the
[pnpm release-age settings](https://pnpm.io/settings/dependency-resolution)
with a strict seven-day window. Missing publication timestamps fail closed,
frozen lockfiles are reverified, and exotic transitive dependency sources are
blocked in line with pnpm's
[supply-chain guidance](https://pnpm.io/supply-chain-security). The generated
Backend production workspace preserves the same settings and rejects weaker
values.

Of the former 152 exact release-age exclusions, 151 were already older than
seven days and were removed. Biome 2.5.11 and Sharp 0.35.4 were not mature at
the time of enforcement, so the repository uses the newest eligible releases,
2.5.10 and 0.35.3. The sole remaining exact cooling exception is
`@railway/cli@5.45.0`, whose release installer is locally patched to validate
reviewed immutable SHA-256 asset digests. `pnpm run
qa:dependency-supply-chain` binds that exception and the five current audit
ignores to their evidence in all three CI workflows. Three ignores cover the
React Router backport and two cover the separately verified `qs` backport
described below.

## `sanitize-html` advisory remediation (2026-09-02)

GitHub published `GHSA-g8qq-57p8-ggw5` after the runtime-image work began.
Backend and Storefront now pin `sanitize-html` 2.17.7, the first patched
release, instead of 2.17.5. Version 2.17.7 was published on 2026-08-13, so it
passes the seven-day cooling policy without an exception. Both rich-text
regression suites include the SVG animation URI-list vector while retaining
their narrower tag allowlists.

The patched package moves to ESM-only `htmlparser2` 12 and requires Node
22.12 or newer. The repository and runtime images already use Node 26;
Backend unit and coverage commands now use Jest's existing VM-modules runtime
so the production dependency is exercised rather than mocked or downgraded.
The frozen install, both sanitizer suites, complete Backend and Storefront
coverage, production builds, and `pnpm audit --prod --audit-level=moderate`
passed at the time of this correction. Later same-day advisories and their
remediation are recorded below.

## `fast-uri` and `qs` advisory remediation (2026-09-02)

GitHub published four high-severity `fast-uri` advisories
([GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8),
[GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc),
[GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), and
[GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp))
and two moderate-severity `qs` advisories
([GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx)
and [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g))
after exact-SHA acceptance had started.
`fast-uri` 3.1.6 was published on 2026-08-23 and already satisfied the strict
seven-day cooling window, so every workspace now pins that release. This
eliminates all four host-confusion and SSRF findings without an exception or
audit ignore.

`qs` 6.16.0 was published on 2026-08-29T23:50:15.803Z and was still inside the
cooling window. The repository therefore retains exact 6.15.3 and backports
only the two upstream security changes: the
[`arrayLimit` fix](https://github.com/ljharb/qs/commit/8859c37470e11b42b547b275e4e9bd0bc8cc5464)
for comma-split values under bracket-push keys, and the
[`constructor.isBuffer` fix](https://github.com/ljharb/qs/commit/e83d321ffafb38cf210683ac31714fce6ce1c6c6)
that calls the property only when it is a function. Identical patches are
present for root, Backend, and Storefront standalone installs. `pnpm run
qa:qs-security` verifies patch parity, both public exploit regressions through
each application dependency path, the in-limit parser behavior, and real
Buffer serialization.

The two version-based pnpm audit findings are ignored only alongside that
machine-readable patch evidence. The strict cooling window is unchanged and no
new cooling exception was added. Once 6.16.0 has cooled on
2026-09-05T23:50:15.803Z, replace the backport with the release and remove both
GHSA ignores, all patch copies, and the temporary verifier in one reviewed
change.

## Next.js critical security update (2026-09-03)

The September 3 registry audit found that Next.js 16.3.3 is the newest release
past the repository's strict seven-day cooling window. The official
[16.3.3 release](https://github.com/vercel/next.js/releases/tag/v16.3.3)
contains fixes for two critical remote-code-execution advisories: one limited
to Windows-hosted servers and one in AVIF Image Optimization. Railway runs the
Storefront on Linux, but the Storefront explicitly negotiates AVIF, so the image
optimizer correction is directly in scope.

The Storefront therefore moves from Next.js 16.2.12 to 16.3.3 as an isolated
framework security update. The root plus both standalone service package
extensions now identify the same exact Next release, and the shared lockfile
contains only 16.3.3. Next.js 16.3.4 is a follow-up that re-enables AVIF and
contains additional fixes, but it was published on
`2026-08-31T20:00:51.381Z` and remains inside the cooling window until
`2026-09-07T20:00:51.381Z`; no exception was added.

Local acceptance on 16.3.3 passed the strict Storefront typecheck, CSP and
Trusted Types contract tests, production dependency audit, and production
build for all 55 routes. The post-build verifier scanned 131 static assets and
found no server-only secret or public Meilisearch input while retaining the
named Stripe Trusted Types policy. Baseline coverage passed 139 files / 829
tests at 94.37% statements and 86.06% branches; transactional coverage passed
36 files / 322 tests at 83.73% statements and 76.50% branches. The responsive
Chromium matrix passed 54 tests with two intentional exclusions, and the
critical Chromium, Firefox, and WebKit matrix passed all 21 flows. A direct
optimizer request advertising AVIF returned HTTP 200 with `image/avif` and the
expected sandboxed image response policy.

One critical-flow request emitted Next's non-fatal `Unexpected root span type
'AppRender.fetch'` diagnostic. It produced no request, rendering, test, trace,
or coverage failure. No suppression was added; exact-deployment runtime logs
remain a required staging acceptance check so any recurring telemetry noise is
measured rather than hidden.

The first exact 16.3.3 staging deployment emitted no recurrence of that
telemetry diagnostic, but Railway classified Next's warning that `next start`
does not support `output: "standalone"` as two error-level application logs.
The deployment served healthy traffic, but acceptance stopped rather than
normalizing the warning. Default Storefront builds now omit standalone output
and remain paired with `next start`; the dedicated `build:runtime` command sets
`STOREFRONT_BUILD_OUTPUT=standalone` only for the immutable runtime-image
workflow. Invalid selector values fail the build, and repository policy binds
both validation and publication jobs to the explicit runtime command. Local
acceptance proved the default server plus the copied standalone layout,
including `/live`, the public logo, and AVIF optimization.

Corrective commit `8d5d73e2fd80617de575ea269211816f7142f852`
subsequently passed Root run `33740171303`, Backend run `33740171288`,
Storefront run `33740171301`, and Runtime Images run `33740171294` at the
exact SHA. Both runtime-image validations rebuilt, smoked, scanned, and
retained evidence successfully; publication skipped on `staging`. Railway
correctly skipped Backend deployment `316d8cd5-3388-4bb0-bd9f-688b1d0bf463`
and accepted Storefront deployment
`e95043ae-6b4a-41c3-9816-e6606e51cbf4`. The deployed Storefront reports the
correct revision from `/live` and `/ready`, has healthy Backend and Redis
checks, serves root and catalog, and returns a real `image/avif` response under
the sandboxed optimizer policy. Exact-deployment logs contain no unsupported
startup warning, `AppRender.fetch` diagnostic, Trusted Types report, or HTTP
4xx/5xx record. Railway still classifies the package runner's historical
`$ next start` command echo as one error-level line; it has no application
event or error code and predates this upgrade.

## TanStack Query patch update (2026-09-03)

The Storefront's five Query runtime and persistence packages move together
from 5.101.4 to 5.102.7. The target was published on
`2026-08-27T08:33:25.188Z` and passed the strict seven-day cooling window
without an exception. The newer 5.102.8 release remains excluded until
`2026-09-03T16:06:57.089Z`; it is not silently folded into this already
reviewed cohort.

The upstream
[5.101.4-to-5.102.7 comparison](https://github.com/TanStack/query/compare/v5.101.4...v5.102.7)
includes fixes for settled retryer retention, thenable callbacks, observer
notification stability, programmatic suspense resolution, matched query
resets, disabled-observer stale timers, falsy error-boundary values, and
partial dehydrated state. Repository usage was checked for the removed
experimental before/after/prefetch methods; none are used. Supported
`setQueryData`, `fetchQuery`, `prefetchQuery`, and
`PersistQueryClientProvider` call sites remain covered. Medusa's isolated
Backend/Admin Query 5.64.2 graph is framework-owned and unchanged.

Local acceptance passed the frozen install, peer check, dependency
supply-chain policy, production audit, full repository QA gate, strict
Storefront typecheck, 16 focused persistence/prefetch tests, and the 55-route
production build with a clean 131-asset secret scan. Baseline coverage passed
139 files / 829 tests at 94.37% statements and 86.06% branches;
transactional coverage passed 36 files / 322 tests at 83.73% statements and
76.50% branches. Responsive Chromium passed 54 journeys with two intentional
skips, and the critical Chromium, Firefox, and WebKit matrix passed all 21
flows. No rendered UI changed, so graphical screenshot validation is not
applicable.

Exact implementation SHA `c72942c1734858f15dd178b71a1e7401fa4da27a`
passed Root run `33744311233`, Backend run `33744311279`, Storefront run
`33744311259`, and Runtime Images run `33744311304`. The image workflow's
Backend job `100613177609` and Storefront job `100613177853` passed; publication
job `100613178896` skipped on `staging`. Retained artifacts `9889106275` and
`9889072350` expire on 2026-10-03 and bind the exact revision to Backend image
digest `sha256:b21c0cc59e0c67322f2633562b0db94664808b084589532464b3e55cb55260d9`
with 1,183 CycloneDX components and Storefront digest
`sha256:da86338ce948f3011535ad1fbdc87b98c6191d3b64c5cad9d09b2576fb2b2aae`
with 122 components.

Railway Backend deployment `23338f13-c4d2-4299-a4f2-9655a662a958` and
Storefront deployment `83071db0-cd2f-49a6-b957-1cd6b8d44bfa` both reached
`SUCCESS` at the exact SHA, with source-image digests
`sha256:e4d463395074c5b9135e3caff7bc1dea1f16a836f0f1a90c8d92685797c5361c`
and
`sha256:40f7eda9c15c7c68f7e2987210886f99418fda76aa4f60fa67ec2bb9ddcd6904`.
Both health/readiness pairs and the Backend scheduler/operations routes
returned 200; Storefront root and catalog returned 200, and the live optimizer
returned a valid AVIF under its sandboxed response CSP. Exact-deployment logs
contained zero HTTP 4xx/5xx records, application error events, Trusted Types
reports, standalone warnings, or `AppRender.fetch` diagnostics. All bounded
completion events matched the exact SHA and contained no forbidden request
fields.

## Isolated compatibility upgrade plan — 2026-09-03

`pnpm outdated --recursive --format json` was reviewed against registry publish
times and official release notes. Each runtime family below owns a separate
commit, complete local gate, exact-SHA CI run, and Railway acceptance when its
watched source changes. A failed cohort is reverted independently; unrelated
families must not be bundled into its lockfile diff.

| Order | Cohort | Target and boundary |
| ----- | ------ | ------------------- |
| 1 | Next.js | Complete the 16.3.3 critical security update above. Re-evaluate 16.3.4 only after its cooling expiry and rerun the image, nonce/CSP, Trusted Types, production-build, responsive browser, accessibility, and Lighthouse gates. |
| 2 | `qs` | Replace 6.15.3 with 6.16.0 no earlier than `2026-09-05T23:50:15.803Z`; remove both advisory ignores, all three patch copies, and the temporary verifier in the same commit. |
| 3 | Medusa | Move every Backend and Storefront `@medusajs/*` package together from 2.18.0 to 2.19.0. The official [2.19 release](https://github.com/medusajs/medusa/releases/tag/v2.19.0) is a breaking Admin migration to Vite 7.3.6 and React Router 7.18.2. Audit removed SDK Product Option methods, `Response.json()` and `defer()` usage, `UIMatch.loaderData`, cart/order wildcard totals, every Medusa patch, Admin browser/a11y contracts, migrations, and complete checkout/refund/tax behavior before staging. |
| 4 | TanStack | Completed the five Query persistence/runtime package update to 5.102.7 with local, exact-SHA CI, runtime-image, and Railway acceptance. Keep Form 1.33.5 and Pacer 0.22.0 in separate commits because forms own validation/focus behavior and Pacer is a pre-1.0 minor. Hold Table 9 for an explicit API migration instead of forcing it into a patch cohort. |
| 5 | Stripe | Update `stripe` 22.6.0 separately from the browser pair. Its release pins a new API version and changes connection-error behavior. Update `@stripe/react-stripe-js` 6.8.2 with `@stripe/stripe-js` 9.14.0 only after rebasing or removing the exact Trusted Types loader patch, then rerun checkout, 3DS, response-loss, webhook, refund, CSP, and three-engine browser matrices. |
| 6 | AWS SDK | Update the S3 client to 3.1119.0 with its compatible core graph. Recheck the locally patched abort/timeout behavior, MinIO path-style requests, release `HeadBucket`, upload compensation, media backup, and runtime image scan before removing any core override. |
| 7 | OpenTelemetry | Move the experimental SDK and matching instrumentations as one compatibility set: SDK Node 0.221.0 and the corresponding Redis, ioredis, Knex, PostgreSQL, and runtime packages. Keep stable API/trace packages on their compatible line; prove preload ordering, shutdown, redaction, trace correlation, RED metrics, and provider-disabled startup. |
| 8 | Small runtime and tool patches | Use separate low-risk commits for Redis 6.2.1, Resend 6.24.0, PostHog 5.51.3, UI/test patches, and exact GitHub Action commit updates. Preserve functional email, rate-limit, analytics, browser, coverage, immutable-action, and egress-policy tests for the component changed. |

MikroORM 7, Awilix 13, the Meilisearch plugin 2, TanStack Table 9, Motion 13,
JSDOM 30, TypeScript 7, and Backend React 19 remain migration projects rather
than opportunistic lockfile updates. Medusa 2.19 removes the current React
Router hold, but only inside its coordinated framework cohort.

## Deliberate major-version holds

These are not forgotten upgrades. Each latest major conflicts with an active
upstream contract:

| Dependency            | Available     | Hold reason                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript            | 7.0.2         | TypeScript 7 has no stable programmatic API for embedded tools, and [typescript-eslint supports only TypeScript `<6.1`](https://typescript-eslint.io/users/dependency-versions/). TypeScript 6.0.2 was also tested, but Medusa UI 4.2.0 pins `cva@1.0.0-beta.1`, whose peer range is `<6`. TypeScript remains at 5.9.3. Deprecated `baseUrl` usage was removed so the local configuration is ready for a later supported migration. |
| React (backend admin) | 19.2.8        | The storefront remains on React 19.2.8. Medusa dashboard 2.18 and draft-order 2.18 publish React/React DOM 18.3.1 contracts, so the separately built backend admin uses React 18.3.1 and matching type packages instead of forcing the storefront runtime into it.                                                                                                                                                                  |
| MikroORM              | 7.1.14        | Medusa 2.18.0’s published `@medusajs/deps` package pins all MikroORM packages exactly to 6.6.14. The [MikroORM 7 guide](https://mikro-orm.io/docs/upgrading-v6-to-v7) also introduces native ESM, decorator-package changes, query semantics, and persistence behavior changes. The framework-owned pin is retained.                                                                                                                |
| Awilix                | 13.0.5        | Medusa 2.18.0’s published dependency contract is `awilix ^8.0.1`; forcing 13 would create an unsupported container/runtime split. The framework-compatible 8.0.1 is retained.                                                                                                                                                                                                                                                       |

## Release verification

The migration is complete only after:

1. `pnpm install --frozen-lockfile` and `pnpm peers check`
2. lint, strict typecheck, unit/coverage, and production builds
3. dependency cooling, audit, React Router and `qs` backport verification, and
   hook validation
4. Playwright device/browser smoke validation
5. successful GitHub Actions and Railway staging deployments
6. post-deploy route and API smoke checks

## Runtime image supply-chain follow-up (2026-09-02)

The locally accepted runtime images hold the application runtime at the reviewed
Node 26.5.0 Bookworm slim multi-platform digest rather than resolving a moving
base tag. Final layers remove npm and npx because the applications do not need
a package manager after build. This also removes eight fixed high/critical
findings discovered entirely in the base image's npm dependency tree without
adding an ignore.

The candidate release workflow pins Docker Buildx setup 4.3.0, login 4.6.0,
build-push 7.3.0, GitHub attest 4.2.2, and Trivy action 0.36.0 to reviewed exact
commits. Trivy itself is explicitly 0.70.0 and uses only the reviewed GHCR
database. `scripts/security/runtime-image-policy.json` is the machine-readable
identity source. Fresh Trivy 0.70.0 scans found zero fixed HIGH/CRITICAL
vulnerabilities in both final local images, and digest-bound CycloneDX records
verified for both subjects. Runtime Images run `33685237476` passed both image
jobs on exact SHA `f3b71a6482ce941ad253672983547c494caa8d56` and skipped
publication on `staging` as required. The same SHA's application workflows
stopped at newly published dependency advisories; locally accepted remediation
commit `56d42bbdd50be90e431ced71b8c6c74bf4d62cb0` closed those audit failures.
Root run `33688896124`, Backend run `33688896267`, Storefront run
`33688896038`, and Runtime Images run `33688896070` subsequently passed at
exact SHA `61fd86889a4adca23e1e9704e11c889a1fd986a9`. Both runtime-image jobs
rebuilt, smoked, scanned, and retained private evidence; publication again
skipped without registry login. Backend source deployment
`75650cfc-d897-46bb-b83c-b10aab077fc1` subsequently reached `SUCCESS` at
documentation head `d7e5d43013a89af434f767cda0c6d2bd6ec4d9f6`, which contains
the accepted remediation, and Storefront source deployment
`3ab9b285-50ac-40cd-a777-4b9afd1948e4` reached `SUCCESS` at implementation SHA
`61fd86889a4adca23e1e9704e11c889a1fd986a9`. Bounded health, catalog, cart,
search, scheduler, operations, Redis, HTTP-status, and redacted-log acceptance
passed. The later immutable GHCR-to-Railway artifact cutover remains separate;
see `NEXT_SESSION_HANDOFF.md` before changing any pin.
