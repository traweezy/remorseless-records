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
qa:dependency-supply-chain` binds that exception and the three current audit
ignores to their evidence in all three CI workflows. All three ignores cover
the behaviorally verified React Router backport described above.

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

`qs` 6.16.0 was published on 2026-08-29T23:50:15.803Z and passed the strict
seven-day cooling window on 2026-09-05T23:50:15.803Z. Root, Backend, and
Storefront now pin that exact release through one coherent lockfile graph. The
release includes the two previously backported security changes: the
[`arrayLimit` fix](https://github.com/ljharb/qs/commit/8859c37470e11b42b547b275e4e9bd0bc8cc5464)
for comma-split values under bracket-push keys, and the
[`constructor.isBuffer` fix](https://github.com/ljharb/qs/commit/e83d321ffafb38cf210683ac31714fce6ce1c6c6)
that calls the property only when it is a function. The three workspace patch
copies, temporary behavioral verifier, two version-based audit ignores, and
their machine-readable exceptions have been removed together. Direct checks
through both application dependency paths retain the two exploit regressions,
in-limit parser behavior, and real Buffer serialization on the upstream
release. The strict cooling window is unchanged and no new exception was
added.

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

## Redis client patch update (2026-09-03)

The direct Backend and Storefront Redis clients move from 6.1.0 to the cooled
6.2.1 patch line, and the shared lockfile resolves `redis`, `@redis/client`,
Bloom, JSON, Search, and TimeSeries to one coherent 6.2.1 family. Redis 6.2.1
was published on 2026-08-11, so no cooling exception was required.

The official 6.2.0 and 6.2.1 release changes were audited for cluster raw
command routing, sentinel behavior, stale socket listeners, credentials,
redirect handling, and RESP3 double decoding. The repository uses standalone
`createClient` connections in both applications, with no `createCluster` call
or raw cluster dispatch, so the cluster routing compatibility change requires
no application migration. The remaining lifecycle and correctness fixes are
compatible with the existing reconnect, readiness, rate-limit, cache, and
session consumers.

Local acceptance passed frozen install, peer and supply-chain policy checks,
the production audit, full QA, both strict typechecks, 38 focused Backend tests,
31 focused Storefront tests, both coverage suites, and both production builds.
Backend passed 273 suites / 2,066 tests at 91.58% statements and 85.31%
branches. Storefront passed 139 baseline files / 829 tests at 94.37% statements
and 86.06% branches, plus 36 transactional files / 322 tests at 83.73%
statements and 76.50% branches. The Storefront build completed 55 routes and a
clean 131-asset secret scan; the clean confirmation browser run passed all 21
critical Chromium, Firefox, and WebKit journeys.

The local disposable integration attempt exposed a Docker host-network issue:
healthy PostgreSQL and Redis containers were unreachable through either their
published ports or bridge addresses, and Medusa initialization ended in
`ECONNRESET` before application assertions. The canceled harness cleaned up
its containers and volumes. Exact GitHub Backend job `100628118781` then ran
the same disposable PostgreSQL/Redis integration successfully in 1 minute 11
seconds, providing fresh authoritative integration proof. No rendered UI
changed, so graphical screenshot validation is not applicable.

Exact SHA `6df5cbb2d0dcd111b87ed7cf0b2c03015f336e1a` passed Root run
`33748819712`, Backend run `33748819667`, Storefront run `33748819653`, and
Runtime Images run `33748819721`. Backend runtime artifact `9890797507` binds
1,183 CycloneDX components to digest
`sha256:c0a1dec223f397380827677836fe69438111bd06b1a6581d043e0f5cf58c6a78`;
Storefront artifact `9890764444` binds 122 components to digest
`sha256:91ff507f4fe8b52fb4b00fea4898e3ba00293bf57ee4aff67a6d04228077027b`.
Both artifacts expire on 2026-10-03, and publication correctly skipped on
`staging`.

Railway Backend deployment `ca459698-3a86-42de-a255-d9b27b2e7d46` and
Storefront deployment `dacc90f7-ea9d-4088-93cc-17a72d638704` both reached
`SUCCESS` at the exact SHA, with source-image digests
`sha256:679b4fa5b3f99d22dae5b7b87130b139aa90344fa639f9a388d72be0cbc3e3bb`
and
`sha256:1d3a62eb6823fd715e2f2cfa5b5d6345d6c080969f5b63ec9c50470dec905f78`.
Health/readiness, scheduler/operations, root/catalog, security headers, and a
live AVIF optimization request passed. Exact logs contained zero HTTP 4xx/5xx
records or application errors. After readiness, Backend recorded 334 Redis
network records / 710 packets / 151,558 bytes and Storefront recorded 12
network records / 13 packets / 1,139 bytes, both with zero packet-drop causes.
No production state was changed.

## TanStack Form patch update (2026-09-06)

Both direct `@tanstack/react-form` consumers move from 1.33.2 to 1.33.5,
with one shared `@tanstack/form-core` 1.33.5 and unchanged React 18.3.1
Admin / React 19.2.8 Storefront peer contexts. The React adapter was published
at `2026-08-11T12:45:38.642Z` and core at
`2026-08-11T12:45:38.255Z`; both satisfy the strict seven-day cooling policy.
No dependency exception, override, or peer suppression was changed. Form 2
remains an alpha and is outside this patch update. The initial Form-only
local validation below precedes the larger release batch requested by the
user on 2026-09-06.

The [official core release](https://github.com/TanStack/form/releases/tag/%40tanstack/form-core%401.33.5)
and [upstream fix](https://github.com/TanStack/form/pull/2318) narrow field
deletion to dot- or bracket-delimited descendants, preserving unrelated
siblings whose names share a prefix. The React adapter source and dependency
ranges are unchanged across this patch set. The earlier 1.33.3 and 1.33.4
releases carry other framework adapters' SSR fixes, not a React API migration.

The call-site audit covers four Storefront forms and eight Admin form
instances. Existing synchronous Zod validation, `useStore` selectors,
reset/hydration, dirty state, focus targets, and submission contracts remain
unchanged. Application code does not call `deleteField` directly. The Admin
regression nevertheless exercises the installed library: sibling values,
registrations, and metadata survive deletion, while actual object/array
descendants are removed. Its sibling assertion fails on 1.33.2 and passes on
1.33.5. The existing hydrated reset/update regression remains green.

Four new Contact component tests pass before and after the upgrade: untouched
invalid submission sends no request, success resets values, a pending request
prevents a duplicate click, and failure retains values for retry without
rendering provider diagnostics. Existing Privacy focus/recovery tests also
pass. No rendered application source changed.

Local frozen install, peer checks, dependency policy/audit, React Router
backport verification, full lint/typecheck, both coverage suites, and both
production builds pass. Backend reports 273 suites / 2,068 tests with 91.58%
statements and 85.31% branches. Storefront transactional coverage remains
83.73% statements / 76.50% branches. Its production build completes 55 routes
and verifies 131 static assets without server-secret leakage or loss of the
named Stripe Trusted Types policy. Responsive, launch, and critical browser
matrices pass 54 (two expected skips), 14, and 21 tests respectively. The
compiled Admin matrix passes all 12 cases with zero axe violations, incomplete
checks, or other findings. Product creation/authoring, News, and Merchandising
browser screenshots were inspected without a visible regression; these are
not graphical-desktop captures. Exact-SHA GitHub/Railway acceptance is still
required before this cohort is closed.

## Combined compatible-dependency release batch — 2026-09-06

The user requested substantially more work between pushes. The pending Form
update, Admin acceptance safety fix, and the reviewed updates below now form
one release batch. The shared lockfile and mirrored service policies remain
the sole dependency graph; no release-age exception or security suppression
is added. Exact-SHA CI and Railway acceptance apply to the final batch, not
to intermediate documentation commits.

| Family | Reviewed target | Compatibility evidence and acceptance |
| ------ | --------------- | ------------------------------------- |
| Form | React adapter/core 1.33.5 in both apps | Initial local acceptance above; rerun forms against the final resolved graph, retaining their Store 0.11.0 context independently of Pacer. |
| Resend | 6.18.0 → 6.25.0 | Published `2026-08-28T17:26:33.600Z`; cooled September 4. The [release](https://github.com/resend/resend-node/releases/tag/v6.25.0) adds domain SPF typing; intervening releases preserve the used `emails.send` contract. Node/React Email compatibility is unchanged. Six real-SDK transport regressions cover actual template serialization, provider errors without automatic retries, stable caller retry keys, cancellation, and redaction. No live email is sent. |
| PostHog Node | 5.46.1 → 5.51.4 | Published `2026-08-27T20:03:32.838Z`; cooled September 3. [Official releases](https://github.com/PostHog/posthog-js/releases/tag/posthog-node%405.51.4) preserve Medusa's construction, capture, identify, groupIdentify, and awaited shutdown calls. Queue/timeout/memory handling changes require mocked transport checks. Optional RxJS and Node requirements remain compatible. The existing override is updated consistently in all three workspace policies. |
| Pacer | 0.21.1 → 0.22.0 | Published `2026-08-07T02:18:25.340Z`. The [release](https://github.com/TanStack/pacer/releases/tag/%40tanstack/pacer%400.22.0) updates devtools/store dependencies and fixes async/queue utilities. The synchronous Debouncer source used by catalog search is unchanged. Tests preserve the 250 ms quiet interval, latest/empty query values, and cleanup cancellation. |
| Query | Five direct Storefront packages 5.102.7 → 5.102.8 | Entire set cooled by `2026-09-03T16:07:48.573Z`. The [source comparison](https://github.com/TanStack/query/compare/release-2026-08-27-0832...release-2026-08-27-1607) changes only Preact behavior; React/core/persistence runtime remains unchanged. Keep the coherent graph and public-cache, prefetch, cart, and checkout regressions. Medusa's Backend Query 5.64.2 stays isolated. |
| Virtual | React 3.14.8 → 3.14.10, core 3.17.6 → 3.17.8 | React target published `2026-08-18T15:06:28.045Z`; core six seconds earlier. [Core fixes](https://github.com/TanStack/virtual/releases/tag/%40tanstack/virtual-core%403.17.8) address viewport resize, removed/out-of-range measurements, and observer cleanup. Validate search and discography scrolling/filter shrink across responsive viewports. |
| Sonner | 2.0.7 → 2.0.8 | Published `2026-08-09T08:46:10.174Z`. The [patch](https://github.com/emilkowalski/sonner/releases/tag/v2.0.8) fixes early notifications and visibility-listener cleanup alongside accessibility/StrictMode behavior. New real-library tests reproduce both bugs on 2.0.7 and retain accessible StrictMode dismissal. |

All targets are MIT-licensed and outside the unchanged seven-day release
cooling window. Pacer requires Store 0.11.1 and devtools-event-client 0.5.0;
both are cooled. The [Store patch](https://github.com/TanStack/store/compare/%40tanstack%2Fstore%400.11.0...%40tanstack%2Fstore%400.11.1)
replaces numeric enum flags with equivalent constants. Form remains covered
against its unchanged Store 0.11.0 context. PostHog's compatible cooled core
and type packages are reviewed with its Node SDK.

Next.js 16.3.4, Resend 6.26.0, and PostHog 5.51.5/5.51.6 remain time-gated.
Radix is already current. Motion and Lucide are not patch-only changes from
the installed lines; their review remains separate. Stripe, AWS,
OpenTelemetry, and Medusa migration requirements are not waived by batching.
The final root frozen install and peer checks pass. Only the reviewed seven
families and their compatible transitives change in the lockfile; Backend
React 18.3.1, Query 5.64.2, and Virtual 3.14.8 remain isolated from Storefront
React 19.2.8 and its new Query/Virtual versions. Resend's 27 focused tests pass
on 6.25.0. PostHog's injected-transport smoke drains three correctly shaped
events on awaited shutdown, with remote configuration disabled and global
network fetch blocked. It does not establish live analytics acceptance.
Sonner's three tests now pass, including both old-version failures. Final
Node 26.5.0 Backend coverage passes 274 suites / 2,074 tests at 91.58%
statements and 85.31% branches. Storefront coverage retains 94.40% lines,
95.83% functions, and 86.08% branches in its baseline suite; transactional
coverage remains 83.73% statements / 76.50% branches. Both pinned-runtime
production builds pass, including the Storefront's 55 routes and 131-asset
secret/Trusted Types scan. The pinned-runtime Admin matrix passes 12/12
with zero axe violations, incomplete checks, or other findings. Representative
rendered screenshots were inspected. Virtual-list resize, shrink, and recovery
also passed headed desktop/mobile checks, with a real desktop capture at
`/tmp/remorseless-virtual-desktop-20260906.png`.

Validation exposed an implicit-install risk in the Backend build wrapper:
launching `pnpm exec` from a nested workspace could resolve a different graph.
The wrapper now invokes the installed Medusa CLI with the current Node binary,
validates CLI availability before removing generated output, and retains
fail-closed compilation/artifact checks. Four subprocess regressions and a
real direct-node build pass. Generated accidental nested dependencies were
moved outside the repository, root links restored, and final pinned-runtime
coverage/builds reconfirmed against Medusa 2.18.0. No dependency-policy
relaxation or unplanned framework upgrade remains. This build fix and the
Admin harness fix have separate logical commits in the same release batch.
Final pinned-runtime browsers pass: responsive 60 tests (two expected skips),
launch 14, and critical 27 across Chromium, Firefox, and WebKit. The new
virtual-list cases run in all three engines. Fixture search fallback and
navigation stream-cancellation diagnostics remain visible; these passing
tests are not a zero-error-log or live-provider acceptance claim.

The three logical commits were pushed together at
`912525b1248087a759e089e4917366e1b1e10eab`. All four exact-SHA workflows pass:
Root `34053342906`, Backend `34053342877`, Storefront `34053342915`, and
Runtime Images `34053342907`. Backend CI passes 274 suites / 2,074 tests;
Storefront CI includes responsive 60 (two expected skips), launch 14, and
three-engine critical 27 browser checks, plus accessibility and Lighthouse.
Both runtime-image scans pass the unchanged HIGH/CRITICAL policy. Downloaded
records and CycloneDX SBOMs verify the exact revision and image subjects:
Backend `sha256:dab1f3d30c5bb84a2bc7759a36331ff8da87735135531e1bfad06765f56f285f`
(1,183 components; artifact `9995267808`) and Storefront
`sha256:79b1829238509fce06cebbfc53b33f6c7e5618ad969e89e1399222085b8a102f`
(122 components; artifact `9995253342`). These are GitHub validation images,
not proof of Railway's separately built source deployment.

Storefront Railway deployment `c1663b0c-d9ac-4bb8-8113-2313c3204fce` succeeds
with source-image digest
`sha256:1fc6955638491c1a1802d9715e22029601f57fc94cd108543efd5e46a57dff1b`.
Exact-SHA `/live` and `/ready`, Backend/Redis readiness, root/catalog HTML,
enforced/report-only Trusted Types, security headers, and a 7,837-byte AVIF
response pass. A deliberate read-only invalid-query response correlates to
the exact runtime log and revision. The deployed matrix passes 60 tests with
two expected skips. Its bounded log observation retains two existing Next
stream-cancellation events (`2234947129`), fixture 404s, client-disconnect
499s, and the intentional 400; there are no HTTP 5xx or Trusted Types reports.
Backend Railway deployment `48ff91c0-6463-4500-b74a-f38ed077f5c9` also succeeds
at this SHA with source-image digest
`sha256:38ab66c11d5e51d9e865b58792a3b06a96cdb27945c7572c83b54821ab48ae2d`;
all four health routes return 200. The fresh `19:18:00.131Z` scheduler
heartbeat completes at the target SHA with zero failures and a released lock;
operations remain healthy at `19:18:39Z`. A deliberate unauthenticated Store
GET returns the expected 400 publishable-key guard and correlates to the exact
runtime completion/deployment instance. Health probes are intentionally
excluded from application completion logs and are checked through Railway
HTTP IDs instead. The bounded 348-row runtime sample has 28 completions, no
structured failures or forbidden completion fields, and only the command
echo at error level. Its 34 HTTP records contain 33 successful requests and
the deliberate 400, without 429, 503, or other 5xx responses. This combined
batch is accepted; the next batch below remains independently gated.

## Storage, payment, and telemetry batch — 2026-09-06

The next shared resolution groups ten direct upgrades across three reviewed
families. It retains the one-week cooling policy and existing security
backports; no release-age exception or audit suppression is added. Root
frozen installation and peer checks pass. Structural lockfile review limits
new package records to AWS/Smithy, OpenTelemetry, and Stripe; the only
unchanged-version metadata adjustment is the compatible `@vercel/otel` peer
set. Medusa remains 2.18.0, with its separate Stripe 15.12.0/19.1.0 and
PostgreSQL instrumentation 0.52.0 consumers left intact.

Independent final audit verifies all 61 newly resolved package versions
against official registry publication times and integrity values: every
version is over seven days old (youngest 9.02 days), with 58 Apache-2.0 and
three MIT license declarations. All 73 protected package versions and all
16 patch hashes match their intended identities; no unrelated dependency
edges or security/cooling-policy changes were found.

| Family | Reviewed target | Boundary and evidence |
| ------ | --------------- | --------------------- |
| AWS/Smithy | S3 client, multipart upload, presigner 3.1121.0; AWS core 3.977.9; Smithy core 3.33.3, Node handler 4.11.3, Fetch handler 5.7.2, types 4.17.2 | S3 published `2026-08-28T19:01:10.061Z`, core `2026-08-21T19:12:55.198Z`; both cooled. [S3 release history](https://github.com/aws/aws-sdk-js-v3/blob/v3.1121.0/clients/client-s3/CHANGELOG.md) and [Smithy handler history](https://github.com/smithy-lang/smithy-typescript/blob/%40smithy%2Fnode-http-handler%404.11.3/packages/node-http-handler/CHANGELOG.md) retain the used transport contracts. Keep MinIO path-style addressing, disabled ACLs, bounded attempts/deadlines, and read-only readiness. The shared AWS graph, including Medusa's DynamoDB transitive, stays on the same compatible cooled line. Apache-2.0 licensing and Node requirements remain compatible. |
| Stripe server | 22.3.2 → 22.6.0 | Published `2026-08-27T04:22:11.448Z`. The [release](https://github.com/stripe/stripe-node/releases/tag/v22.6.0) updates the default API header from `2026-06-24.dahlia` to `2026-08-26.dahlia` and extends request timeouts through response-body consumption. [Stripe's versioning contract](https://docs.stripe.com/api/versioning) distinguishes compatible monthly releases from breaking named versions; this does not change webhook endpoint configuration. Six actual-SDK, injected-Fetch tests cover exact headers/body/idempotency, stable retries, provider failure classification, and stalled/truncated responses without contacting Stripe. |
| Stripe browser | React 6.8.0 → 6.8.2; Stripe.js 9.12.0 → 9.14.0 | Published August 20 and cooled August 27. [React comparison](https://github.com/stripe/react-stripe-js/compare/v6.8.0...v6.8.2) and [loader comparison](https://github.com/stripe/stripe-js/compare/v9.12.0...v9.14.0) preserve used runtime behavior; published runtime files match after version-string normalization. The exact four-file Trusted Types patch is rebased, not removed or broadened. Real-browser tests fulfill every Stripe request locally and prove lazy/concurrent loading, the fraud-signals URL, failed-load recovery, and reuse of the single named policy. Both Stripe packages retain MIT licensing. |
| OpenTelemetry | SDK/experimental 0.217.0 → 0.221.0; stable core/SDK graph → 2.10.0; ioredis/Redis 0.69.0, Knex 0.65.0, PostgreSQL 0.73.0, runtime-node 0.34.0 | The cooled coherent set preserves API 1.9.1 and Storefront trace-base 2.10.0. All three workspace policies mirror experimental API/instrumentation and core overrides. Database instrumentations switch to stable semantic attributes; compatibility includes privacy review of SQL, error, and metric labels, not just successful startup. Keep SQL-comment/application-name propagation and runtime exception capture disabled. No exporter or extra instrumentation is enabled. Apache-2.0 licensing remains compatible. |

Storage regressions reproduce two existing bugs before the patch: an HTTP 200
bulk-delete response containing individual errors resolves successfully, and
an unfinished upload leaves its producer stream open after its deadline.
[S3 explicitly reports individual failures in quiet-mode response bodies](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html).
The provider now rejects those responses through its existing fixed-message
error boundary, without exposing keys or adding retries, and always destroys
the upload stream when its promise settles. Review also reproduced the SDK's
missing in-flight multipart signal propagation and failed-completion cleanup.
A per-upload client facade now forwards an isolated upload signal, preserves
the shared client's configuration, and gives deduplicated multipart cleanup
its own bounded signal. It emits a fixed diagnostic if cleanup fails. These
are best-effort cancellation/cleanup boundaries, not a remote rollback
guarantee after response loss. All 13 provider regressions pass after the
final patch install, including finished-producer/stalled-transport cases,
concurrent isolation, failed part/completion cleanup, quiet deletion, ACL
omission, and timer cleanup. The earlier 25 focused Backend and 12
release/backup tests also pass. No live storage writes or deletions are used.

OpenTelemetry's [core release](https://github.com/open-telemetry/opentelemetry-js/releases/tag/v2.10.0),
[experimental release](https://github.com/open-telemetry/opentelemetry-js/releases/tag/experimental%2Fv0.221.0),
and [stable database semantic-attribute migration](https://github.com/open-telemetry/opentelemetry-js-contrib/commit/5b7dd0e102e940d653e04b08b5a1b721a8271037)
were reviewed together. Merely disabling enhanced reporting does not remove
SQL literals or raw exceptions. Narrow per-instrumentation span facades now
filter those values before recording, and a PostgreSQL-only meter facade
filters labels independently. Global/application providers and runtime metric
lifecycles remain untouched. Opaque process-local pool groups preserve series
without exporting names and cap cardinality at 32 groups plus overflow.
The upstream PostgreSQL instrumentation's shared multi-pool delta baseline is
pre-existing in both reviewed versions; tests preserve rather than conceal
that behavior. Pool metrics are not authoritative connection inventory—use
database readiness/operational probes for health decisions.

All 16 real-SDK/instrumentation tests pass, covering span context, links,
timing/status, real database/Redis module patches, metric values, pool-group
limits/reset, disabled preload, and shutdown. Bootstrap coverage is 99.44%
lines / 90.74% branches / 100% functions. A five-by-20,000-span synthetic
no-exporter benchmark measured median raw 0.939 microseconds versus filtered
0.996 microseconds per span; this is filter overhead, not a service-latency
benchmark. Independent review found no remaining concrete facade issue.

The Stripe response-body deadline regression fails on 22.3.2 and passes on
22.6.0. Its transport/binding/evidence suites pass 93 tests; Storefront
payment/Trusted Types regressions pass 17. Loader tests pass all six cases
across Chromium, Firefox, and WebKit. They verify the installed loader with
intercepted scripts, not live payments, tax, refunds, or webhook delivery.
Full Storefront coverage/build and 66 responsive (two expected skips), 14
launch, and 33 three-engine critical browser tests pass on the final SDK
graph. Final Node 26.5.0 Backend coverage passes 275 suites / 2,090 tests at
91.67% statements/lines, 85.49% branches, and 95.78% functions. Its direct
build passes Backend compilation in 6.35 seconds and Admin in 15.55 seconds;
the frozen generated runtime resolves 1,072 dependencies with the expected
Medusa/SDK identities and an exact copy of the bootstrap. Root lint/typecheck,
all boundary checks, peers, and the unchanged audit policy pass. Final Admin
acceptance passes 12/12 with zero axe violations/incomplete checks, findings,
review codes, or case errors. Five inspected rendered Chromium fixture
screenshots across 760–1,920 px show no visible regression; artifacts are at
`/tmp/remorseless-storage-payment-telemetry-admin.zUO2kX`. Implementation
commit `9cf9338` and its evidence traveled in one push at
`c20efbebed1ef328388ced0f99edd8ac3dacc7ed`. Exact-SHA CI and separate
Railway acceptance subsequently passed:

- Root `34054918470`, Backend `34054918518`, Storefront `34054918476`, and
  Runtime Images `34054918453` are green. Backend CI passes 275 suites /
  2,090 tests plus both integration jobs; Storefront CI passes all unit,
  coverage, browser, accessibility, and Lighthouse gates.
- Private runtime artifacts `9995709792` (Backend, 1,166 components) and
  `9995691958` (Storefront, 122 components) bind their CycloneDX records to
  `sha256:fc34787b4956759086551cd7d47d4ce9515f4ebb6514b8d6a839336db3e4da3d`
  and `sha256:9679fd327959d14e2ccea0803356fc44de00fb9a31ee21d2c6e3813ad6f55f49`,
  respectively. HIGH/CRITICAL scans pass the unchanged policy. These are
  GitHub-built images, not the distinct Railway source-build identities.
- Backend source deployment `6de89656-1d77-4c0e-9e35-5ec12c0a53b4` is
  `SUCCESS`, digest
  `sha256:8f7e19c79171e2c22d2f205830e09edf59b257ca16738fcd697844fe53b929bf`.
  All four health routes, four dependencies, seven capabilities, authenticated
  bounded catalog/operations checks, and the fresh exact-SHA scheduler
  heartbeat at `19:46:06.108Z` pass. A guarded read-only 400 preserves its
  request/trace IDs and exact-SHA completion; all nine HTTP probes match the
  deployment. The uncapped 325-row startup sample has no structured failure
  events or error rows. Prior daily retention snapshots remain healthy;
  they were not newly executed at this SHA.
- Storefront source deployment `7dd9459c-4ea7-4ec5-ac03-8e403745e4d5` is
  `SUCCESS`, digest
  `sha256:9ac4b9eade6f57c1320f079c117101635fbea6313b458e62f7f13f8c3cea0eec`.
  Exact-SHA health/readiness, complete home/catalog HTML, security headers,
  enforced/report-only Trusted Types policies, actual AVIF optimization,
  and a correlated read-only invalid-query 400 pass. Deployed browser
  acceptance passes 66 with two expected skips: 60 deployed smoke checks
  plus six fully intercepted Stripe-loader checks, not live payments.
  The bounded error-only HTTP sample contains the deliberate 400 and 13
  fixture 404s, with no 5xx. Runtime logs retain three known Next destination
  stream cancellations (digest `2234947129`) and no Trusted Types reports;
  this is not a zero-error claim.

Newer Stripe, AWS, and OpenTelemetry releases still within seven days remain
held; this batch does not waive the separate Medusa migration.

## UI, parser, image, and test/build tooling batch — 2026-09-06

The next planned shared resolution groups 15 direct upgrades, including the
native image/parser boundaries and the UI regression work discovered during
review. Publication times below come from official registry metadata; every
target is past the unchanged seven-day cooling window. No audit exception,
build-script permission, or unreviewed major migration is included. Strict
root frozen installation and peer checks pass. Independent review verifies
all 85 new package records against official age/integrity metadata (youngest
8.51 days) and finds no unrelated dependency-edge changes. All 75 protected
Medusa/React 18/CSV 5.6/unused-helper records and all 16 patches are unchanged.
Five same-version peer metadata changes only reflect the intended PostCSS
override normalization. Runtime-image and exact-SHA deployment acceptance
remain pending.

| Family | Reviewed targets | Compatibility and acceptance boundary |
| ------ | ---------------- | ------------------------------------- |
| Lucide | 1.27.0 → 1.37.0; published `2026-08-29T07:25:15Z` | [Upstream comparison](https://github.com/lucide-icons/lucide/compare/1.27.0...1.37.0) and integrity-verified tarballs preserve all 36 imported icons. ShoppingCart is redesigned and CalendarArrowDown/Up change artwork; shared rendering/accessibility helpers are unchanged. Retarget the exact optional React-type extension in all three workspace policies. Verify cart/Quick shop and discography sort glyphs with real screenshots, accessible names, keyboard focus, and mobile layout. ISC, unchanged React peer range. |
| Motion | Owned motion/framer-motion and motion-dom 12.43.0; published July 28, cooled August 4 | [Release comparison](https://github.com/motiondivision/motion/compare/v12.42.2...v12.43.0) changes PopChild ref access, invalid custom-ref diagnostics, and SVG/background-color acceleration. Owned consumers use HTML elements, not those new acceleration paths. Shipped AnimatePresence child-order and reduced-motion modules are unchanged despite the changelog wording. Keep motion-utils 12.39.0 and Medusa's Motion 11.18.2 isolated; do not activate the unmounted PageTransition. MIT, unchanged optional React 18/19 peers. |
| Zustand / Immer | 5.0.15 (`2026-08-13T00:39:55.466Z`) / 11.1.18 (`2026-08-19T07:25:22.934Z`) | [Zustand](https://github.com/pmndrs/zustand/compare/v5.0.14...v5.0.15) fixes devtools action parsing and async persist invalidation; the app does not use persist. [Immer](https://github.com/immerjs/immer/compare/v11.1.15...v11.1.18) fixes array structural sharing/patch keys and Iterator typing. Real catalog/UI tests cover normalized push/remove, hydration snapshot immutability, untouched-array sharing, no-op notifications, and unsubscribe behavior. Both MIT; compatible unchanged peers. |
| CSV parser | Owned csv-parse 7.0.1 → 7.0.2; `2026-08-02T20:18:06.960Z` | [Upstream fix](https://github.com/adaltas/node-csv/compare/csv-parse@7.0.1...csv-parse@7.0.2) treats hostile column names as own data properties. Six actual-parser regressions exercise `__proto__`, `constructor`, and `toString`; four fail on 7.0.1. Grouped columns reproduce the upstream prototype issue but are not enabled by the application. The string-only import boundary must still reject grouped values. Do not claim an application exploit or preservation of unknown headers through subsequent normalization. Preserve the separate Medusa 5.6.0 parser. MIT; no runtime dependency/type change. |
| Sharp | 0.35.3 → 0.35.4; `2026-08-26T09:42:27.903Z` | [Native-image changes](https://github.com/lovell/sharp/compare/v0.35.3...v0.35.4) tighten dimensions/coordinates and fix palette depth, output page counts, and finished input streams. Libvips packages move 1.3.2 → 1.3.3 (published August 26), with minimum libvips 8.18.6. Keep the resource-limited worker, dimension/pixel/frame limits, metadata removal, and no-network/no-write permissions unchanged. Real normalization tests add both extreme aspect ratios and palette transparency; retain animation rejection and actual AVIF optimizer/image smoke. Apache-2.0 and existing bundled LGPL-3.0-or-later notices remain required. |
| PostCSS / esbuild | 8.5.26 (`2026-08-06T08:33:00.043Z`) / 0.28.2 (`2026-08-08T20:00:55.454Z`) | [PostCSS](https://github.com/postcss/postcss/compare/8.5.23...8.5.26) fixes source-map symlink escape, BOM handling, and visitor ordering; [esbuild](https://github.com/evanw/esbuild/releases/tag/v0.28.2) fixes CSS nesting/gamut, TypeScript alias tree-shaking, and output/deadlock edge cases. Mirror existing overrides in all three policies; preserve nanoid 3.3.18. Both builds, runtime images, Admin/browser rendering and bundle gates apply. MIT, unchanged engines. |
| Biome | 2.5.11; `2026-08-27T20:48:36.074Z` | [Release notes](https://biomejs.dev/internals/changelog/version/2-5-11/) improve noFloatingPromises inference and parser handling. Update the schema URL; run non-writing checks before any targeted formatting. No blanket autofix, suppression, or newly enabled nursery rules. MIT OR Apache-2.0. |
| Vitest / coverage | Both 4.1.11; August 18 | [Patch comparison](https://github.com/vitest-dev/vitest/compare/v4.1.10...v4.1.11) fixes concurrent lifecycle limits and browser-mock filesystem redirect restrictions. Keep all sibling packages coherent; jsdom runners and both unchanged coverage thresholds remain authoritative. No Vitest 5 or Vite migration. MIT. |
| Testing Library | React 16.3.3 (`2026-08-27T17:41:18.735Z`), jest-dom 7.0.1 (`2026-08-09T23:44:33.598Z`) | [React comparison](https://github.com/testing-library/react-testing-library/compare/v16.3.2...v16.3.3) restores act state after nested event dispatch; [jest-dom](https://github.com/testing-library/jest-dom/compare/v7.0.0...v7.0.1) only adds an optional Vitest peer. Retain actual interaction/fake-timer regressions and React 18/19 isolation. MIT, unchanged runtime floors. |
| Playwright | 1.62.1; `2026-07-30T16:36:55.324Z` | [Release](https://github.com/microsoft/playwright/releases/tag/v1.62.1) fixes tsconfig resolution, aria snapshots, and branded evaluate arguments. Published browser revisions are unchanged: Chromium 1234, Firefox 1538, WebKit 2336. Update the fixture's exact tool-version contract, retain read-only fixture guards, and run all three engines without a browser download or permission expansion. Apache-2.0. |

The installed pre-upgrade baselines pass nine catalog/UI state tests and nine
native image normalization tests. New gallery/Quick shop browser cases use
an exact-handle-only local fixture, without changing the catalog list or
calling media/payment providers. Keyboard checks also found an existing
controlled Drawer focus-restoration gap: Quick shop/cart close can return
focus to the document body. A bounded fix and regression acceptance belong
in this batch, not in claims about the preceding SDK deployment.

On the updated graph, all 28 parser/import tests pass, fixing the four
pre-upgrade parser failures without changing the application import options.
The gallery regression separately reproduces a stale active index after the
last image fails; clamping the current index before decrement restores a
single-press Previous action. Controlled Drawer restoration captures its
actual opener before autofocus, preserves explicit consumer hooks, and avoids
removed/disabled/hidden targets, navigation, unrelated focus, and superseded
close events. Tests cover StrictMode, rapid reopen, full unmount, and nested
drawers; this does not introduce a global focus manager.

Final pinned-runtime Backend coverage passes 275 suites / 2,099 tests at
91.67% statements/lines, 85.49% branches, and 95.78% functions. Backend/Admin
builds complete in 6.20/15.95 seconds; the generated frozen runtime verifies
1,813 entries and installs 1,072 dependencies without downloading a new graph.
Storefront baseline coverage passes 142 files / 857 tests at 94.39% lines and
86.41% branches; transactional coverage remains 36 files / 322 tests at
83.86% lines and 76.50% branches, above its unchanged configured thresholds.
The final production build compiles in 4.8 seconds with the existing build
cache, 55 routes, and 131 verified client assets. Fixture category-fallback
diagnostics remain visible and are
not presented as zero-error runtime evidence. Root lint/typecheck, boundary
checks, production Router backports, peers, and the existing audit policy pass.
The rebuilt Admin matrix passes 12/12 with zero axe violations/incomplete
checks, findings, review codes, or case errors. Five inspected rendered
screenshots across 760–1,920 px show no visible regression; artifacts are at
`/tmp/remorseless-tooling-admin-node265.SYThuV`. The focused Drawer/gallery
suite passes 24 tests with 100% lines, 91.30% branches, and 100% functions;
its aggregate coverage thresholds are unchanged. Final Storefront critical
browser acceptance passes 48/48 with zero retries, and the responsive matrix
passes 81 with two pre-existing desktop-only skips and zero retries. A
test-only cart-bootstrap response barrier prevents typing into the search
field before hydration; ten repeated WebKit checks also pass without retry.
Launch acceptance also passes 14/14 with zero retries. Headed Chromium
rendering and real desktop Flameshot captures verify the cart, calendar sort
menu, and gallery at reduced motion; the gallery and drawer keyboard checks
also pass. Screenshots remain local and are not committed or uploaded.
Standalone pa11y cannot launch the installed Chromium sandbox on this
workstation: all four configured paths fail before navigation with the
existing AppArmor/user-namespace limitation. The separate mobile/Lighthouse
runners are not claimed as local passes. No sandbox bypass or host-policy
change was made; exact-SHA sandboxed GitHub pa11y and Lighthouse remain
required before release acceptance.

Hold Medusa UI 4.2.1: integrity-verified runtime files and patch inputs are
unchanged, while its sole effective change pulls icons 2.19.0 across the
separate Medusa migration boundary. Quicklink 3.0.2 and Tailwind Variants
3.3.1 are cooled, but Quicklink's provider is unmounted and Tailwind Variants
has no owned app consumer. This batch does not activate dormant helpers or
undertake an unused resolver rewrite.
Motion 13, Vitest 5, and recent uncooled releases remain out of scope.

### Medusa 2.19 licensing hold

The official [2.19 Enterprise license](https://raw.githubusercontent.com/medusajs/medusa/v2.19.0/ENTERPRISE-LICENSE.md)
requires a separate commercial agreement for the newly licensed RBAC/SSO
materials, including policy definitions, permission middleware, relevant
Admin/SDK paths, and their compiled forms. It expressly preserves earlier
MIT grants. This app registers the RBAC module, defines custom policies,
and reads Admin permissions; disabling those guards is not an acceptable
upgrade workaround. Keep the MIT-licensed 2.18 graph and compatible Admin
UI until the owner confirms commercial rights or separately approves an
authorization migration. No 2.19 install, feature-flag change, or license
exception was made. The technical Vite/Router/SDK/patch review below is
secondary to that unresolved licensing decision.

## Compatibility upgrade plan — 2026-09-03, batching revised 2026-09-06

`pnpm outdated --recursive --format json` was reviewed against registry publish
times and official release notes. The user explicitly replaced the original
one-family-per-push cadence on 2026-09-06 with larger release batches.
Compatible families may now share a reviewed lockfile resolution, full local
gate, exact-SHA CI run, and watched-service Railway acceptance. Preserve
family-specific upstream review and focused tests, and use logical commits
for the implementation and test-harness changes. Do not perform a deployment
or documentation-only push after every small family. Breaking migrations,
cooling holds, and provider-specific acceptance requirements remain in force.

| Order | Cohort | Target and boundary |
| ----- | ------ | ------------------- |
| 1 | Next.js | Complete the 16.3.3 critical security update above. Re-evaluate 16.3.4 only after its cooling expiry and rerun the image, nonce/CSP, Trusted Types, production-build, responsive browser, accessibility, and Lighthouse gates. |
| 2 | `qs` | Complete: root, Backend, and Storefront use one exact 6.16.0 graph after the cooling expiry; both advisory ignores, all three patch copies, and the temporary verifier were removed together. |
| 3 | Medusa | Blocked first on the 2.19 RBAC/SSO licensing decision above. After that is resolved, move every Backend and Storefront `@medusajs/*` package together. The official [2.19 release](https://github.com/medusajs/medusa/releases/tag/v2.19.0) is a breaking Admin migration to Vite 7.3.6 and React Router 7.18.2. Audit removed SDK Product Option methods, `Response.json()` and `defer()` usage, `UIMatch.loaderData`, cart/order wildcard totals, every Medusa patch, Admin browser/a11y contracts, migrations, and complete checkout/refund/tax behavior before staging. |
| 4 | TanStack | Completed the five Query persistence/runtime package update to 5.102.7 with local, exact-SHA CI, runtime-image, and Railway acceptance. Review Form 1.33.5, Pacer 0.22.0, and cooled Query patches individually, then include compatible results in the combined batch. Preserve validation/focus, debounce/cancellation, and cache/persistence regressions. Hold Table 9 for an explicit API migration. |
| 5 | Stripe | Review `stripe` 22.6.0 independently from the browser pair, then share the compatible batch above. Its release pins a new API version and changes connection-error behavior. Update `@stripe/react-stripe-js` 6.8.2 with `@stripe/stripe-js` 9.14.0 only after rebasing or removing the exact Trusted Types loader patch, then rerun checkout, 3DS, response-loss, webhook, refund, CSP, and three-engine browser matrices. |
| 6 | AWS SDK | Update the S3 client to the newly reviewed cooled 3.1121.0 with its compatible core graph. Recheck the locally patched abort/timeout behavior, MinIO path-style requests, release `HeadBucket`, upload compensation, media backup, and runtime image scan before removing any core override. |
| 7 | OpenTelemetry | Move the experimental SDK and matching instrumentations as one compatibility set: SDK Node 0.221.0 and the corresponding Redis, ioredis, Knex, PostgreSQL, and runtime packages. Keep stable API/trace packages on their compatible line; prove preload ordering, shutdown, redaction, trace correlation, RED metrics, and provider-disabled startup. |
| 8 | Small runtime and tool patches | Redis 6.2.1 is complete with local, exact-SHA CI, runtime-image, Railway, and staging acceptance. Batch reviewed Resend, PostHog, and UI/test patches; recheck newest cooled versions instead of assuming the September 3 targets remain current. Preserve functional email, rate-limit, analytics, browser, and coverage tests. Exact GitHub Action updates still require immutable-action and egress-policy verification. |

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
3. dependency cooling, audit, React Router backport verification, and hook
   validation
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
