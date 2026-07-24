# Dependency Migration Audit — 2026-07-23

This audit covers the dependency refresh begun in commit `a697093` and
completed in commit `578ad0e`. The review used upstream migration guides,
release notes, published peer ranges, and the installed Medusa package
contracts.

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
| TruffleHog Action           | 3.91 → 3.95  | [v3.95.9](https://github.com/trufflesecurity/trufflehog/releases/tag/v3.95.9) retains the action interface and adds detector/retry fixes.                                                                                                                                                                                                                     | Updated all secret-scan jobs while retaining verified-only scanning.                                                                                                                                                                                                                                                 |

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

pnpm’s audit is version-based and cannot detect a patched package, so only
these three GHSA records are listed under `auditConfig.ignoreGhsas`. This is
paired with a required `pnpm run qa:react-router-security` CI check that loads
the installed production artifacts and verifies mixed-separator navigation,
redirect handling, link handling, and blocked custom hydration constructors.
pnpm 11 also fails installation if either exact patch stops applying.

## Deliberate major-version holds

These are not forgotten upgrades. Each latest major conflicts with an active
upstream contract:

| Dependency            | Available   | Hold reason                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint / `@eslint/js` | 10.7 / 10.0 | The [ESLint 10 guide](https://eslint.org/docs/latest/use/migrate-to-10.0.0) is compatible with the repository’s flat config, but the latest `eslint-plugin-jsx-a11y` 6.10.2 declares support only through ESLint 9. ESLint remains at 9.39.5 to keep the accessibility gate supported.                                                                                                                                              |
| TypeScript            | 7.0.2       | TypeScript 7 has no stable programmatic API for embedded tools, and [typescript-eslint supports only TypeScript `<6.1`](https://typescript-eslint.io/users/dependency-versions/). TypeScript 6.0.2 was also tested, but Medusa UI 4.2.0 pins `cva@1.0.0-beta.1`, whose peer range is `<6`. TypeScript remains at 5.9.3. Deprecated `baseUrl` usage was removed so the local configuration is ready for a later supported migration. |
| React (backend admin) | 19.2.8      | The storefront remains on React 19.2.8. Medusa dashboard 2.18 and draft-order 2.18 publish React/React DOM 18.3.1 contracts, so the separately built backend admin uses React 18.3.1 and matching type packages instead of forcing the storefront runtime into it.                                                                                                                                                                  |
| MikroORM              | 7.1.7       | Medusa 2.18.0’s published `@medusajs/deps` package pins all MikroORM packages exactly to 6.6.14. The [MikroORM 7 guide](https://mikro-orm.io/docs/upgrading-v6-to-v7) also introduces native ESM, decorator-package changes, query semantics, and persistence behavior changes. The framework-owned pin is retained.                                                                                                                |
| Awilix                | 13.0.5      | Medusa 2.18.0’s published dependency contract is `awilix ^8.0.1`; forcing 13 would create an unsupported container/runtime split. The framework-compatible 8.0.1 is retained.                                                                                                                                                                                                                                                       |

## Release verification

The migration is complete only after:

1. `pnpm install --frozen-lockfile` and `pnpm peers check`
2. lint, strict typecheck, unit/coverage, and production builds
3. dependency audit, React Router backport verification, and hook validation
4. Playwright device/browser smoke validation
5. successful GitHub Actions and Railway staging deployments
6. post-deploy route and API smoke checks
