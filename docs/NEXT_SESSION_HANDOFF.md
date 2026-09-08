# Next-session handoff

Last updated: 2026-09-08

This document records the local and GitHub acceptance boundary for application
and infrastructure hardening. GitHub image evidence does not prove which
artifact Railway is running; verify Railway separately with the sequence below.

## Repository state

- Branch: `staging`
- Current accepted implementation head:
  `80a83ced17a2b5cc937aff1edfff0d9cfbbd49d7`. It includes the accepted Next.js
  16.3.4 AVIF correction and build split, Redis 6.2.1, upstream `qs` 6.16.0, Trusted Types
  enforcement, the Form/Resend/PostHog/Pacer/Query/Virtual/Sonner batch, and
  the AWS/Stripe/OpenTelemetry, UI/parser/image/tooling, and recovery batches.
  Complete local, exact-SHA CI, runtime-image, and Railway staging evidence is recorded
  below, including the deployed test-only hydration correction and the bounded
  PostgreSQL backup/restore execution, Redis observation and shared-CI
  contract parity batches, plus checkout read/write isolation, native webhook
  error redaction and concurrent-request tracing lifecycle corrections.
- Latest exact runtime-image validation SHA:
  `80a83ced17a2b5cc937aff1edfff0d9cfbbd49d7`. All four CI workflows and
  both Railway source deployments passed. The live shared-trace regression
  that prevented acceptance of `3f9c533` now passes with four exact HTTP 200
  completion records; detailed correction evidence is below.
- The prior PostgreSQL release's acceptance notes shipped with the substantive
  Redis batch; Redis acceptance notes shipped with the shared-CI contract
  follow-up. Final CI-parity acceptance notes shipped with the substantive
  `3f9c533` application batch; its staging discovery shipped with the
  substantive `4ba7996` correction. Final Next.js acceptance notes are included
  with the substantive maintenance batch below; no documentation-only push
  was made.
- Original implementation/runtime-image acceptance SHA
  `61fd86889a4adca23e1e9704e11c889a1fd986a9` is pushed to
  `origin/staging`. Backend source deployment acceptance is documented at
  `d7e5d43013a89af434f767cda0c6d2bd6ec4d9f6` because Railway rebuilt that
  documentation head after the earlier security deployment was superseded.
  Documentation-only commits `1a6c54ee2244909bab93993fe064ac97158e4e26`
  and `060af53115ed1ae85d2f8d02d6fd0590c8e6a02d` subsequently passed all four
  workflows and correctly skipped both Railway services. Documentation commit
  `d4d89dca4a634d48ff4fd047d0e4502bbec25604` also passed Root run
  `33746614907`, Backend run `33746614970`, Storefront run `33746615170`, and
  Runtime Images run `33746614902`; both Railway services correctly skipped
  it through Backend deployment `284bf79d-633c-4fdc-a29a-7a24f0660ec7` and
  Storefront deployment `66a85fa4-977c-4a56-8343-7008c817ba37`.
  Documentation commits do not supersede runtime-image evidence.
- Documentation head `6d349ae64cd5226ca3a65882806625a915350c06` passed Root
  `34041747473`, Backend `34041747478`, Storefront `34041747480`, and Runtime
  Images `34041747482`. Railway correctly skipped Backend
  `bb8ac9a6-6836-426f-871a-c67af21766ae` and Storefront
  `3ceba04f-8d86-4152-a398-c862ed2585c3`; both services remained healthy on
  implementation `5b6588fc9ae7f9ed8854f202dd129753f149a82a`.
- Original Runtime Images run `33688896070` passed both services at
  `61fd86889a4adca23e1e9704e11c889a1fd986a9`; Backend job `100442798263`
  and Storefront job `100442798721` succeeded,
  while publication job `100442800014` skipped on `staging` as required.
- Original Root run `33688896124`, Backend run `33688896267`, and Storefront
  run `33688896038` all passed at `61fd86889a4adca23e1e9704e11c889a1fd986a9`.
  Storefront included
  Security & Audit, CodeQL, typecheck/Trivy, lint, secret scan, unit, build,
  Browser Smoke, pa11y, and Lighthouse.
- Manual staging operations run `33692222542` and scheduler run `33692224408`
  passed after the exact Backend deployment. Their retained, sanitized
  observations report healthy dependencies, catalog projections, Redis, job
  heartbeat, retention state, and incident state. No production environment
  exists and no production state was changed.
- External scheduler alert and no-recurrence acceptance is complete. Real
  incident issue `#5` stayed open through the 24-hour incident latch and closed
  only after scheduled run `33523928277` observed a healthy endpoint on
  September 1. All 15 recorded monitor runs through `33720902233` succeeded.
  Manual run `33692224408` retained sanitized artifact `9870456138` through
  October 2, and a September 3 live read remained healthy with no incident or
  alert reason.
- Dependabot PR `#6` is closed. It proposed only the Backend manifest half of
  the `sanitize-html` 2.17.7 update, while commit
  `5af1abf2821836111bac56704ac56d7f8322a08d` upgrades both direct consumers,
  updates the shared lockfile, and proves the compatibility path.
- `Default/` is unrelated untracked user data. Do not read, modify, stage, or
  commit it.
- Railway remains on the existing staging source/Railpack configuration. A
  source-preserving Backend redeploy pulled the already-green current GitHub
  head; no service source, credential, package visibility, domain, traffic, or
  production setting changed.

The completed commits on `staging` are:

- `402c10111c144d407d4c75168ef69588d6768371` restores the deterministic
  discography fixture;
- `5af1abf2821836111bac56704ac56d7f8322a08d` upgrades the sanitizer;
- `7dbee18a3fff3ef16821ac89a2c45a8d94e950b9` adds the immutable runtime-image
  pipeline;
- `d2ee4b2a589bc327deaefe6d48b3140d928e636b` adds runtime build fixtures;
- `870545543fe2fde5b94021b6f6691289543f0b32` completes runtime build
  dependencies;
- `ead91c5954581cda886d2e135ff1496f8aa5d886` initializes the private runtime
  evidence directory before SBOM generation;
- `9a410faadb1054dd0a5b847486a0bfc3a81b521e` defers product-detail response
  validation until the intent-driven request resolves;
- `f3b71a6482ce941ad253672983547c494caa8d56` records the first exact-SHA
  continuation evidence;
- `56d42bbdd50be90e431ced71b8c6c74bf4d62cb0` upgrades mature `fast-uri` and
  behaviorally backports the two `qs` fixes still inside the cooling window;
- `d17a4b5282813dc0d028b27cd6c181015d67244c` records the transitive advisory
  response and the first post-remediation acceptance plan; and
- `61fd86889a4adca23e1e9704e11c889a1fd986a9` calibrates Lighthouse's hosted
  runner CPU slowdown without changing any assertion budget; and
- `d7e5d43013a89af434f767cda0c6d2bd6ec4d9f6` records exact CI and retained
  runtime-image acceptance before the staging runtime observation; and
- `1a6c54ee2244909bab93993fe064ac97158e4e26` records the completed staging
  source-deployment and operational acceptance; and
- `060af53115ed1ae85d2f8d02d6fd0590c8e6a02d` synchronizes the final exact-SHA
  CI, runtime-image, and Railway skip evidence; and
- `cd16721148fc11791a8bfcdfed844a1070526b2c` upgrades the Storefront to the
  mature Next.js 16.3.3 critical security release and records the isolated
  compatibility cohorts; and
- `8d5d73e2fd80617de575ea269211816f7142f852` separates the source-server and
  runtime-image build targets after exact staging logs exposed the unsupported
  `next start` plus standalone-output pairing; and
- `c72942c1734858f15dd178b71a1e7401fa4da27a` updates the five Storefront
  TanStack Query runtime/persistence packages to the cooled 5.102.7 patch line
  and records local compatibility evidence; and
- `d4d89dca4a634d48ff4fd047d0e4502bbec25604` records the complete Query
  exact-SHA CI, runtime-image, Railway, and staging observation evidence; and
- `6df5cbb2d0dcd111b87ed7cf0b2c03015f336e1a` updates the shared Backend and
  Storefront Redis client graph to the cooled 6.2.1 patch line; and
- `5ea7a53` normalizes unset pnpm configuration values in the Backend
  packager without weakening the dependency policy; and
- `58ed443` replaces the temporary `qs` backport with upstream 6.16.0; and
- `0ab0f2c` supports HTTPS deployed browser targets and waits for document
  loading before the cookie-consent interaction; and
- `64a06a7` pins Playwright 1.62.0 and preserves its installed dependency
  graph when starting the CI browser server; and
- `53cecd4` enforces the three named Trusted Types policies outside
  development while retaining report-only telemetry; and
- `5b6588f` applies the installed Next CLI launch to every local browser
  configuration and verifies that contract.

The containing change set updates the following tracked files for the
runtime-image implementation, documentation, and fixture/security corrections:

- `README.md`
- `.github/workflows/storefront.yml`
- `backend/package.json`
- `backend/scripts/lib/release-prepare.mjs`
- `backend/src/lib/content/rich-text.test.ts`
- `docs/DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md`
- `docs/INFRASTRUCTURE_RECOVERY.md`
- `docs/PRODUCTION_HARDENING_PLAN.md`
- `docs/QA_RUNBOOK.md`
- `docs/RELEASE_OPERATIONS.md`
- `lighthouse/lhci.config.js`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/release-prepare.test.mjs`
- `scripts/security/ci-runtime-security-policy.json`
- `scripts/verify-ci-runtime-security-policy.mjs`
- `scripts/verify-ci-runtime-security-policy.test.mjs`
- `storefront/next.config.ts`
- `storefront/package.json`
- `storefront/scripts/ci-medusa-fixture.mjs`
- `storefront/scripts/ci-medusa-fixture.test.mjs`
- `storefront/src/lib/news/rich-text.test.ts`

New runtime files in the containing change set:

- `.dockerignore`
- `.github/workflows/runtime-images.yml`
- `backend/Dockerfile.runtime`
- `backend/scripts/runtime-release-prepare.mjs`
- `docs/NEXT_SESSION_HANDOFF.md`
- `scripts/security/runtime-image-policy.json`
- `scripts/verify-runtime-image-artifacts.mjs`
- `scripts/verify-runtime-image-policy.mjs`
- `scripts/verify-runtime-image-policy.test.mjs`
- `scripts/write-runtime-image-record.mjs`
- `storefront/Dockerfile.runtime`

## Implemented boundaries

- Next.js emits a repository-root-aware standalone artifact. Backend and
  Storefront runtime Dockerfiles use the exact multi-platform
  `node:26.5.0-bookworm-slim` digest, copy only built runtime artifacts, set
  exact OCI source/revision labels, and run as UID 1000.
- Both final images remove npm and npx. The original scan found eight fixed
  high/critical advisories entirely below the base image's bundled npm tree;
  the final images remove that unused attack surface instead of suppressing
  findings.
- Backend release preparation has a package-manager-free Node runner for
  migration, link synchronization, object-storage readiness, and versioned
  Meilisearch rebuild. A future image-based Railway pre-deploy command is
  `node ./scripts/runtime-release-prepare.mjs`.
- The Runtime Images workflow has mutually exclusive validation and publication
  jobs. Validation is read-only and never logs in, pushes, or attests.
  Publication requires `refs/heads/master`, builds, smokes, and vulnerability
  scans locally before registry login or push, then resolves the published
  manifest digest, records it, and attests that immutable subject.
- Both workflow jobs use deny-by-default egress, immutable action commits,
  Trivy 0.70.0 with the reviewed GHCR database, fixed HIGH/CRITICAL failure,
  CycloneDX output, and digest-linked records. Policy tests bind all conditions,
  permissions, action identities, scan controls, image identities, and smoke
  behavior.
- The deterministic Medusa fixture now emits an RFC 3339 discography release
  timestamp. Browser Smoke therefore proves non-empty discography membership
  rather than rendering the fallback state.
- Backend and Storefront pin `sanitize-html` 2.17.7, closing
  `GHSA-g8qq-57p8-ggw5` without a cooling exception. Both sanitizer suites cover
  the SVG animation URI-list vector. Backend unit/coverage scripts use Jest's
  VM-modules runtime for the patched release's ESM-only `htmlparser2` 12 tree.
- `fast-uri` is pinned to mature 3.1.6, closing four high-severity host
  confusion/SSRF advisories without an audit ignore or cooling exception.
- Root, Backend, and Storefront now pin upstream `qs` 6.16.0 after its
  seven-day cooling window ended at `2026-09-05T23:50:15.803Z`. Both audit
  ignores, all three patch copies, the temporary verifier, and its exceptions
  were removed together. Direct checks through both application paths pass
  the former bracket/comma `arrayLimit` and hostile `constructor.isBuffer`
  regressions on the upstream release.

## Local acceptance evidence

- `pnpm install --frozen-lockfile`: passed with pnpm 11.17.0.
- `pnpm run qa:lint`: passed, including Biome, both strict TypeScript checks,
  database release boundaries, runtime-image policy, CI egress policy, and all
  repository contract verifiers after the final code and documentation edits.
- Runtime policy: 9/9 focused tests plus static verifier passed.
- CI runtime-security policy: 4/4 focused tests plus the six-workflow verifier
  passed; the Runtime Images workflow contains two separately hardened jobs.
- Release-plan policy: 6/6 focused tests passed.
- Backend coverage: 273 suites / 2,067 tests passed; 91.58% statements, 85.31%
  branches, 95.78% functions, and 91.58% lines.
- Storefront baseline coverage passed at 94.37% statements, 86.07% branches,
  95.83% functions, and 94.39% lines. The transactional suite passed 36 files /
  322 tests at 83.73% statements and 76.50% branches.
- Disposable integration passed all 4 PostgreSQL/Redis tests, 5 payment/queue
  suites / 41 tests, and 3 API-contract tests against the exact CI PostgreSQL
  18.6 and Redis 8.10.1 image digests. The local Docker port-forwarding layer
  reset connections, so the successful retry used Linux host networking; test
  inputs, images, application code, and assertions were unchanged.
- Browser Smoke passed 54 responsive journeys with two expected skips and no
  failures after the fixture correction.
- The six-route Lighthouse gate passed all 18 samples without changing a
  threshold. `/catalog` median total blocking time was 91 ms; every route scored
  1.00 for accessibility and best practices.
- Backend and Storefront production builds passed with `sanitize-html` 2.17.7,
  `fast-uri` 3.1.6, and the upstream `qs` 6.16.0 graph.
  The client-bundle scanner found no server-only secret or public Meilisearch
  input in 131 Storefront assets.
- `pnpm audit --prod --audit-level=moderate` passed with only the three
  documented, behaviorally patched React Router findings ignored. The four
  `fast-uri` findings are eliminated by the 3.1.6 upgrade.
- Fresh local runtime image candidates:
  - Backend:
    `sha256:954da9673f481cb152559eb2e4bc32920c5a6f9868ffacdbf49b061a661ea58d`
  - Storefront:
    `sha256:b8040b0989e6a91d0ecff2d99cde70c9f434222836ccc7c2968f3e826e428b7c`
- Both images passed UID 1000, Node 26.5.0, npm/npx absence, runtime-file,
  command, exposed-port, source/revision-label, and health contracts.
  Storefront `/live` returned 200 with the candidate revision; `/ready` returned
  the correct dependency-aware 503/degraded response with the same revision.
- Trivy 0.70.0 used its 2026-09-02 GHCR vulnerability database and found zero
  fixed HIGH/CRITICAL vulnerabilities in both exact images. Digest-bound
  CycloneDX verification passed with 1,183 Backend components and 122
  Storefront components. Private local evidence is under
  `/tmp/remorseless-runtime-artifacts-final.xjYFpZ` and must not be committed.
- No rendered UI changed in this slice, so graphical screenshot validation is
  not applicable.

The local image labels use the validation base SHA while containing the
pre-commit candidate worktree. They are local validation evidence only, not
release artifacts. The exact-SHA GitHub rebuild below supersedes them as the
definitive runtime-image validation evidence for this slice.

## Exact-SHA GitHub evidence

Runtime Images run `33626579333` rebuilt both images at
`ead91c5954581cda886d2e135ff1496f8aa5d886`. Backend job `100235640807` and
Storefront job `100235640612` built, smoked, scanned, and retained private
evidence successfully. Publication job `100235641535` skipped without registry
login or publication. The retained artifacts expire on 2026-10-02:

- `runtime-image-backend-ead91c5954581cda886d2e135ff1496f8aa5d886`
  (112,297 bytes); and
- `runtime-image-storefront-ead91c5954581cda886d2e135ff1496f8aa5d886`
  (48,645 bytes).

The original Storefront Lighthouse diagnosis remains useful historical
evidence. The previous green comparison run is `33499795322` at
`b48385ad1b76545fd99b7727d4c11aa815e6b8a3`; its three `/catalog` total blocking
times were 367, 334.5, and 289 ms (334.5 ms median). Attempt 2 of current run
`33626579305` measured 450, 368.5, and 350.5 ms (368.5 ms median) against the
350 ms limit. Its performance scores were 0.82, 0.76, and 0.80 against the 0.80
minimum. Do not lower either threshold or repeatedly rerun the unchanged SHA.

Retained Lighthouse artifact `storefront-lighthouse-33626579305` has artifact
ID `9845805549` and expires on 2026-09-16. A local diagnostic copy was extracted
under `/tmp/remorseless-lighthouse-IcdObH`; this temporary path may not survive
the next session. The reports show:

- the two large React/React DOM framework chunks have the same hashes and byte
  sizes as the last green run;
- the current catalog DOM is only 219 elements, so excessive DOM size is not
  the cause;
- the current run attributes one 96 ms long task to the layout chunk, alongside
  route-dependent React hydration tasks; and
- the new product response validator is eagerly bundled through
  `src/lib/query/products.ts` into shared chunk `555`, which grew from 18,705 to
  20,486 uncompressed bytes. This is the leading optimization candidate, not
  yet a proven sole cause.

The continuation candidate defers `readStoreProductDetailResponse` with a
dynamic import inside the product-detail query function. Invalid provider
payloads still fail closed after a request resolves, while initial catalog
rendering no longer loads or parses the validator. The production build emits
the validator as a separate 1,949-byte async chunk and reduces shared chunk
`555` from 20,486 to 18,780 uncompressed bytes, close to its last-green size.

Local continuation evidence:

- the focused product-query suite passed 8/8 tests, including malformed
  response rejection;
- repository policy/static QA and both strict TypeScript checks passed;
- Storefront coverage passed 139 files / 829 tests at 94.37% statements and
  86.06% branches, plus 36 files / 322 transactional tests at 83.73%
  statements and 76.50% branches;
- the deterministic production build passed and the client scanner verified
  131 assets;
- focused `/catalog` Lighthouse passed at 0.85 performance in all three samples
  with 101, 90, and 68 ms total blocking time;
- the complete six-route Lighthouse gate passed all 18 samples. Median total
  blocking time was 12 ms Home, 85 ms Catalog, 25 ms Product, 17 ms Cart,
  68 ms Checkout, and 36 ms Privacy; and
- the critical guest-commerce browser matrix passed all 21 Chromium, Firefox,
  and WebKit journeys, including quick shop and Product detail.

No rendered UI changed, so graphical screenshot validation is not applicable.

The final exact-SHA acceptance is
`61fd86889a4adca23e1e9704e11c889a1fd986a9`:

- Root CI run `33688896124`: passed.
- Backend CI run `33688896267`: passed all security, CodeQL, lint, typecheck,
  Trivy, disposable PostgreSQL/Redis integration, unit, and build jobs.
- Runtime Images run `33688896070`: Backend job `100442798263` and Storefront
  job `100442798721` passed their build, smoke, HIGH/CRITICAL scan, SBOM, and
  private-retention boundaries. Publication job `100442800014` skipped without
  registry login or publication.
- Storefront CI run `33688896038`: passed every job. Browser Smoke job
  `100444772383`, pa11y job `100444772464`, and Lighthouse job `100444772456`
  all succeeded.

The retained runtime-image artifacts expire on 2026-10-02:

- `runtime-image-backend-61fd86889a4adca23e1e9704e11c889a1fd986a9`,
  artifact ID `9869317979`, 112,342 bytes; and
- `runtime-image-storefront-61fd86889a4adca23e1e9704e11c889a1fd986a9`,
  artifact ID `9869287830`, 48,646 bytes.

Retained Lighthouse artifact `storefront-lighthouse-33688896038` has artifact
ID `9869655887`, is 4,255,428 bytes, and expires on
`2026-09-16T22:22:50Z`. A diagnostic copy was extracted to
`/tmp/remorseless-lighthouse-61fd868-xJXRJQ`; the temporary path may not survive
the next session. All 18 reports record the intended 2x CPU slowdown. Their CPU
benchmark indexes span 2,234.5 through 2,447.5, confirming the hosted runner is
in the low-end-desktop class for which Lighthouse documents 2x as the
mid-tier-mobile calibration.

The exact median performance/TBT results were:

| Route | Performance | TBT |
| --- | ---: | ---: |
| Home | 0.86 | 23 ms |
| Catalog | 0.86 | 113 ms |
| Product | 0.88 | 48 ms |
| Cart | 0.87 | 47 ms |
| Checkout | 0.89 | 110 ms |
| Privacy | 0.87 | 39 ms |

Every route scored 1.00 for accessibility and best practices. SEO scored 1.00
except Privacy at 0.92 and noindex Checkout at 0.61, both within the existing
route-specific contract. No assertion threshold, route, run count, or median
aggregation changed.

The original 4x failure at Storefront run `33686733429` remains diagnostic
evidence rather than an application regression. Its median hosted-runner
benchmark index was about 2,300 while the accepted local 4x run was about
4,500; identical payload sizes took roughly twice the main-thread time on the
hosted runner. The calibration test proves that the 4x local and 2x hosted
configurations share the exact same assertion matrix and reject multipliers
outside 1 through 20.

Local `pnpm run qa:lint` passed twice, including both strict TypeScript checks
and the new 4/4 Storefront fixture/config tests. The pre-push hook also passed
Storefront baseline coverage at 94.37% statements and 86.06% branches plus the
transactional scope at 83.73% statements and 76.50% branches. A new local
Lighthouse collection was not run because the only installed Chrome binary
could not launch its sandbox under the workstation's AppArmor user-namespace
policy. The container-only `LHCI_CHROME_NO_SANDBOX=1` escape hatch was not used;
the sandboxed GitHub result above is the final performance evidence.

## Staging runtime acceptance

Documentation head `d7e5d43013a89af434f767cda0c6d2bd6ec4d9f6` passed Root
run `33690449881`, Backend run `33690449926`, Storefront run `33690449894`,
and Runtime Images run `33690449837`. Runtime publication remained skipped on
`staging`.

The subsequent runtime-acceptance handoff commit
`1a6c54ee2244909bab93993fe064ac97158e4e26` passed Root run
`33692951882`, Backend run `33692951868`, Storefront run `33692951918`, and
Runtime Images run `33692951875`. Runtime publication again remained skipped,
and both Railway services reported `SKIPPED` with `No changes to watched
files`.

Documentation synchronization commit
`060af53115ed1ae85d2f8d02d6fd0590c8e6a02d` passed Root run `33697084457`,
Backend run `33697084383`, Storefront run `33697084465`, and Runtime Images run
`33697084399`. Runtime publication again remained skipped. Railway Backend
record `1febc79e-2123-49e1-8f09-40528305899b` and Storefront record
`66e56b45-5aa5-4157-b905-7f62e94e97dd` both reported `SKIPPED` with `No changes
to watched files`.

Railway correctly skipped that documentation-only push for both watched source
trees. The earlier Backend security deployment had been superseded before
Railway accepted it, so the source-preserving `redeploy --from-source` path
rebuilt the already-green current GitHub head without changing the configured
source. Backend deployment `75650cfc-d897-46bb-b83c-b10aab077fc1` reached
`SUCCESS` at exact SHA `d7e5d43013a89af434f767cda0c6d2bd6ec4d9f6`.
Storefront deployment `3ab9b285-50ac-40cd-a777-4b9afd1948e4` was already
`SUCCESS` at exact implementation SHA
`61fd86889a4adca23e1e9704e11c889a1fd986a9`.

Post-deploy acceptance passed:

- Backend `/live`, `/ready`, `/health/scheduler`, and `/health/operations`
  returned 200 at the exact Backend SHA. Storefront `/live`, `/ready`, `/`, and
  `/catalog` returned 200 at the exact Storefront SHA.
- Manual operations run `33692222542` reported 461 Products, one bounded
  handle, 442 discography entries, three shelves, and 25 shelf memberships.
  All dependency and capability checks were `ok`; retention was healthy and
  no incident latch remained.
- Manual scheduler run `33692224408` reported a healthy reconciliation
  heartbeat 105 seconds old, Redis `ok`, and no alert reason. Internal Redis
  latency was 2.208 ms in the scheduler observation and 4.816 ms in the
  operations observation.
- Railway reported about 19.9 MB current Redis process memory and negligible
  CPU. Redis `INFO` reported 7.7 MB logical usage, 14.2 MB peak usage, zero
  evictions, and zero rejected connections. A bounded five-second sample added
  zero error replies, evictions, or rejected connections.
- The Storefront non-mutating cart read returned `cart: null`; the bounded
  catalog search returned one of 461 hits. Exact-request completion events for
  Backend readiness, Storefront readiness, cart, and search matched response
  trace IDs, service/environment, status, method, and deployed SHA. They
  contained none of the forbidden path, URL, query, header, body, stack, or
  user-agent fields.
- Exact-deployment runtime logs contained zero Redis/rate-limit failure
  matches, and Railway HTTP logs contained zero 429 or 503 responses for both
  accepted deployments.

Dependabot PR `#6` was rechecked and is already closed. Its Backend-only
manifest edit is superseded by the accepted shared-lockfile sanitizer update.

## Next.js 16.3.3 staging acceptance

The isolated framework cohort moved the Storefront from Next.js 16.2.12 to
16.3.3. This is the newest release outside the strict seven-day cooling window
and contains the reviewed critical RCE fixes, including the AVIF optimizer path
used by the Storefront. Next.js 16.3.4 remains in cooling until
`2026-09-07T20:00:51.381Z`.

Implementation commit `cd16721148fc11791a8bfcdfed844a1070526b2c` passed Root
run `33737713954`, Backend run `33737713948`, Storefront run `33737713947`, and
Runtime Images run `33737713943`. Backend deployment
`5c71182a-3def-48a6-a9db-922771f0ebb0` succeeded with image digest
`sha256:367e192147b0137b4a3c185973763d8bf3050801634ca490d06ae0739ffa4d61`.
Initial Storefront deployment `8f3a3f14-39e7-4186-b07f-0966dc71e63c` served
healthy traffic but was not accepted: exact logs showed Next's unsupported
`next start` plus `output: "standalone"` warning as an error-level record.

Corrective commit `8d5d73e2fd80617de575ea269211816f7142f852`
keeps ordinary builds on the server artifact used by source-based Railway
deployments and adds a fail-closed `build:runtime` command for standalone image
artifacts. Policy test 9/9 binds both image workflow paths to that command.
Local default-server and copied-standalone smokes passed `/live`, the public
logo, and AVIF optimization. Docker Desktop was unavailable locally, so no
local image was created; exact-SHA Runtime Images run `33740171294` is the
authoritative container build, runtime smoke, HIGH/CRITICAL scan, SBOM, and
retention evidence.

All corrective exact-SHA workflows passed:

- Root `33740171303`;
- Backend `33740171288`;
- Storefront `33740171301`, including unit coverage, build, responsive and
  three-engine browser flows, launch acceptance, pa11y, and Lighthouse; and
- Runtime Images `33740171294`, with successful Backend job `100599981110` and
  Storefront job `100599981486`; publication job `100599982855` skipped on
  `staging` as required.

Retained runtime evidence expires on 2026-10-03:

- Backend artifact `9887480253`, image digest
  `sha256:8563ce7ff64affa39f12495c3de99d015cd9c0b13692b0e1c05ca68912a31ff4`,
  with 1,183 CycloneDX components; and
- Storefront artifact `9887454050`, image digest
  `sha256:58cffaae3636afbb551bcbde75a4a47feeb13a854c4c57a53e837297804883a8`,
  with 122 CycloneDX components.

Storefront Lighthouse artifact `9887872729` and launch-acceptance artifact
`9887799740` expire on 2026-09-17. Temporary downloaded runtime evidence is
under `/tmp/remorseless-next-runtime-evidence.D1Eo1q` and must not be
committed.

Railway correctly skipped unchanged Backend deployment
`316d8cd5-3388-4bb0-bd9f-688b1d0bf463`. Corrected Storefront deployment
`e95043ae-6b4a-41c3-9816-e6606e51cbf4` succeeded at the exact SHA with image
digest
`sha256:d863e3780da48f88b98a60d8e83408078d070452b7cd15bfa8f457a2330e3ec0`.
Post-deploy `/live`, `/ready`, `/`, and `/catalog` returned 200; readiness
reported Backend and Redis `ok`; nonce CSP, HSTS, and Trusted Types report-only
headers remained present. The live optimizer returned 24,570 bytes as
`image/avif` with its sandboxed response CSP.

Exact-deployment logs contain zero unsupported-start warnings,
`AppRender.fetch` diagnostics, Trusted Types violation reports, or HTTP 4xx/5xx
records. Five bounded completion events matched the exact SHA,
service/environment, GET/200 status, request IDs, and trace IDs without
forbidden request details. Railway classifies the package runner's pre-existing
`$ next start` command echo as one error-level line; it has no application
event or error code and is not a Next/runtime failure. No production state was
changed. No rendered UI changed, so desktop screenshot validation does not
apply.

## TanStack Query 5.102.7 staging acceptance

The isolated Storefront cohort updates `@tanstack/react-query`, its devtools,
both persistence packages, and the storage persister from 5.101.4 to 5.102.7.
The target passed the seven-day cooling policy. Query 5.102.8 remains outside
the cohort until `2026-09-03T16:06:57.089Z`, and the Medusa-owned Backend/Admin
5.64.2 graph remains unchanged. The Storefront uses none of the removed
experimental before/after/prefetch methods.

Local acceptance passed:

- frozen pnpm 11.17.0 install, peer dependency check, supply-chain policy, and
  production audit with only the five documented moderate exceptions;
- the complete repository QA gate and strict Storefront typecheck;
- 16 focused cache/persistence/prefetch tests;
- baseline coverage across 139 files / 829 tests at 94.37% statements and
  86.06% branches, plus 36 transactional files / 322 tests at 83.73%
  statements and 76.50% branches;
- the 55-route production build and 131-asset client-secret scan;
- 54 responsive Chromium journeys with two intentional skips; and
- all 21 critical journeys in Chromium, Firefox, and WebKit.

No rendered UI changed, so desktop screenshot validation does not apply.

Exact implementation SHA `c72942c1734858f15dd178b71a1e7401fa4da27a`
passed Root run `33744311233`, Backend run `33744311279`, Storefront run
`33744311259`, and Runtime Images run `33744311304`. Runtime-image Backend job
`100613177609` and Storefront job `100613177853` passed; publication job
`100613178896` skipped on `staging` as required. Retained artifacts expire on
2026-10-03:

- Backend artifact `9889106275`, digest
  `sha256:b21c0cc59e0c67322f2633562b0db94664808b084589532464b3e55cb55260d9`,
  with 1,183 CycloneDX components; and
- Storefront artifact `9889072350`, digest
  `sha256:da86338ce948f3011535ad1fbdc87b98c6191d3b64c5cad9d09b2576fb2b2aae`,
  with 122 CycloneDX components.

Storefront Lighthouse artifact `9889478136` and launch-acceptance artifact
`9889444876` expire on 2026-09-17. Temporary downloaded runtime evidence is
under `/tmp/remorseless-query-runtime-evidence.gwnUQV`, and smoke evidence is
under `/tmp/remorseless-query-smoke.MC7KrC`; neither path may be committed.

Railway Backend deployment `23338f13-c4d2-4299-a4f2-9655a662a958` reached
`SUCCESS` with source-image digest
`sha256:e4d463395074c5b9135e3caff7bc1dea1f16a836f0f1a90c8d92685797c5361c`.
Storefront deployment `83071db0-cd2f-49a6-b957-1cd6b8d44bfa` reached
`SUCCESS` with digest
`sha256:40f7eda9c15c7c68f7e2987210886f99418fda76aa4f60fa67ec2bb9ddcd6904`.
Both `/live` and `/ready` routes returned 200 and the exact SHA. Backend
readiness passed database, Redis, search, object storage, and every configured
capability; scheduler and operations health returned 200. Storefront readiness
passed Backend and Redis; root and catalog returned 200. Nonce CSP, HSTS,
Trusted Types report-only, and `nosniff` headers remained present. A live image
optimizer request returned a valid 7,027-byte AVIF under its sandboxed CSP.

The exact-deployment bounded review found zero HTTP 4xx/5xx records, zero
application error events, zero forbidden completion fields, and no Trusted
Types report, `AppRender.fetch` diagnostic, or standalone-output warning.
Every reviewed completion event was a GET/200 record with the exact SHA,
service, environment, request ID, trace ID, and span ID. Each deployment has
one Railway-classified error line that is a command echo with no application
event: Backend's Node release command and Storefront's `$ next start` banner.
No production state was changed.

## Redis 6.2.1 staging acceptance

The isolated shared-client cohort updates Backend Redis from `^6.1.0` to
`^6.2.1`, Storefront Redis from `6.1.0` to `6.2.1`, and the lockfile's Redis
client family to one coherent 6.2.1 graph. The target was published on
2026-08-11 and passed the strict seven-day cooling policy. The official 6.2.0
and 6.2.1 release notes were audited. Their cluster raw-command routing change
does not affect this repository because both services use standalone
`createClient` connections and no `createCluster` call or raw cluster dispatch.

Local acceptance passed:

- frozen install, peer dependency, supply-chain, production-audit, full QA,
  and both strict typecheck gates;
- 38 focused Backend tests across seven suites and 31 focused Storefront tests
  across five files;
- 273 Backend suites / 2,066 tests at 91.58% statements and 85.31% branches;
- 139 Storefront baseline files / 829 tests at 94.37% statements and 86.06%
  branches, plus 36 transactional files / 322 tests at 83.73% statements and
  76.50% branches;
- both production builds, including all 55 Storefront routes and the clean
  131-asset client-secret scan; and
- a clean second critical-browser run with all 21 Chromium, Firefox, and
  WebKit journeys passing.

The local disposable integration harness could start healthy PostgreSQL and
Redis containers through the system Docker daemon, but the host could not
reach either published port or bridge address. Medusa initialization therefore
ended in `ECONNRESET` before application assertions. The cleanly canceled
harness removed its containers and volumes. The exact GitHub Backend workflow
then ran the same disposable PostgreSQL/Redis integration successfully in
1 minute 11 seconds, providing fresh authoritative integration evidence rather
than treating the local host-network failure as a product result. No rendered
UI changed, so desktop screenshot validation does not apply.

Exact implementation SHA `6df5cbb2d0dcd111b87ed7cf0b2c03015f336e1a`
passed Root run `33748819712`, Backend run `33748819667`, Storefront run
`33748819653`, and Runtime Images run `33748819721`. Backend disposable
integration job `100628118781` passed. Runtime-image Backend job
`100627413136` and Storefront job `100627413005` passed; publication job
`100627414097` skipped on `staging`. Retained artifacts expire on 2026-10-03:

- Backend artifact `9890797507`, digest
  `sha256:c0a1dec223f397380827677836fe69438111bd06b1a6581d043e0f5cf58c6a78`,
  with 1,183 CycloneDX components; and
- Storefront artifact `9890764444`, digest
  `sha256:91ff507f4fe8b52fb4b00fea4898e3ba00293bf57ee4aff67a6d04228077027b`,
  with 122 CycloneDX components.

Storefront Lighthouse artifact `9891148715`, launch-acceptance artifact
`9891102795`, and coverage artifact `9890883027` expire on 2026-09-17.
Temporary downloaded runtime evidence is under
`/tmp/remorseless-redis-runtime-evidence.mCpEh3`, and smoke evidence is under
`/tmp/remorseless-redis-smoke.W1CPTJ`; neither path may be committed.

Railway Backend deployment `ca459698-3a86-42de-a255-d9b27b2e7d46` and
Storefront deployment `dacc90f7-ea9d-4088-93cc-17a72d638704` both reached
`SUCCESS` at the exact SHA, with source-image digests
`sha256:679b4fa5b3f99d22dae5b7b87130b139aa90344fa639f9a388d72be0cbc3e3bb`
and
`sha256:1d3a62eb6823fd715e2f2cfa5b5d6345d6c080969f5b63ec9c50470dec905f78`.
Both health/readiness pairs, Backend scheduler/operations, Storefront
root/catalog, security headers, and live AVIF optimization passed. Exact logs
contained zero HTTP 4xx/5xx records, application error events, Trusted Types
reports, `AppRender.fetch` diagnostics, standalone warnings, or forbidden
completion fields. Pre-readiness Backend Redis capture recorded seven startup
packet drops through 11:35:57Z; after readiness it recorded 334 Redis network
records, 710 packets, and 151,558 bytes with zero drop causes. Storefront
recorded 12 post-readiness Redis network records, 13 packets, and 1,139 bytes
with zero drop causes. No production state was changed.

## Upstream `qs` 6.16.0 acceptance (September 6)

Commit `58ed4431d044716c525128fcae7435517ba3a588` completed the cooled
upstream replacement and removal of the temporary patch/ignore/verifier
inventory. The Backend packager also normalizes pnpm's unset configuration
sentinels before enforcing its existing supply-chain policy.

Root run `34037759330`, Backend run `34037759320`, Storefront run
`34037759382`, and Runtime Images run `34037759290` passed at that SHA.
Runtime jobs `101498850210` and `101498850256` retained the following
digest-bound artifacts through October 6; publication skipped on staging:

- Backend artifact `9990762074`, 1,183 CycloneDX components, image digest
  `sha256:0b822be2b3159f2e17273a695d55732581237fb62ff334d6e81310214ee799b2`;
- Storefront artifact `9990745819`, 122 CycloneDX components, image digest
  `sha256:41b7238872bc8d36dd198047a14635c5c5593272d7de0ea243f0e781d87e7b20`.

Railway accepted Backend deployment `21bc65d7-1017-4f5c-8056-4bfa6163f2e1`
with source-image digest
`sha256:6954f99423a0fc009a4490446a29f8e5c3938fe46d2448b6c740f4147755e069`
and Storefront deployment `b582be69-3f3e-470f-99a7-3f98ce1b1e0a` with
digest `sha256:180538638412e5c2e51cb387d168a736696f449624e14aeb58c8efa2c2d7e4dc`.
Both health/readiness pairs, scheduler and operations health, root/catalog,
security headers, and AVIF passed. The initial operational observation had
no application errors, Trusted Types reports, or forbidden completion fields.
The later browser observation and its navigation-cancellation diagnostics are
recorded separately below.

## Trusted Types enforcement acceptance (September 6)

The reviewed report-only observation covered the accepted Redis Storefront
deployment `dacc90f7-ea9d-4088-93cc-17a72d638704` from
`2026-09-03T22:08:00Z` through the September 6 `qs` deployment, followed by
the `qs` deployment's browser observation. Neither deployment emitted a
Trusted Types report. The deployed responsive matrix passed 54 tests with two
intentional project exclusions before enforcement was enabled.

Non-development documents now enforce `require-trusted-types-for 'script'`
with only `nextjs`, `nextjs#bundler`, and `remorseless-stripe-js` permitted.
Development remains report-only. Reporting headers, the bounded collector,
nonce CSP, and exact Stripe script-URL policy remain present. The rollback
procedure is in `QA_RUNBOOK.md` section 1.10.

The deployed test mode requires an HTTPS `PLAYWRIGHT_BASE_URL`; omitting it
retains the local deterministic provider. Cookie-consent interaction waits
for document loading so it does not race hydration. Playwright is pinned to
1.62.0, and all local browser configurations start the installed Next CLI
directly. This prevents a package-runner launch from creating a second
dependency graph that isolated retry workers could import. The repository
fixture contract covers all four configurations.

Local acceptance passed the frozen install, complete 1,282-file repository
QA gate, 139 Storefront baseline files / 829 tests at
94.37/86.07/95.83/94.39 coverage, and 36 transactional files / 322 tests at
83.73/76.50/85.81/83.86. The production build generated all 55 routes and
verified 131 client assets. With enforcement active, responsive browser
coverage passed 54 tests with two expected skips, and critical Chromium,
Firefox, and WebKit coverage passed all 21 tests.

Final implementation SHA `5b6588fc9ae7f9ed8854f202dd129753f149a82a` passed
Root run `34040381745`, Backend run `34040381816`, Storefront run
`34040381772`, and Runtime Images run `34040381770`. Storefront CI included
responsive, launch, three-engine critical, pa11y, and six-route Lighthouse
acceptance. Runtime jobs `101505930367` and `101505930416` passed; publication
job `101505931082` skipped on staging. Retained image evidence:

- Backend artifact `9991527148`, expires `2026-10-06T14:52:55Z`, 1,183
  CycloneDX components, digest
  `sha256:29268b27194ae287fb49014233efb746dd02506455f9aee8d32b8836856cf14b`;
- Storefront artifact `9991513851`, expires `2026-10-06T14:52:01Z`, 122
  CycloneDX components, digest
  `sha256:97216f62efd290ed2a3dce4481ebd16fe2915aca931006dd424e68a5a15facb5`.

Both images passed runtime/health/identity contracts and the fixed
HIGH/CRITICAL scan. The private downloaded evidence is under
`/tmp/remorseless-tt-runtime-evidence.OZrFeu`; do not commit it.

Railway accepted both services at the implementation SHA:

- Backend deployment `4c546c93-6530-43bd-bf1e-a7d488ceb7e5`, source-image
  digest `sha256:f082ff7bb4936e1eced43bd6d6ec09a3d91bd2a20f2bb713bb7c3bf281bdaac7`;
- Storefront deployment `021c17af-b8a9-429c-b653-86f30a111971`, source-image
  digest `sha256:5b74d798a8630f57f2ad094c344e90aacfe472316350bd25ba66d4793b4b3946`.

Both services return the exact SHA from `/live` and `/ready`. Backend's
dependency/capability, scheduler, operations, retention, and incident checks
are healthy. The fresh scheduler heartbeat at `2026-09-06T15:10:00.076Z`
completed on the exact SHA with zero failures. The `15:10:13Z` operations
observation verified 461 products, one bounded handle, 442 discography
entries, and three shelves with 25 memberships. Backend's 345-record runtime
sweep contained 23 completion events and no failure events or forbidden
fields; the 34-request HTTP sweep was entirely 200. Its only error-level
entry was the release command echo. Storefront's Backend/Redis checks, root,
and catalog return 200.
HTML responses contain enforced Trusted Types plus report-only reporting,
nonce CSP, HSTS, MIME, frame, referrer, permissions, and correlation headers.
A live optimizer request returned HTTP 200 with a 7,837-byte `image/avif`
response under its sandboxed CSP.

The deployed enforced-policy matrix passed 54 tests with two expected skips
in 1.2 minutes. It exercises the deployed browser artifact while intercepting
selected catalog/cart/payment responses; it does not replace real Stripe,
tax, refund, or payment-provider acceptance. No Trusted Types report,
`AppRender.fetch` diagnostic, or standalone-output warning appeared. Reviewed
completion events contain only the allowed runtime/correlation fields.

The browser observation is not a zero-error-log claim: fixture product
prefetches generated four 404s, and browser navigation/teardown generated
Railway 499 client-disconnect records plus four Next stream-cancellation
events with digest `2234947129` ("The destination stream closed early.").
The same digest occurred 13 times during the prior report-only deployment's
browser runs, and Next's installed source identifies this as its stream
close/cancellation handler. There were no HTTP 5xx responses or new Trusted
Types sink reports. Keep these diagnostics visible; do not suppress them or
describe the complete browser window as error-free. Fully consumed root and
catalog requests after the matrix also passed.

No rendered UI changed in this implementation, so a new desktop layout
screenshot was not required. Existing `Default/` data remains untouched.
No production state changed.

## Active release batch and remaining work

On 2026-09-06 the user explicitly requested larger batches before pushing.
This supersedes the earlier one-family-per-push/deployment cadence below:
review compatible families independently, collect their focused regressions,
then run the full local gate and one exact-SHA CI/Railway acceptance pass for
the combined batch. Keep commits logical and preserve the cooling policy,
security/coverage thresholds, and production/cutover boundaries. Do not push
documentation-only checkpoints between dependency families.

The accepted combined batch contains Form 1.33.5 in both apps, Resend 6.25.0,
PostHog 5.51.4, Pacer 0.22.0, five Storefront Query 5.102.8 packages, Virtual
3.14.10, and Sonner 2.0.8. Frozen install, peers/security, lint/typecheck, both
coverage suites, and both builds pass. Final gates use pinned Node 26.5.0, not the
workstation login default. Backend passes 274 suites / 2,074 tests; the
compiled Admin matrix passes 12/12 with zero findings. New tests cover form
deletion/reset, Contact recovery, actual-SDK email transport/idempotency with
injected responses, debounce cancellation, notification delivery/cleanup, and
virtual-list resize/recovery.
The Admin mutation guard and installed-CLI build launcher were pushed as
separate logical commits together with the dependency batch. The latter
prevents the observed pnpm nested-workspace auto-install; no nested lock or
shadow dependency graph remains. Final pinned-runtime browsers pass 60
responsive (two expected skips), 14 launch, and 27 three-engine critical tests. Exact-SHA CI and staging
acceptance are complete at `912525b1248087a759e089e4917366e1b1e10eab`.
Details are in the combined-batch and Form sections of
`DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md` and
`PRODUCTION_HARDENING_PLAN.md`.

### Exact combined-batch acceptance

All four workflows passed: Root `34053342906`, Backend `34053342877`,
Storefront `34053342915`, and Runtime Images `34053342907`. Exact-revision
image subjects and retained SBOM artifacts are recorded in the dependency
audit; those GitHub validation images are distinct from Railway's source builds.

- Backend deployment `48ff91c0-6463-4500-b74a-f38ed077f5c9` reached `SUCCESS`
  with source-image digest
  `sha256:38ab66c11d5e51d9e865b58792a3b06a96cdb27945c7572c83b54821ab48ae2d`.
  At `2026-09-06T19:16:44Z`, `/live`, `/ready`, `/health/scheduler`, and
  `/health/operations` returned 200. Readiness dependencies and all seven
  capability checks were healthy. A repeat at `19:18:39Z` verified a completed
  scheduler heartbeat from `19:18:00.131Z` carrying the exact target SHA:
  62 scanned, zero attempted/failed, lock released, no cap or incident reasons.
  Operations remained healthy; retention snapshots came from earlier daily
  jobs, not newly executed jobs at this revision.
- Health probes intentionally do not emit runtime completion events. Their
  Railway HTTP IDs matched the exact deployment and running instance. A
  separate unauthenticated read-only catalog request returned the expected
  400 missing-publishable-key guard, not an invalid-query response. Its request
  `98f1b621-f300-4862-b4d6-30eec66f4e89` and trace
  `83ad2703c43417406b877324377d5776` matched the exact-SHA runtime completion.
  The bounded Backend observation contained 348 runtime rows, 28 completions
  with no forbidden keys, and no structured failure events. One error-level
  row was only the release command echo. The exact-deployment HTTP sample
  contained 33 successful responses and that deliberate 400, with no 429,
  503, or 5xx responses.
- Storefront deployment `c1663b0c-d9ac-4bb8-8113-2313c3204fce` reached
  `SUCCESS` with source-image digest
  `sha256:1fc6955638491c1a1802d9715e22029601f57fc94cd108543efd5e46a57dff1b`.
  At `19:14:45Z`, exact-SHA liveness/readiness, root/catalog HTML, security
  headers, enforced plus report-only Trusted Types, and a 7,837-byte AVIF
  optimizer response passed. Its deliberate invalid-query 400 correlated
  request `f62e5bec-7e44-4049-ac69-778a0a8c30f1` and trace
  `16aaef4b41aef983076de60d6f6cfc48` with the exact runtime revision. The
  deployed responsive matrix passed 60 tests with two expected skips.
  Provider requests remained intercepted; new local-only Stripe fixtures
  were excluded from this deployed run. The bounded 355-row runtime sample
  contained 325 completions, no Trusted Types reports, and two known stream
  cancellation events (`2234947129`). The 2,000-row HTTP sample contained
  1,980 × 200, two redirects, three fixture 404s, and 15 client-disconnect
  499s, with no 5xx responses.

These are bounded staging observations and fixture-based compatibility checks,
not real payment, email, analytics, or production-provider acceptance. No
provider writes, production changes, or image-source cutover were performed.

### Accepted storage, payment, and telemetry batch

The AWS/Smithy, Stripe server/browser, and OpenTelemetry cohort is accepted at
`c20efbebed1ef328388ced0f99edd8ac3dacc7ed`, containing implementation
`9cf9338` and its initial evidence. Exact targets, patch/override reviews,
injected-transport regressions, and provider-specific caveats are tracked in
the dependency audit.

The final local gates include 275 Backend suites / 2,090 tests, both production
builds and coverage suites, root lint/typecheck/security/peer checks, and
Storefront responsive 66 (two expected skips), launch 14, and critical 33
browser tests. Implementation and evidence were pushed together.

The rebuilt Admin passed the final 12-case matrix under Node 26.5.0 with
`ADMIN_ACCEPTANCE_BASE_URL` unset: zero axe violations/incomplete checks,
findings, review codes, or case errors. Screenshots are retained at
`/tmp/remorseless-storage-payment-telemetry-admin.zUO2kX`; inspected Product
validation (800 px), offerings (1,440 px), authoring (1,920 px), News and
Merchandising dialogs (760 px) show no visible layout regression. These are
rendered Chromium fixture screenshots, not desktop or live-provider evidence.

Exact-SHA remote acceptance on September 6 is complete:

- Root `34054918470`, Backend `34054918518`, Storefront `34054918476`, and
  Runtime Images `34054918453` passed. Both retained image records/SBOMs were
  downloaded and checked; Backend artifact `9995709792` contains 1,166
  components, Storefront artifact `9995691958` contains 122. HIGH/CRITICAL
  scans pass under the unchanged policy. These candidate images are separate
  from Railway's source-built images; full digest evidence is in the audit.
- Backend deployment `6de89656-1d77-4c0e-9e35-5ec12c0a53b4` reached
  `SUCCESS` at `19:45:55Z`, source-image digest
  `sha256:8f7e19c79171e2c22d2f205830e09edf59b257ca16738fcd697844fe53b929bf`.
  At `19:46:22Z`, `/live`, `/ready`, `/health/scheduler`, and
  `/health/operations` returned 200, with exact-SHA identity where exposed,
  all four dependencies and seven capability checks healthy. The fresh
  exact-SHA heartbeat at `19:46:06.108Z` completed: 62 scanned, zero attempted
  or failed, lock released, no cap, alert reason, or incident. The bounded
  authenticated operations monitor reported 461 products, 442 discography
  entries, one handle page, and three shelves / 25 memberships. Older daily
  retention snapshots remained healthy; those jobs were not rerun at this SHA.
  The deliberate missing-publishable-key 400 (not query validation) correlated
  request `090e434e-6550-4433-b361-f4769ce11aed` and trace
  `7f0fcd6d52159378375badb4bc230867` with the exact runtime revision.
  The final uncapped 325-row runtime sample through `19:47:25Z` contained five
  exact-SHA completions, no structured failures or secret-assignment signals,
  and only that deliberate warning. All nine HTTP probes matched instance
  `d85cd737-463c-4db4-b2b5-7c54218eec89`: eight 200s and the expected 400,
  without unexpected 429, 503, or 5xx responses.
- Storefront deployment `7dd9459c-4ea7-4ec5-ac03-8e403745e4d5` reached
  `SUCCESS`, source-image digest
  `sha256:9ac4b9eade6f57c1320f079c117101635fbea6313b458e62f7f13f8c3cea0eec`.
  Exact-SHA liveness/readiness passed, with Backend 43 ms and Redis 12 ms.
  Root and products/catalog HTML returned 200; security headers and enforced
  plus report-only Trusted Types retained the three exact policy names. The
  explicit AVIF optimizer check returned 200 / 7,837 bytes. The deliberate
  invalid-query 400 correlated request
  `6e884a1a-15ea-4d9f-b103-341c3c0c8c88` and trace
  `94ab5d9ced44b65b1451c37768943f7e` with the exact runtime revision.
  The deployed browser invocation passed 66 tests with two expected skips in
  1.1 minutes under Node 26.5.0. This comprises 60 deployed smoke passes and
  six fully intercepted local Stripe-loader fixture cases, not 66 deployed
  provider checks. Only the two existing baseline files ran; next-batch UI
  fixtures were excluded. Playwright 1.62.1 was installed for the next batch,
  with unchanged browser revisions. Three inspected catalog/discography
  screenshots show no visible layout regression; artifacts are retained at
  `/tmp/remorseless-c20efbe-deployed-browser.oLNaDM`.
  The bounded runtime sample contained three known stream-cancellation
  events (`2234947129`, `The destination stream closed early.`), no
  additional errors, and no Trusted Types reports. The 2,000-row HTTP
  sample contained 1,990 × 200, two redirects, five 404s, and three client
  disconnects (499). A separate final error-filtered sample contained the
  deliberate 400 and 13 fixture 404s; neither HTTP sample contained 5xx.

These are bounded staging observations and injected/intercepted compatibility
checks, not real storage writes, payments, tax/refunds, webhook delivery, or
telemetry-export acceptance. No production or image-source cutover occurred.

### Accepted UI, parser, image, and tooling batch

The shared frozen graph groups 15 reviewed direct upgrades: Lucide,
Motion/Framer Motion, Zustand/Immer, the owned CSV parser, Sharp, PostCSS,
esbuild, Biome, Vitest/coverage, Testing Library, and Playwright. The dependency
audit records exact versions, official publication/cooling evidence, preserved
patches and framework-owned holds. The UI corrections are committed at
`ec66bb99618a170be8dd4e0a3f5e8f10833827db`; both logical commits were pushed
together and deployed at `497a52a8c2aced3ba62e1e08e4c733bbe78b23fe`.

The actual CSV-parser/import checks pass 28/28 on 7.0.2; four of those checks
failed on 7.0.1. Hostile headers become own data properties without prototype
mutation. Grouped columns are not enabled by the application, and this does
not establish an application exploit or end-to-end preservation of unknown
headers. The separate Medusa 5.6.0 parser remains unchanged.

The UI regressions cover controlled Drawer opener/focus restoration and a
gallery Previous action after the final image fails. Focus restoration avoids
removed, disabled, hidden, or unrelated targets and superseded close events;
tests include StrictMode, rapid reopen, full unmount, and nested drawers.
The focused UI suite passes 24/24 with 100% lines and 91.30% branches. The 15
new Chromium/Firefox/WebKit fixture cases pass. Full responsive, launch, and
critical matrices pass 81 (two expected skips), 14, and 48 tests respectively,
all without retries. Headed Chromium keyboard flows and real desktop
Flameshot screenshots of cart, calendar, and gallery were inspected and pass.
Full desktop captures include unrelated windows and remain private/local;
do not upload or commit them. App-only headed 1,920 × 1,080 captures are at
`/tmp/remorseless-ui-cart-headed-20260906.png`,
`/tmp/remorseless-ui-calendar-headed-20260906.png`, and
`/tmp/remorseless-ui-gallery-headed-20260906.png`.

Full local coverage passes Backend 275 suites / 2,099 tests, Storefront 142
files / 857 tests, and the unchanged transactional subset 36 files / 322
tests. Backend/Admin builds complete in 6.20/15.95 seconds with 1,072 frozen
runtime dependencies. The final Storefront build compiles in 4.8 seconds
(cached), with 55 routes and 131 verified client assets. Root
lint/typecheck/security, strict frozen installation, and peer checks pass.
Standalone pa11y fails before navigation because this workstation cannot
launch the installed Chromium sandbox under its AppArmor/user-namespace
policy. Separate mobile/Lighthouse runs are not claimed as local passes;
no sandbox bypass or host change was used. Exact-SHA sandboxed GitHub pa11y
subsequently passed all four pages with zero issues/review findings, and
Lighthouse passed all unchanged assertions across 18 reports. Performance
medians were 0.87–0.88 and accessibility/best practices were 1.00; SEO was
1.00 except Privacy 0.92 and intentionally noindex Checkout 0.61. Worst median
LCP was 4,107 ms, TBT 103 ms, and CLS 0.000282 with the existing runner
calibration. There were no runtime errors; the expected cart redirect remains.

The final rebuilt Admin passes 12/12 under Node 26.5.0 with
`ADMIN_ACCEPTANCE_BASE_URL` unset, zero axe violations/incomplete checks,
findings, review codes, or case errors. Five inspected Product, News, and
Merchandising Chromium screenshots at 760–1,920 px show no visible regression;
artifacts are at `/tmp/remorseless-tooling-admin-node265.SYThuV`. These remain
deterministic local fixtures, not live Admin or provider acceptance.

Root `34056277576`, Backend `34056277609`, Storefront `34056277617`, and
Runtime Images `34056277606` passed on the exact revision. The unchanged
high/critical image-scan gates passed, publication skipped, and both image
records independently match their CycloneDX SBOM and source SHA:

- Backend artifact `9996103442`, 1,166 components:
  `sha256:9e992201a0e5048ce38427e94799dfcf4f217b640001b84eb9c66ac38a76ad65`;
- Storefront artifact `9996080119`, 122 components:
  `sha256:9050d076e15d15b93a391b0ae0133ed01c0453657d3ce70b78d7ab3e7760dfe0`.

These are validation images, not Railway source images. Railway Backend
deployment `8a8eca56-5cce-41c8-a0a7-e8e7f422dd87` succeeded with source digest
`sha256:1f179f8fcdeabe262e0cc1caac18ca2fd2f0289f35b71d0e9e24ff637434aed4`;
Storefront deployment `2f6f68b5-5538-44e2-a6d3-120fd79dd406` succeeded with
`sha256:6d0a389052a5f570ec9c32213af3b10b295841da7a28d7711607342c3fd6c235`.
Both services expose the exact accepted SHA. Backend's four health routes,
four dependencies, seven capabilities, and operations projections passed;
its fresh completed heartbeat at `2026-09-06T20:14:00.126Z` scanned 62,
attempted/failed zero, released its lock, and had no incident or cap. The
bounded uncapped HTTP sample contained 73 successful 200s plus the deliberate
guard 400. Its exact request/trace/runtime/HTTP correlation passed. Retention
snapshots remained healthy but were not newly run.

Storefront `/live`, `/ready`, complete Home/Catalog HTML, security headers and
the three exact Trusted Types policies passed. The actual optimizer returned
a 7,027-byte AVIF. A deliberate `invalid_query` 400 with request
`ff2942d6-fb74-4bd5-9c34-9cca6471364d` and trace
`7451b44f34ad4a0d9c1c7e7ac34295fa` matched no-store headers, body correlation,
and its exact-SHA runtime event.

The first deployed browser run produced 72 passes, eight expected skips, and
three failures in the new cart/calendar test, including configured retries.
Retained traces show Enter dispatched about 206 ms before the cart provider's
mount-time GET: the test interacted before hydration. A test-only correction
waits for that existing intercepted GET and document load, and retries the
SVG-presence assertion without weakening behavior checks. Against unchanged
deployed `497a52a`, the corrected local harness passed 75 cases with eight
expected skips and zero retries in 1.8 minutes. A further five repetitions on
each of the three Chromium device projects passed all 15 cases without retry.
The full result remains at `/tmp/remorseless-497a52-deployed-corrected.cEJvAz`,
the repetitions at `/tmp/remorseless-497a52-cart-repeat.epGZ9p`, and original
failures at `/tmp/remorseless-497a52-deployed-browser.egTm85`. The correction
ships with the recovery batch, not as a standalone checkpoint push. Six skips
are local-gallery-only cases and two are pre-existing desktop-header skips;
the six Stripe cases intercept a local provider fixture. These are not live
payment tests or three different browser engines.

The post-matrix bounded runtime sample contained 886 uncapped rows: 45 known
destination-stream cancellations, each matching digest `2025024551`, 24
fixture product-not-found events, and two deliberate invalid-query 400s.
Two startup Next.js unexpected-root-span diagnostics and a command banner
were also logged at error level; they are retained rather than suppressed.
The preceding `c20efbe` deployment also retained that root-span diagnostic.
The separate uncapped HTTP-error sample contained 116 client cancellations
(499), 24 fixture 404s, and those two 400s; no HTTP 5xx was observed. This is
not a zero-error-log claim; cancellation noise remains visible.

### Accepted recovery-preparation batch

The combined batch changes recovery tooling only, without dependency
updates, provider grants, role cutovers, or live backup/restore drills. It also
contains the bounded deployed-browser hydration synchronization correction.
Commits `f82c489`, `29174bc`, `08ba93a`, and `2354e75` were pushed together:
19 files, 2,030 insertions and 151 deletions, without an intermediate push.
Root QA passes across 1,299 files; Backend coverage passes 277 suites / 2,146
tests at 91.83% statements/lines, 85.72% branches, and 95.80% functions.
Backend/Admin builds complete in 6.59/16.17 seconds. Corrected deployed-browser
validation passes as recorded above; the combined recovery batch also passed
its own exact-SHA remote acceptance below. Frozen installation and peers pass;
the only audit findings are the existing three behaviorally patched moderate
ignores, without new exceptions.

Media verification now compares streamed SHA-256 content from both source and
target, with an explicit planned-content budget (twice source bytes, excluding
the mirror and metadata/retry/read-ahead overhead), object cap, deadline, and
cancellation that kills and reaps active readers. The private version-2 manifest records
content-verification evidence; version 1 only proved inventory parity.
The helper rejects corruption/truncation and unsuccessful readers, retains no
object bytes, and exposes operator guidance through `--help`. It is not an
atomic snapshot, version-history backup, or rollback after a partial mirror.
The 29 media tests pass; helper coverage is 97.60% lines, 92.56% branches, and
100% functions. These are synthetic-stream/disposable-client checks, not an
off-site drill or evidence of available credentials and budget.

Database-role auditing now considers session/current identities, inherited
privileges, and reachable `SET ROLE` capabilities, including membership
administration and backup write restrictions. The focused suite passes 56
tests at 100% coverage, and 27 tests pass on disposable PostgreSQL 18.6.
Seven old unit failures and an old SQL false acceptance were reproduced.
Small-fixture `EXPLAIN` measured 1.805 ms planning / 1.237 ms execution; this
is not a production benchmark. These bounded checks do not certify all
`SECURITY DEFINER` functions, extensions, future/default grants, or application
authorization. Scope and rollout prerequisites remain in
`INFRASTRUCTURE_RECOVERY.md`; no live role change has been performed.

Exact-SHA Root `34058004773`, Backend `34058004830`, Storefront `34058004778`,
and Runtime Images `34058004813` all passed for
`2354e7544c77c0c23f1486b9e3ef43e0740d51a9`. CI Backend coverage retained
277 suites / 2,146 tests at 91.83% statements/lines, 85.76% branches and 95.80%
functions; integrations passed 31 tests in two suites plus 41 in five suites.
Storefront passed 142 files / 857 baseline tests and 36 files / 322
transactional tests. CI responsive, launch and three-engine critical matrices
passed 81 (two existing skips), 14 and 48 cases without retries. Sandbox-enabled
pa11y and all Lighthouse assertions passed. The 18 independently inspected
Lighthouse reports have no runtime errors, performance medians 0.87–0.88 and
accessibility/best practices 1.00; worst median LCP is 4,077 ms, TBT 80 ms and
CLS 0.000282 under unchanged calibration/budgets. Existing Checkout/Privacy
SEO exceptions remain unchanged.

Both private image records/SBOMs independently verify the exact revision;
the unchanged high/critical scan gates passed and publication skipped:

- Backend artifact `9996617539`, 1,166 components, digest
  `sha256:16b3dc85f0889667bb62f2e2d199b09c5313a47af14cb11c659e77a62d492f25`;
- Storefront artifact `9996597794`, 122 components, digest
  `sha256:4f701a3b8bc4832491d0d922d94a4bf6834c911d6a0bc103dbfe24231add8fb0`.

Evidence is retained at `/tmp/remorseless-runtime-2354e75.b0y1Tw`, including
Lighthouse artifact `9996761382`. These validation images are not the Railway
source images. Railway Backend `f0a7645b-cf89-4eff-906e-cdf150472b12` and
Storefront `bf2f9773-1784-4f93-adba-c2791079bfc8` both reached `SUCCESS` on
the exact SHA, with respective source digests
`sha256:2b00a1a66fe92288334663ce31e9faa68fee8bb57c23ce758db9f5bf8736a2de`
and `sha256:730c49feb16ef0b7fa9c25839ccecf788e2e3c3da75d83dfaf4b9caca7c232c5`.

At `2026-09-06T20:46:36Z`, Backend liveness/readiness, scheduler and operations
were healthy, with all four dependencies/seven capabilities OK. Its completed
exact-SHA heartbeat was fresh at `20:46:00.088Z`, with no incident or alert
reason. Catalog counts remained 461 products, 442 discography entries, one
returned handle, and three shelves with 25 memberships. Retention snapshots
remain healthy but were not newly run. The guarded GET returned Medusa's
native `not_allowed` 400 envelope with matching request/trace headers:
`aa71315f-a1aa-4030-a17f-deb000e84bf4` /
`9d55b428cd41cff4b17bdff8e7ae6a08`. The exact-SHA runtime completion and
Railway HTTP request `9nRxEtP6TyqmqvQGHn5Ytg` independently match the Backend
deployment; the guarded request completed in 2.405 ms.

Storefront exact-SHA liveness/readiness, complete Home/Catalog HTML, security
and Trusted Types headers, and the actual 7,027-byte AVIF optimizer passed.
Its guarded `invalid_query` 400 matched body/headers and the exact-SHA runtime
event: request `182f89e3-52f9-417f-990d-6af7751d43f4`, trace
`9bbeb812b6385b0a1f8baeb1bcd2ecf3`. Railway HTTP request
`1QfgiEf8REmiRU0TU79b0g` independently matches the Storefront deployment.
The deployed matrix passed 75 with eight
expected skips and zero retries in 1.8 minutes; artifacts are at
`/tmp/remorseless-2354e75-deployed-browser.mnN3RX`. The same local-gallery,
desktop-header and intercepted-Stripe boundaries described above apply.

Final uncapped log samples retain 398 Backend runtime rows with 77 successful
request completions and two deliberately induced guard 400s; its HTTP-error
filter contains only those two 400s. Storefront retained 306 runtime rows,
eight known stream cancellations, 12 fixture product-not-found events and one
deliberate 400. Its HTTP-error filter contains 100 client 499s, 12 fixture 404s
and that 400, without HTTP 5xx. Neither runtime sample showed Trusted Types
errors or credential-assignment signals. This remains bounded evidence, not
a zero-error-log assertion or real provider/backup/role-cutover acceptance.

### Accepted PostgreSQL recovery execution batch

The grouped change completes the PostgreSQL backup/restore execution
boundary without dependencies, application features, database grants, or
provider changes. Both CLIs now have credential-free help, strict argument and
libpq option validation, a cancellable overall deadline, bounded child output,
sanitized phase/duration failures, and child reaping before private cleanup.
Restore verifies and reads a private archive snapshot, enforces a local-copy
byte budget, lists the custom archive before connecting, and checks a broader
privilege-independent catalog inventory. Existing transactional apply and
confirmation boundaries remain in place.

The expanded database-release gate passes 75 tests, including 40 PostgreSQL
unit/CLI cases. Focused helper coverage passes at 95.50% lines, 95.20% branches, and 95.65%
functions. Seventeen real PostgreSQL 18.6 integration cases pass, including
reproductions of table-only false acceptance for routines/sequences and
inaccessible tables, read-only transaction enforcement, and schema-shadowing
prevention. These fixtures are wired into the existing disposable
Backend CI job. A separate local synthetic end-to-end drill created a
2,663-byte custom archive in 231 ms, completed preflight in 80 ms and restore
in 262 ms, verified one table/three inventoried objects plus the exact row and
routine result, and rejected a repeated apply to the populated target.
Temporary snapshots and owned databases were cleaned. These are small local
fixtures, not production recovery-time measurements or live restore evidence.

`INFRASTRUCTURE_RECOVERY.md` documents the 30-minute default/four-hour maximum,
10 GiB default/1 TiB maximum snapshot budget, supported connection options,
archive trust, endpoint-alias limitations, concurrent-writer exclusion, and
the possibility of a committed restore after a timeout/lost response.
Full root QA passes across 1,305 files with both strict typechecks. Frozen
installation and peers pass; the audit retains only the existing three
behaviorally patched moderate ignores, without new exceptions.

One commit and one push delivered 15 files, 1,668 insertions and 261 deletions
at `94d914a12bfc2f25952517ada9167c4d393e20f1`. Root `34060201112`, Backend
`34060201115`, Storefront `34060201117`, and Runtime Images `34060201130`
all passed on that exact SHA. Backend retained 277 suites / 2,146 unit tests
at 91.83% statements/lines, 85.76% branches and 95.80% functions; disposable
integration passed 31 + 41 + 17 cases, with three additional API-contract
tests. Backend/Admin builds completed in 13.82/32.18 seconds. Storefront
passed 142 files / 857 baseline tests and its 36-file / 322-test transactional
subset. CI responsive, launch and three-engine critical browser matrices
passed 81 (two existing skips), 14 and 48 cases. Sandbox-enabled pa11y and all
Lighthouse assertions passed without changing policy or budgets. The 18
independently inspected reports have no runtime errors, performance medians
0.86–0.88, accessibility/best practices 1.00, and worst median LCP 4,221 ms,
TBT 87 ms and CLS 0.000282. Existing Checkout/Privacy SEO exceptions remain.
Route grouping uses requested URLs because `/cart` intentionally redirects
to `/?cart=1`.

Both private runtime-image records/SBOMs independently verify the exact SHA;
high/critical scan gates passed and publication skipped:

- Backend artifact `9997265591`, 1,166 components, digest
  `sha256:762e5a4ecf2afcb1dc9272a98a0782d3adbfcfa15834572c59fa476d84b9439b`;
- Storefront artifact `9997248903`, 122 components, digest
  `sha256:e4c9fc5a32bd212a451d955fbeaa1e7a67472c2f8eb769f670fc083e11ad3704`.

Evidence is at `/tmp/remorseless-runtime-94d914a.pU1vaf`, including Lighthouse
artifact `9997417155`. These validation images are not Railway source images.
Railway Backend `f3a2ce11-24c5-4874-8814-a46275905c7a` and Storefront
`8d08d7c0-8c5f-4a8a-8f89-7b17f206d612` both reached `SUCCESS` on the exact
SHA, with respective source digests
`sha256:3fc5a5118c4a7b6bd61cb47651126f7774c770a196c2053153ec81f65889bba0`
and `sha256:3dd80b72dc93bd0d5baaf6af04b03f4ce608d48bfee7feb5db07716f136a8449`.

At `2026-09-06T21:30:14Z`, Backend liveness/readiness, scheduler and operations
were healthy with all four dependencies/seven capabilities OK. The completed
exact-SHA heartbeat was fresh at `21:30:00.221Z`, with no incident or alert
reason. Catalog counts remained 461 products, 442 discography entries, one
returned handle and three shelves with 25 memberships. Retention snapshots
remain healthy but were not newly run. The native `not_allowed` guard 400
matched response request/trace headers and exact-SHA runtime completion:
request `45a9d2cc-b74a-4e8b-b4fd-a24ee3f10852`, trace
`08f077eb592627cbc2ccebb0dc7fbee7`, duration 2.823 ms. Railway HTTP request
`su73gbk_SxaJGn-JyCLmYg` independently matches that Backend deployment.

Storefront exact-SHA liveness/readiness, complete Home/Catalog HTML, security
and Trusted Types headers, and the actual 7,027-byte AVIF optimizer passed.
Its `invalid_query` guard 400 matched body/headers and exact-SHA runtime logs:
request `2999f987-d657-478e-914f-39021a50a674`, trace
`301f4d5403ae29883b9504eb98720bf6`. Railway HTTP request
`r2L_RIQlRmSKHo2UO8poTA` independently matches the Storefront deployment.
Deployed browser acceptance passed 75 cases with eight expected skips, zero
retries and a 1.9-minute runtime across three Chromium device projects.
Artifacts are at `/tmp/remorseless-94d914a-deployed-browser.opvPOF`; the
existing local-gallery, desktop-header and intercepted-Stripe boundaries
remain unchanged.

The uncapped acceptance log samples retain 332 Backend runtime rows and only
the deliberately triggered 400 in its HTTP-error filter. Storefront retained
324 runtime rows, 11 known stream cancellations, three existing Next root-span
diagnostics, 13 fixture product-not-found events and the deliberate guard 400.
Its 108 HTTP-error rows contain 94 client 499s, 13 fixture 404s and that 400,
with no HTTP 5xx. All 404 paths match the browser's synthetic pagination or
Pathologist handles during deployed browser validation (these requests span
`21:26:48Z`–`21:28:05Z`); filter fixtures intercept search but leave
intent-driven product-detail prefetches
unmocked. Neither runtime sample showed Trusted Types errors or
credential-assignment signals. This is bounded evidence, not a zero-error-log
assertion or real payment-provider, backup/PITR or role-cutover acceptance.
Final acceptance notes remain local until the next substantive batch.

### Redis capacity and persistence observation batch

The next grouped batch adds a read-only Redis capacity/persistence CLI, strict
credential-free evidence parsing, socket-level cancellation, and fixture
coverage without dependency or live configuration changes. Explicit service
memory input replaces any inference from host RAM. The audit checks the
documented 70% ceiling, standalone writer/noeviction policy, AOF/RDB settings
and status, current counted memory/RSS, and historical eviction/rejection
counters. It never reads application keys, widens ACLs, or applies settings.
The runbook distinguishes bounded policy evidence from volume/recovery/SLO
acceptance and documents the accepted-response rather than wire-buffer cap.

Local validation passes 67 focused cases at 100% helper lines/functions and
98.92% branches (80% enforced), plus eight read-only tests against the real
pinned Redis 8.10.1 fixture. Real RESP2 tests prove the exact command allowlist,
one connection, denied-command/error redaction, and signal/deadline cleanup.
Review reproduced a pending TLS handshake surviving ordinary client destroy;
an underlying socket AbortSignal fixes it, with real peer-closure regressions
for both timeout and external abort. DNS TLS endpoints also receive SNI while
certificate verification remains mandatory.

The first implementation push `8f93c71` was followed by a package-entrypoint
correction before release acceptance: pnpm forwards `--`, while the strict
Redis and PostgreSQL parsers initially rejected the documented invocation.
All three commands now normalize exactly one leading separator, retaining
strict rejection of duplicate/interior separators and all confirmation gates.
Tests execute actual pnpm help invocations with and without the separator;
the PostgreSQL CLI suite now passes 30 cases, including backup and restore
dry-run/apply separator regressions. The combined database-release gate
contains 84 existing/recovery cases plus the 67 Redis/shared-argument cases.

A separate synthetic local drill used one owned 256 MiB container with 8 MiB
maxmemory, noeviction, AOF everysec and a `60 1` RDB schedule. Five 1 MiB fill
keys fit; further fill and a 16 MiB write failed OOM without evicting the marker
(evictions 0 to 0). Only the five owned fill keys were deleted. Same-connection
`WAITAOF 1 0 5000` returned `[1,0]` in 995 ms. The marker survived SIGKILL and
restart; it was recovered in 505 ms and a healthy CLI audit completed in
637 ms from the start of the kill call. These are small-fixture measurements
of an acknowledged write, not general RPO/RTO or crash-window-loss guarantees.
The owned container/anonymous volume were removed and its port released.

Frozen installation, the unchanged dependency policy, full root QA over 1,314
files, both strict typechecks and application builds pass. Backend/Admin
builds took 6.56/15.91 seconds; Storefront compiled in 5.7 seconds and its
131-asset secret/Trusted Types bundle scan passed. The initial Storefront
build correctly rejected an inadequate local secret; the successful rerun
used the existing CI-only secret/provider fixtures, without modifying `.env`
or live credentials. Existing fixture search/category fallbacks remain
visible and are not claimed as live provider evidence.

The combined 17-file batch (2,639 insertions, 32 deletions) passed exact-SHA
acceptance at `1f7558817584e174f3aaed51e26a6a3de9294bbf`, including the
entrypoint correction after the initial implementation push. Root CI
`34062668270`, Backend `34062668250`, Storefront `34062668244` and Runtime
Images `34062668269` all passed. Backend passed 277 suites/2,146 tests with
91.83% lines, 85.76% branches and 95.80% functions; its service/recovery gate
passed 31 + 41 + 17 PostgreSQL + eight Redis tests, plus three API contracts.
Backend/Admin CI builds took 14.98/35.02 seconds. The 84 + 67 root unit/CLI
cases above were local/pre-push evidence at this SHA, not Root CI evidence;
that discovered gap is addressed by the follow-up below.

Storefront CI passed 142 baseline files/857 tests (94.28% lines, 86.20%
branches), 36 transactional files/322 tests (83.75% lines, 76.35% branches),
81 responsive cases/two skips, 14 launch cases, 48 three-engine cases, pa11y
and all Lighthouse assertions. Private artifact `9998145724` is at
`/tmp/remorseless-lighthouse-1f75588.4F4MmD`. All 18 reports were independently
verified as six requested-URL groups of three, with no runtime/console-error
reports and 100% accessibility/best-practices scores. Median performance/LCP
milliseconds/TBT milliseconds/CLS were Home 87/4094.27/13/0, Cart
87/3996.99/10/0, Catalog 89/3711.65/48.5/0.000282, Checkout
88/3945.05/33/0, Product 89/3703.08/9.16/0 and Privacy 86/4186.64/20/0.
Cart's redirect remained a distinct requested-URL group; no budget changed.

Both runtime image/SBOM pairs and exact OCI revision labels passed independent
verification. Backend artifact `9998008051` has 1,166 components and digest
`sha256:877b1c13312c1b5116e5b3dab83be713e2fe60ae7efe925833c45ca0db5836d5`;
Storefront artifact `9997995444` has 122 components and digest
`sha256:318a8584d2ab25862d9a335964ca7b178b6e8f3f66800ad75dd39615464fb653`.
Evidence is private at `/tmp/remorseless-runtime-1f75588.SrbyjZ`. Publication
skipped; these are CI candidate digests, not Railway's source-build images.

Railway Backend `92f4638d-fc09-4dc6-87b7-15e6d57b3f12` and Storefront
`5eb55dc0-6a1d-47fb-bbb8-ccbb9f52a1dd` reached `SUCCESS` at the corrected
SHA, with source-image digests respectively
`sha256:4f63fece404ff0787118a589a83d660006675fb8e02e7faa5ade289b9a95dd26`
and `sha256:1323c341a45182dbc1373ac34630d9642d40205b4ea08b8ed3bfe77e8c84620b`.
Health/readiness, all dependencies/capabilities, scheduler and operations were
healthy; the fresh exact-SHA heartbeat completed at `22:20:00.136Z` on
September 6. Catalog counts remained 461 products, 442 discography entries,
one handle probe, three shelves and 25 shelf memberships. Complete Home and
Catalog HTML, enforced security headers and the 7,027-byte AVIF check passed.
Deployed browser acceptance passed 75 cases/eight expected skips with zero
retries in 2.0 minutes across three Chromium device projects. Private output:
`/tmp/remorseless-1f75588-deployed-browser.Ul4Sts`.

Exact Backend request `38f01547-9e23-4c7b-a6ac-53092165dbd6` / trace
`c7ed91d2d67cf8274e306e7f92789890` and Storefront request
`6ca57020-a4f7-4ee7-9673-2d7c299ca67d` / trace
`62dd1297e38a27c34607feb740b305bb` matched the corrected SHA and native
`not_allowed`/`invalid_query` guard events. Railway HTTP IDs
`XsZPE5fJQ86ZUDnfH4GxDA` and `b9Qb9qe3TQKMWbINozsQ6Q` matched their exact
deployments. Backend's event appeared on a later bounded log read; the same
strict assertion then passed unchanged. Its 342 runtime rows had only the
deliberate guard warning; the HTTP error sample contained that one 400.
Storefront's 342 runtime rows retained nine known stream cancellations, while
110 HTTP-error rows contained one guard 400, 16 synthetic browser-fixture
404s and 93 client 499s, with no HTTP 5xx. Neither bounded sample showed
Trusted Types errors or credential-assignment signals. No live Redis settings,
keys, ACLs, persistence volumes or recovery policy were changed or certified.

### Shared local/CI contract parity batch

Release review found ten root QA contracts were enforced by local hooks but
absent from workflow execution. The follow-up groups them into
`qa:ci-shared-contracts`, invoked once by local `qa:lint` and once after frozen
installation in Root CI's existing hardened job. An independent
`qa:ci-shared-contracts-boundary` runs first in both paths. Existing explicit
security checks, both local application typechecks, action identities,
permissions, egress endpoints, dependencies and the lockfile are unchanged.
Real disposable service integration stays in Backend CI.

The aggregate covers recovery/media and Redis unit/CLI tests, service-container
resolution, response/browser boundaries, provider fixtures, Dashboard creation,
scheduler timestamps, integration wiring, operations observations and telemetry
bootstrap. It passed in 18.05 seconds against an under-60-second local target:
84 recovery/media, 67 Redis/shared-argument, five provider-fixture, six
operations and 16 observability tests, plus static boundaries. This is not
live Redis, recovery or provider acceptance.

The 71 parity regressions reject omitted/duplicated/bypassed commands, future
unmapped local gates, conditional/skipped jobs, error suppression, inherited
shells, path-filtered triggers, YAML shadowing and lowered coverage. Independent
review reproduced and closed the original bypasses. The strict validator
accepts the repository's reviewed YAML shape, not arbitrary YAML. Coverage is
96.95% lines, 95.56% branches and 94.44% functions, with 80% floors now enforced
in its package command. Redis helper coverage floors remain unchanged.

Combined root QA passed over 1,316 files with both strict typechecks. Fresh
Backend/Admin builds passed in 6.82/17.52 seconds; the Storefront compiled in
10.0 seconds, generated 55 static pages and passed the 131-asset secret/Trusted
Types scan using the existing CI-only provider/secret fixtures. Expected local
search/category fallback warnings remain visible. The owned in-process fixture
closed after the build; no live environment file changed.

The eight-file follow-up (867 insertions, 21 deletions) is pushed at
`6f61520fbd3677b15aeecb1052a86b8dffff0e9d`. Pre-commit QA passed in 45.73
seconds; pinned-toolchain pre-push QA/Storefront coverage passed in
48.99/15.87 seconds. Root CI `34063920612` passed: its new parity step ran all
71 cases at the same 96.95/95.56/94.44% coverage, and the shared step ran all
178 cases with Redis helper coverage 100% lines/functions and 98.92% branches.
Their log spans were about 0.67 and 17.99 seconds under unchanged blocked
egress. This closes the earlier local-only evidence gap prospectively; it does
not reclassify earlier releases.

Runtime Images `34063920608` passed both exact-image validations, vulnerability
gates, CycloneDX generation and independent record/OCI-revision checks at the
same SHA. Backend artifact `9998387400` has 1,166 components and digest
`sha256:39288a9cb361deb45733760c241ccd542fed522d4b677a31d5949a01649f94ca`;
Storefront artifact `9998368543` has 122 components and digest
`sha256:97d4c2bc6414d9283f39eecb679705ca0bb93071cb645d02c9d06889217f2e1b`.
Private evidence is at `/tmp/remorseless-runtime-6f61520.ef4ygq`. Publication
skipped; these CI images do not identify Railway's source-build images.

Backend CI `34063920627` passed 277 suites/2,146 tests in 182.133 seconds at
91.83% lines/statements, 85.76% branches and 95.80% functions. Disposable
integration/recovery passed 31 + 41 + 17 PostgreSQL + eight Redis cases and
three API contracts. Backend/Admin builds took 14.52/33.67 seconds, and the
Admin bundle budget passed. Storefront CI `34063920599` passed 142 baseline
files/857 tests (94.28% lines, 86.20% branches), 36 transactional files/322
tests (83.75% lines, 76.35% branches), 81 responsive/two skipped, 14 launch
and 48 three-engine cases, pa11y and Lighthouse. All four final-SHA workflows
are green without reruns or altered budgets.

Lighthouse artifact `9998519182` is private at
`/tmp/remorseless-lighthouse-6f61520.RtD2Il`. Independent verification found
18 reports across six requested URLs with three runs each, no runtime/console
errors and 100% accessibility/best-practices scores. Median
performance/LCP milliseconds/TBT milliseconds/CLS were Home
87/4073.52/30.5/0, Cart 87/4037.31/53/0, Catalog
88/3847.48/83.5/0.000282, Checkout 88/3758.71/68/0, Product
88/3902.64/33.89/0 and Privacy 86/4102.17/81.5/0. Existing Checkout/Privacy
SEO scores were 61/92.

Final staging acceptance passed at `6f61520fbd3677b15aeecb1052a86b8dffff0e9d`.
Railway Backend `c732b2a8-5dd1-4d75-8531-452cc794be8a` and Storefront
`edbdef4d-832c-472b-9a82-b71d9b82e4ed` reached `SUCCESS`, with source-image
digests respectively
`sha256:0fd6777434856a0a632ec130ec3dcc5725025df9b125b43e0c3a8189b46a37b9`
and `sha256:9ef991ca4f036bc781575023440a509522f9171ed0f7825a901199e4315905fb`.
Both health/readiness pairs, all Backend dependencies/capabilities, scheduler,
operations and unchanged catalog counts passed. The fresh exact-SHA scheduler
heartbeat completed at `22:44:00.062Z` on September 6. Storefront complete
HTML/security-header checks and the 7,027-byte AVIF check passed. Deployed
browser acceptance passed 75 cases/eight expected skips, zero retries, in
1.9 minutes across three Chromium device projects. Private evidence:
`/tmp/remorseless-6f61520-deployed-browser.IfibS9/results`.

Backend request `91d19dd2-50e6-4e62-aee8-0fe9e7282df6` / trace
`48bf0f1148adaac53f571bd7cc7642b8` and Storefront request
`9e9569dd-ae56-424f-9587-db86e84984c7` / trace
`27fda0ab45aa83ba8b735f064fc11419` passed strict exact-SHA runtime
correlation. Railway HTTP requests `nKl3s8m-RFWOLG4bO8poTA` and
`tPMVzwDCRDqpaxAJAax-fw` matched their respective deployments and deliberate
400 guards. Backend's bounded sample had 372 runtime rows, the one deliberate
application warning, and one HTTP-error row (the guard). Storefront's 307
runtime rows retained nine known stream cancellations; its 109 HTTP-error
rows contained the guard 400, 12 synthetic fixture 404s and 96 client 499s,
with no HTTP 5xx. Neither bounded sample showed Trusted Types errors or
credential-assignment signals. These are bounded observations, not a claim
of zero error logs or production readiness.

Together, the Redis and shared-CI batches changed 21 tracked files across
three implementation commits, including the Redis entrypoint correction.
No live Redis policy, credential, data, service source, registry visibility,
domain or production setting changed. Final acceptance notes remain local for
the next substantive batch; no documentation-only checkpoint push was made.

### Grouped checkout, request identity and webhook correctness follow-up

Three reproduced application defects were grouped in one staging push at
`3f9c533fbea23fee6b300287f0e1ed3bc8cb7bd9` (20 files, three logical commits).
The accepted head stayed at `6f61520` after that candidate's live tracing
check failed. The corrective `4ba7996` release subsequently passed complete
exact-SHA acceptance below; local verification alone did not advance it.

Checkout reads now accept TanStack cancellation while retaining their existing
12-second deadline. Writes cancel prior reads and reads started during the
write before publishing authoritative success/problem projections; mutation
serialization and single-attempt behavior remain intact. Prepared payment
secrets are preserved from the current cache only for matching revision/provider/
status. Shipping options are revision-scoped, and empty-cart callers await the
authoritative clear. Mounted-hook regressions exercise late success/error/null
responses, unmount cancellation, shipping races and serialized mutations.
The existing transactional coverage configuration now includes checkout hooks;
no coverage floor is reduced.

Actual Next 16.3.3 reproduction showed two overlapping requests sharing a trace
producing one completion labeled with the other request's ID. The registry now
keys by trace plus the proxy-generated outgoing parent. The first route root
claims ownership, preventing a replayed parent from stealing its completion;
weak child-span associations preserve error identity. TTL/cardinality and fixed
redacted event fields remain unchanged. `next.route` is not a request identity
and may be absent. The existing parent-based sampling policy is unchanged, so
unsampled incoming traces still omit processor-derived observations.

The built-runtime regression starts only owned loopback processes and holds
four requests with the same trace and incoming parent until all provider
responses are still open and no request has completed. All four must then
produce unique, correct completions, followed by a request without an incoming
trace. This runs in the existing Storefront Browser Smoke job after its build.
Real-SDK tests separately reject overlapping parent replay, duplicate ends and
invalid contexts. No framework cancellation/root-span warning is suppressed.

Medusa's official payment webhook previously reflected an enqueue exception's
message directly in a public 400 response. The existing 2.18 patch now returns
fixed text for that catch, including non-Error throws, without changing success,
payload/raw-body forwarding, retries, delay or asynchronous signature checking.
Installed-route tests preserve the exact queue boundary. The rotation runbook
now distinguishes successful enqueueing from downstream signature acceptance
and JWT invalidation from cookie-session invalidation; live drills remain open.
The root lock changes only five occurrences of the Medusa patch hash, with
all versions, integrities and other bytes unchanged. Generated Backend patch,
lock and installed route were independently verified after rebuilding.

The live Redis observation also completed safely from the accepted Storefront
instance. It found unbounded maxmemory and disabled RDB scheduling; AOF/everysec
was enabled. `INFRASTRUCTURE_RECOVERY.md` records exact provenance, independently
verified service ceiling and sanitized counters. Nothing was changed in Redis,
and a rejected query-bearing Backend URL was not weakened or stripped.

Local verification: Root QA passed across 1,319 formatted source/config files
and both strict typechecks. Backend passed 278 suites/2,162 tests in 118.649
seconds (91.83% lines/statements, 85.76% branches, 95.80% functions).
Backend/Admin builds took 16.29/27.50 seconds and the Admin bundle budget
passed. Storefront passed 143 baseline files/881 tests (94.93% lines,
87.59% branches, 96.70% functions), plus 38 transactional files/344 tests
(84.21% lines, 76.59% branches, 86.26% functions). The newly measured checkout
hook has 97.72% lines, 76% branches and 94.11% functions. Targeted tests
measured the completion processor at 95.45% lines, 93.23% branches and 100%
functions. All thresholds are unchanged.

The final Storefront production build compiled in 5.1 seconds, generated 55
static pages and passed the 131-asset client secret/Trusted Types scan. The
built-runtime correlation gate passed in 625 ms. The dependency audit retained
only the three existing reviewed moderate ignores; no new exception or
dependency version was introduced. All 48 critical browser cases passed in
1.3 minutes across Chromium, Firefox and WebKit after the final shipping-refetch
correction. Evidence uses
private `/tmp/remorseless-correctness-browser.nHqQgY/results`; the temporary
configuration changes only the occupied local server port/output location and
sets zero retries, keeping all 48 three-engine cases intact.

Redis recovery inspection additionally found no recorded backups/schedules
and source/runtime image drift (`railwayapp/redis` versus the running
`bitnami/redis`, Redis 8.0.3). The current volume is mounted at `/bitnami`;
exact volume/deployment metadata is in `INFRASTRUCTURE_RECOVERY.md`. Do not
restart/redeploy it without a verified backup and reviewed image/rollback
path. A focused manual-backup approval request is separate from this code
batch; no backup or live change is implied by these observations.

### Staging discovery: premature sibling-span completion

All four `3f9c533` workflows passed without reruns: Root `34066074212`,
Backend `34066074181`, Storefront `34066074230` and Runtime Images
`34066074226`. Root ran 71 parity plus 178 shared tests. Backend ran 278
suites/2,162 tests, 97 service/recovery cases and three API contracts.
Storefront ran 143 files/881 baseline tests (94.82% lines, 87.39% branches),
38 files/344 transactional tests (84.10% lines, 76.45% branches), the original
runtime regression, 81 responsive/two skipped, 14 launch and 48 cross-engine
cases. Pa11y and all 18 Lighthouse samples passed unchanged budgets; retained
artifact `9999162860` is private at
`/tmp/remorseless-lighthouse-3f9c533.62BSJs`. Six requested URLs each have
three reports, zero runtime/console errors and perfect accessibility and
best-practices scores. Runtime artifacts `9999030852` (Backend, 1,166
components) and `9999001774` (Storefront, 122 components) passed exact
OCI/source/digest verification under `/tmp/remorseless-runtime-3f9c533.NEtpNq`;
publication skipped.

Railway Backend `ad2684ce-ccf2-49da-8212-60b54539984c` and Storefront
`59787227-5630-4842-8a09-c51c80dbce04` both reached `SUCCESS` at that SHA.
Backend dependencies, operations/catalog and the ordinary exact-SHA heartbeat
at `23:28:03.455Z` passed. Storefront HTML/security/AVIF checks and 75 deployed
browser cases/eight expected skips passed with zero retries in 1.8 minutes;
private evidence is `/tmp/remorseless-3f9c533-deployed-browser.fdIPik/results`.
This candidate was not accepted: live trace
`1800d92f7ae008251b959b7160d5c064` returned four HTTP 200 responses with correct
request IDs, but three completion logs recorded status zero.

The installed `@vercel/otel` composite processor tracks open spans by trace
and forcibly ends them when its first root ends. This closes sibling HTTP
requests before Next attaches status. Direct installed-provider reproduction
matched the live three-zero/one-200 pattern. The original runtime fixture
released requests in reverse order, finishing the first root last and hiding
the wrapper defect. The strengthened fixture checks both completion orders,
holding siblings open and requiring exactly one completion after each release;
the old build fails `4 !== 1` with the first-root-first order.

The correction replaces the serverless wrapper with the standard Node provider
and actual-provider lifecycle tests. Sampling, fixed completion fields and
W3C propagation remain; no exporter, metric reader or broad instrumentation is
added. The three direct OpenTelemetry 2.10.0 dependencies already exist in the
frozen graph. Only the Vercel package/snapshot is removed; retained versions,
integrities, other importers and patch metadata are unchanged. The new provider
uses standard `OTEL_SDK_DISABLED` booleans (`false` does not disable it).
Review also preserved the `OTEL_PROPAGATORS` privacy boundary: `none`,
`tracecontext`, `baggage`, and `auto` retain their bounded behavior; unsupported
values fail before registration without reflecting the input.
Corrective local acceptance passed Root QA across 1,319 files and both strict
typechecks. Backend passed 278 suites/2,162 tests at 91.83% lines and 85.72%
branches; Backend/Admin builds and generated lock/patch verification passed.
Storefront passed 143 files/908 baseline tests (94.96% lines, 87.75% branches)
and 38 files/344 transactional tests (84.21% lines, 76.59% branches). The
production build compiled in 13 seconds and passed the 131-asset secret/Trusted
Types scan. Both actual-runtime completion orders passed in 613/595 ms. All
48 three-engine browser cases passed with zero retries in 1.3 minutes under
`/tmp/remorseless-tracing-final-browser.VPqVuV/results`.
The preceding local browser invocation used the wrong working directory and
failed six gallery fixture-file reads. Invoking Playwright from Storefront
resolved those harness failures without changing gallery code, assertions or
retry policy. Audit retains only the
three existing moderate ignores. Final root lock SHA-256 is
`a1f529fde28d2d0ac7042ca3677b14483cbb05dd865af0fc0885fa000e78eb95`.
Exact-SHA CI and staging acceptance subsequently completed as recorded below.
During that code-release acceptance, no live Redis backup, configuration,
credentials or production settings changed.

### Corrective exact-SHA acceptance — September 6, 2026

Commit `4ba7996f934754a1aeb8d0d970a35f33341a0ce3` is accepted. Its mandatory
pre-commit and pre-push hooks passed without bypasses; the push completed with
the unchanged root lock hash above. No workflow rerun, assertion relaxation,
sampling change or new audit exception was required.

All four exact-SHA workflows passed:

- Root `34067639362`: 71 parity plus 178 shared tests. Parity coverage is
  96.95% lines, 95.56% branches and 94.44% functions.
- Backend `34067639391`: 278 suites/2,162 tests in 192.538 seconds;
  coverage is 91.83% statements/lines, 85.76% branches and 95.80% functions.
  All 97 integration/recovery cases and three API contracts passed.
  Backend/Admin builds took 14.34/33.75 seconds; bundle budgets passed.
- Storefront `34067639402`: 143 files/908 baseline tests at 94.86% lines
  and 87.55% branches; 38 files/344 transactional tests at 84.10% lines and
  76.45% branches. The actual provider bootstrap has 100% coverage in all
  dimensions. Both built-runtime completion orders passed in 1,535.03 ms
  total. Responsive tests passed 81 cases/two expected skips, launch passed
  14, and Chromium/Firefox/WebKit critical flows passed 48. Pa11y passed.
- Runtime Images `34067639367`: both validation jobs passed; publication
  skipped. Candidate artifacts are private under
  `/tmp/remorseless-runtime-4ba7996.VxdmS2` (0700). Backend artifact
  `9999498246` contains 1,166 components and digest
  `sha256:2e7a783a3f81baa0ab90672a1c21116a3465db3ce2a17d9e279c69a3eb0e5f3e`.
  Storefront artifact `9999479696` contains 122 components and digest
  `sha256:abbe09b1b280a5876243d72d7c1860756eea416a5b4e89e5e7d9f13b6f1f8317`.
  Repository and independent verification checked unique OCI revision/source
  labels and exact Trivy ImageID equality, not just digest substrings.

Lighthouse artifact `9999631208` is retained privately at
`/tmp/remorseless-lighthouse-4ba7996.dp3np0/artifacts/lighthouse`. Independent
review found 18 reports grouped by six exact requested URLs, three per group,
zero runtime/console errors, and accessibility/best-practices scores of 1.0
throughout. All 71 configured median budgets passed with the existing CPU
slowdown of 2. Cart remains its own requested-URL group despite redirecting
to `/?cart=1`.

| Requested route | Median performance | LCP ms | TBT ms | CLS |
| --- | ---: | ---: | ---: | ---: |
| Home | 0.87 | 4076.651 | 30.000 | 0 |
| Cart | 0.87 | 4041.753 | 52.500 | 0 |
| Catalog | 0.88 | 3890.890 | 85.000 | 0.000282 |
| Checkout | 0.88 | 3757.692 | 93.000 | 0 |
| Product | 0.88 | 3877.621 | 29.481 | 0 |
| Privacy | 0.89 | 3746.699 | 71.000 | 0 |

Both Railway source deployments reached `SUCCESS` at that exact SHA:

- Backend `4806b717-c262-49c0-a115-1ee89607ea21`, digest
  `sha256:69f2ebb3e5b2c3f3c98464b7f7bdb3040a029d4d7e77098f3ab01086634b6dc8`.
- Storefront `e9581a94-a6b9-4ebd-a4e5-fa1c62a4c1c4`, digest
  `sha256:4d8430efabd8dad68686a1c4c193f8b455f79238d578d9d98b4e37ceecd68e4d`.

These Railpack-built images are distinct from the CI candidates above. No
GHCR publication, source cutover or production action occurred. Backend
identity/readiness, scheduler, operations and all catalog reads passed. The
ordinary scheduler heartbeat completed at `2026-09-07T00:02:03.342Z` on the
exact SHA without a manual trigger. Storefront complete HTML, security and
Trusted Types headers, readiness and the 7,027-byte AVIF response passed.
Deployed browser acceptance passed 75 cases/eight expected skips with zero
retries in 1.9 minutes; evidence is private at
`/tmp/remorseless-4ba7996-deployed-browser.CKMwiT/results`. No new rendered
UI changes or graphical-desktop screenshot acceptance are claimed.

The decisive live probe at `2026-09-07T00:02:25.782Z` used shared trace
`2e93b381b3172602d59bd2c1b765591d` and four concurrent health requests.
All four returned HTTP 200 and each produced exactly one distinct request/span
completion with status 200, level `info`, correct SHA/environment/service,
finite duration and no forbidden request fields. Durations were
47.434/34.185/33.204/32.804 ms. The previous three-zero/one-200 result is fixed
without replacing unknown status values or weakening the assertion.

Exact guard response/runtime/HTTP log correlations passed for Backend request
`41d0d267-9ef1-4200-8c2e-5a5e76f435ea`, trace
`8b6a4fcea3da8c0cc495f143bc480b2e`, Railway request
`Ea__i5kvRtazyPmDGbGh5g`, and Storefront request
`1e01cf7c-9362-47cd-8fbd-20fe4480d99b`, trace
`53365be7e774ceeaf8b9e720c506dab6`, Railway request
`5Yj8O1ZDTxu_VcuxwoOzXw`.
Uncapped bounded samples contained 359 Backend runtime rows and 330 Storefront
runtime rows, with no unclassified warnings/errors, credential-assignment
signals or Trusted Types failures. Storefront still recorded 11 known Next
stream-cancellation errors and one existing root-span diagnostic; these were
not suppressed. Its 125 HTTP-error rows contained 111 client disconnects
(499), 13 synthetic fixture 404s and the deliberate guard 400; no 5xx was
observed. Backend's HTTP-error sample contained only its deliberate guard 400.

The subsequent one-time Redis recovery checkpoint is recorded in
`INFRASTRUCTURE_RECOVERY.md`. After the user instructed the agent to continue
following the specific backup/cost question, exactly one
`pre-hardening-20260906` backup was created on the verified staging volume:
`129379c6-8a3c-42bf-9695-5e0ef5840e3d`, created
`2026-09-07T00:37:22.198Z`. Fresh listing confirms the backup, 1,072 MB
referenced size, no reported expiry, no schedule and an empty
`environmentPendingWork` result. Redis's deployment and configuration were
not changed; both apps remained ready and the ordinary `00:38:00.082Z`
heartbeat completed normally.
No workflow-status response or successful restore is claimed; the recovery
runbook records the evidence limitation and retention/cost cautions.
Read-only follow-up found reported Redis 8.0.3 predates the upstream fix for
critical CVE-2025-49844 and initially confirmed an active public TCP proxy.
No vendor-backport or exploit evidence is claimed. Do not disable Lua as a
quick workaround: rate limits, cart idempotency, Medusa locking and BullMQ
depend on it, while readiness checks only `PING`. The recovery runbook records
an immutable historical Bitnami Legacy candidate for isolated compatibility
testing; that unsupported image is neither proven to match the running
artifact nor approved as a secure replacement.
The newer Redis 8.10.1 Alpine fixture is not staging-approved either: a local
exact-digest scan found eight fixed HIGH OS-package findings, documented in
the recovery runbook. Existing Medusa integration success is functional
evidence, not security acceptance; the compiled server/modules were outside
this OS-package scan's detected coverage.
The same-version Trixie alternative also failed (three CRITICAL/52 HIGH),
and the existing PostgreSQL integration fixture has one CRITICAL/30 HIGH;
these do not describe the separately accepted application runtime images.
An isolated synthetic Redis persistence test passed 8.0.3 to 8.10.1 with
11 keys, three exact expirations, durable post-rewrite AOF replay and an
untouched source-baseline reopen. All owned test resources were cleaned.
The recovery runbook records 9.44-second fixture evidence and limitations:
direct server binaries, synthetic AOF+RDB, no real backup or queue replay.
Further local work produced a minimal OS-package-patched Redis candidate,
Docker image ID `sha256:7451f4003e18e5d5146e99e06b14a8520cc7bfb8d213078b6547b7e98c907288`.
Only three exact Alpine package versions changed; Redis, entrypoint, modules
and runtime configuration were preserved. The same cached-DB scan now has zero
findings across 22 OS packages; its 23-component SBOM does not cover compiled
Redis/module dependencies. Repeated synthetic persistence/rollback acceptance
passed on that exact ID in 9.61 seconds with no test resources left behind.
The recipe, scan and proof locations are in the recovery runbook. This local
image is not a published artifact or an accepted staging replacement.
Fresh selected-endpoint metadata confirmed both `4ba7996` apps use private
Redis networking, and final readiness remained healthy. The separately approved
exact proxy deletion ran once at `2026-09-07T01:23:41Z`, exited zero, and a
fresh listing confirmed zero Redis TCP proxies. Both apps remained ready on
`4ba7996`; the ordinary `01:24:00.054Z` scheduler heartbeat and subsequent
operations/catalog/Storefront/security-header/AVIF probes passed. External
clients lose the removed public endpoint; Redis storage, configuration and
source were unchanged. The real-backup restore route, image publication and
live upgrade have not been authorized or performed.
Live Redis configuration, restore, image/source and additional cost decisions
remain separate from the single backup. Preserve the local legal runbook
correction and final acceptance/recovery notes for the next substantive batch
rather than pushing a documentation-only checkpoint.

### Grouped fixture-security and session-rotation follow-up

The next substantive batch replaces both unpatched disposable service images
with `docker/integration` recipes, preserving the database binaries and
official privilege-dropping entrypoints. Redis receives three exact signed
Alpine package fixes; PostgreSQL receives four and a source/checksum-pinned
`gosu` rebuild with Go 1.27.1 and fixed `x/sys` 0.44.0. The root pnpm lock
remains unchanged. The recovery runbook records full provenance, startup,
shutdown and package-coverage limitations.

Backend CI now builds the same recipes as local Compose, scans their exact
local IDs, binds JSON/CycloneDX evidence and runs with `--no-build`. No registry
publication is added. Missing reports, high/critical/unknown findings, stale online
database evidence, suppressed findings, image substitutions, incorrect
published ports and unsafe output paths fail closed. Both image IDs export
only after both complete scans pass. The runner rejects pre-existing project
resources, isolates known provider/telemetry configuration from `.env`, bounds
child processes/output, and cleans up after startup/test failures or signals.

Independent fresh-DB scans passed both exact Compose IDs with zero findings
at every severity under local Trivy 0.74.0 and the existing CI-pinned 0.70.0.
PostgreSQL inventory is 53 OS/four Go packages with 59 CycloneDX components;
Redis is 22 OS packages/23 components. The unversioned rebuilt `gosu` main
module and unestablished compiled-server coverage are recorded, not hidden.
Evidence: `/tmp/remorseless-fixture-security-20260907.qHIXmc/evidence` and
`/tmp/remorseless-trivy070-compat.jquIIW/evidence`.

The 99-test runner/scanner/wiring boundary passes with 98.77% lines,
96.81% branches and 100% functions, enforcing an 80% floor. Shared-contract
parity still passes all 71 cases. Full exact-image integration passed all
106 cases without skips: 31 Medusa, 41 payment-lifecycle, 17 PostgreSQL
recovery, eight Redis audit, three API-contract and six session-rotation
tests, in 21.82 seconds. The rotation matrix uses installed Medusa 2.18
middleware/session handler and real disposable Redis, not a password/OAuth
provider or live account. It proves JWT-only rotation preserves sessions,
both-secret rotation rejects old credentials without deleting stored state,
new credentials establish sessions, and old-key instances reject them.

The first fullstack run exposed a new optional internal-network setting that
discarded host port bindings on Docker Desktop 29.7.2. An isolated comparison
proved this, and the corrected ordinary bridge retains loopback-only ports
plus a new runtime binding check. The failed 24.26-second run is retained at
`/tmp/remorseless-hardened-integration-20260907.ztd5PF`; comparison evidence is
`/tmp/remorseless-compose-network-proof-20260907.NUPV9Q`. Successful evidence
is `/tmp/remorseless-hardened-integration-20260907.RBQeVt`. Both runs cleaned
their owned containers/networks; final project inventory has zero containers,
networks or volumes. No staging support image or credential changed.

Local production builds also pass with synthetic configuration: Storefront
standalone completed in 21.045 seconds, generated 55 pages, and verified 131
static assets for server-secret/public-Meilisearch/Stripe Trusted Types safety.
Its owned loopback Medusa fixture was closed afterward. Backend build completed
in 22.715 seconds and passed the Admin bundle budget. The first Storefront
attempt correctly rejected an explicitly empty optional previous secret; a
distinct synthetic previous key fixed the harness, without changing app code.
Private build evidence is `/tmp/remorseless-app-build-proof.Aor1MF`.
Full Backend unit coverage also passed all 278 suites / 2,162 tests in
86.216 seconds, with 91.83% lines, 85.76% branches and 95.80% functions.
The first unit invocation inherited the already-cleaned disposable Redis
endpoint; explicitly disabling Redis restored the CI unit-test environment.
Both run results are retained with the build evidence; no application source
or assertion was changed to resolve that harness mismatch.
The complete grouped batch shipped as `36c9c1003e0206c1afcedcadb18d3acd87796159`.
Both commit/push QA hooks passed; the push also passed 908 baseline and 344
transactional Storefront tests. The root lockfile stayed unchanged.

### Fixture-security batch exact-SHA acceptance (September 8)

All four workflows passed without a rerun: Root `34209351767`, Backend
`34209351720`, Storefront `34209351716`, and Runtime Images `34209351777`.
Backend passed 278 suites / 2,162 tests and all 106 disposable integration
cases, without skips. Storefront passed 908 baseline / 344 transactional tests,
both built-runtime completion-order tests, 81 responsive cases (two intentional
desktop-only skips), 14 launch scenarios and 48 three-engine critical flows.
Pa11y passed. Lighthouse artifact `10049627914` contains 18 reports, six
requested URLs times three runs; all 71 unchanged median budgets passed.
Private Lighthouse evidence is `/tmp/remorseless-lighthouse-36c9c100.0TTSmy`.

Disposable artifact `10049265544` independently matches its archive checksum
and all four report byte counts/hashes. CI tested PostgreSQL image
`sha256:1db7552da44e7cc20222996cbb07c83f87fcf0c115eafdd31d3ee29c7d7e749a`
and Redis image
`sha256:94d1bf4287f882f70ad77c3fafab4ce20887be8d89ada4c0e2d667c5e375d017`
without rebuilding after scanning. Both have zero findings at all severities
under Trivy 0.70.0 and the September 8 07:08 UTC database. PostgreSQL retains
53 OS / four Go packages and 59 SBOM components; Redis 22 / 23. The exact
container and network removal records passed. Full verified provenance is
`/tmp/remorseless-backend-ci-36c9c1.bckh6O/verified-summary.json`. A separate
fresh local scan also passed at
`/tmp/remorseless-fixture-security-20260908.adGchB/evidence`.

App runtime-image artifacts `10049255319` (Backend) and `10049207932`
(Storefront) bind their exact SHA and SBOMs to images
`sha256:252d9362c10f9d3dfe8ca1cdb953f9ea58673bd86c964b1dcca82cb94b804890`
and `sha256:80087c71e206303abb238efe21ce26ff814c860ea9c56a6a6809cd6898e48234`.
Their 1,166 / 122 component inventories and 104 / 101 unfiltered finding IDs
are unchanged from `4ba7996`; one existing Perl advisory gained a medium
rating. The existing fixed-HIGH/CRITICAL gates pass; this is not a zero-finding
claim for app images. The Backend-only three React Router findings remain
the documented source-backport exceptions. Publication stayed skipped.

Both Railway source deployments reached SUCCESS on the exact SHA:

- Backend `4d79532d-42ad-4075-b7ba-e057398c23c4`, image
  `sha256:7773bdfcc41563097127687842a1de4032ed81c0745196ed7d8d4953e78f1807`.
- Storefront `316a7ad7-0fc3-4045-9575-e85708b81c8e`, image
  `sha256:1ba4142b9fcd4b5ab5ea081c93b0dad64c2736474662a1f0aff6248e7cab087c`.

Exact readiness, catalog/operations, headers, complete HTML and AVIF output
passed. The ordinary Backend heartbeat completed on the new SHA at
`2026-09-08T09:40:00.091Z`, without a manual trigger. Deployed browser checks
passed 75 cases / eight expected local-gallery or desktop-only skips, zero
retries, in 109.57 seconds. All four shared-trace requests have one distinct
valid route-root completion with status 200 and exact request/trace/SHA fields.
The response traceparent intentionally identifies its outgoing parent, not
that child route-root span; an initial temporary verification assumption was
corrected against the existing source contract, without an application change.
Both deliberate 400 guards match their exact runtime and Railway HTTP events.

Private live evidence is `/tmp/remorseless-release-36c9c10.5WYkpT`. Uncapped
runtime samples contain 376 Backend and 340 Storefront records, with no
unclassified warnings/errors, credential-assignment signals or Trusted Types
failures. Storefront retains 11 known stream cancellations and one existing
Next root-span diagnostic. The general Storefront HTTP sample reached 2,000
rows, so independent uncapped 5xx and exact-request queries were used;
they found zero 5xx and both expected guard records. A CLI query combining
typed filtering/end time was rejected; documented raw-filter queries succeeded.
No live support-service image, credential, database role, production setting
or package publication changed. These final acceptance notes are carried with
the substantive Next.js follow-up rather than a documentation-only push.

### Cooled Next.js 16.3.4 follow-up (September 8, accepted)

The Next-only dependency cohort has passed its seven-day cooling window.
Only Next, `@next/env` and eight matching SWC packages changed, alongside the
Storefront importer and three matching package-extension selectors. The new
root lock SHA-256 is
`2a224db892eec78cbfc0cd59c50c01db4add84a523dc0b0ffc30d0ca095cac70`.
Frozen install, peer resolution and the dependency audit pass; Sharp 0.35.4,
libheif 1.23.2, libvips 8.18.6, PostCSS 8.5.26, React 19.2.8 and all existing
patches/holds remain unchanged. Audit retains the same three moderate
source-backport exceptions and no HIGH/CRITICAL findings.

The five-case isolated optimizer test was first demonstrated red on 16.3.3
(three passes, two AVIF-related failures), then green on 16.3.4. It proves
actual 64×48 AVIF input decoding and resizing to 32×24 WebP, not unchanged
upstream bytes or a silent fallback. It also decodes resized PNG-to-AVIF output
after Next initializes native loader permissions, and retains non-image/SVG
rejection plus explicit truncated-PNG fallback classification. The previous
release could encode valid AVIF output; its loader restriction explains that
second red assertion. Single-run test timings are not performance benchmarks.

Local Storefront standalone and default builds passed in 34.596 and 16.462
seconds, respectively, each retaining 55 routes and 131 secret-scanned static
assets. Both built-runtime concurrent completion-order tests passed afterward.
Build evidence is `/tmp/remorseless-next1634-proof.Q4PTsR`; the owned loopback
fixture was closed, and user port 3000 was never touched. Full root QA passed,
including strict application typechecks. Storefront coverage passed all 908
baseline and 344 transactional tests: baseline 94.96% lines / 87.75% branches /
96.72% functions; transactional 84.21% / 76.59% / 86.26%.

Backend build passed in 28.743 seconds, Admin assets stayed within their
unchanged budgets, and full coverage passed 278 suites / 2,162 tests with
91.83% lines, 85.76% branches and 95.80% functions. Generated manifest, lock
projection, all 16 patches and tracing bootstrap match sources. Evidence is
`/tmp/remorseless-backend-next1634.CLTMMX/backend-summary.json`; the provider
fixture explicitly disables Redis and never reaches a live service.

Launch runtime capture and consent checks now derive the application origin
from the configured Playwright `baseURL`, rather than hardcoding port 3000.
All existing assertions remain intact and missing configuration fails clearly.
This lets the unchanged browser matrix run on an owned alternate port without
weakening same-origin error detection or touching an existing user server.
Local browser acceptance passed 81 responsive cases (two expected desktop-only
skips), 48 critical three-engine cases and all 14 launch/accessibility cases,
without retries. Evidence and screenshots are retained under
`/tmp/remorseless-next1634-browsers.WDnZGd/browsers`. All owned processes were
closed and ports 4300/4010 verified free; the default build and lock stayed
unchanged throughout that run.

Local Pa11y could not launch Chromium's sandbox on this host, before any page
audit. No sandbox-capable installed system Chrome was available; no browser
bypass, download, OS setting or accessibility assertion was changed. Lighthouse
was not attempted against that unsupported local browser setup. Pa11y and all
three-run Lighthouse budgets therefore require exact-SHA CI evidence from the
supported hosted runner.

Both canonical runtime-image decoder steps also passed locally against the
same packaged candidate image
`sha256:609d940cddaf745e9c4abb7e0076dc243290e72924c8f8bc20fac4db5974895d`:
five tests each, zero failures/skips, with no network, read-only filesystem and
test mount, dropped capabilities and 256-MiB / one-CPU / 64-PID limits.
Both exact owned containers were removed. The test is not included in the
image, and no registry publication occurred. This is an explicitly dirty local
candidate, not an exact committed release artifact. Full proof is
`/tmp/remorseless-storefront-decoder-image.cU8tJM/proof.json`; the root lock
remained unchanged. All 71 runtime-image policy tests and four CI security
tests passed. The complete release shipped as
`80a83ced17a2b5cc937aff1edfff0d9cfbbd49d7`; final acceptance follows.

### Next.js follow-up exact-SHA acceptance (September 8)

All four required workflows passed for `80a83ced`: Root `34213580388`,
Backend `34213580334`, Storefront `34213580217`, and Runtime Images
`34213580277`. Publication correctly skipped on staging. Storefront CI passed
five decoder cases, 908 baseline and 344 transactional cases, two built-runtime
completion-order cases, 81 responsive cases plus two expected skips, all 14
launch cases, and 48 critical three-engine cases without retries. Supported
runner Pa11y passed all four paths without errors or review warnings; this
does not turn the local sandbox limitation into a local pass.

Lighthouse retained 18 reports, six requested URLs times three, with all 71
unchanged budgets passing at the documented CI CPU calibration of two.
Every report scored 1.0 for accessibility and best practices with no runtime,
audit, or console errors. Median performance ranged from 0.86 to 0.88.
Artifact `10051315575` was independently checksummed:
`ac3dcf4b2799deaa27b213b4a777c17c1cfd7a17c74834a24538781835fb36b7`.
Root supply-chain artifact `10050883149` retained 1,311 SBOM components and
1,006 production license entries, including only the five previously documented
Medusa metadata exceptions. Private Root/Storefront evidence is
`/tmp/remorseless-ci-80a83ced.UhI1XL`.

Backend CI passed 278 suites / 2,162 unit cases and all 106 disposable
integration cases, with the unchanged Admin asset budgets. The exact local
PostgreSQL and Redis fixture images were scanned against the fresh September 8
Trivy database with zero findings at every severity, then started by the same
image IDs without rebuilding. Both owned containers and their network were
removed afterward. Fixture artifact `10050965368` has archive SHA-256
`fc72bbec2292c3b88b9e7e9af5d12b6e268cb42d01156a17b7af60fd1edaa2f5`.
Full evidence is `/tmp/remorseless-ci-80a83ce.YG20d1`.

Validated CI candidate images were Backend
`sha256:5235f0ab5b400269e924adb098817d23de237d06daa84174179ac56f14d77c99`
and Storefront
`sha256:018a732847974ba7c99de4953e1aba83d8516fc2bd467ee300b775bfa05f5e88`.
The packaged Storefront decoder gate passed all five tests against that exact
image. SBOM inventories remained 1,166 / 122 components: Backend was unchanged;
Storefront changed only Next and `@next/env` from 16.3.3 to 16.3.4. Existing
fixed-HIGH/CRITICAL gates passed. Unfiltered runtime findings remained 104 / 101
with unchanged IDs and affected-package mappings; this is not a claim of zero
findings at all severities. The three Backend Router moderate backport
exceptions remain explicitly scoped.

Railway separately accepted Backend deployment
`11a4c2ea-a1ce-4e21-8ba6-29244c3404fb`, image
`sha256:72d0f665c30414404c3b920f7e831de66e9feb823893ba41fbfd3e532c0ae6fb`,
and Storefront deployment `fd5a2449-b87b-4d36-ae17-0967fcf380b7`, image
`sha256:8a548535704b29703fb347a51585e88f3d2af9ec7c93f0e8a4d6dd47057bc9f3`.
Both source builds report the exact commit and healthy readiness dependencies.
The ordinary scheduler heartbeat at `2026-09-08T10:26:00.072Z` reports the new
SHA; scheduler, operations, retention, incident and bounded catalog checks are
healthy. HTML/security/Trusted Types headers and 7,027-byte AVIF output passed.
That live image response is output smoke evidence; the isolated and packaged
decoder tests supply the stronger AVIF-input proof.

The deployed browser matrix passed 75 cases and eight expected skips, with no
failures, flaky cases or retries, from `10:27:03.160Z` to `10:30:02.704Z`.
The six local-only image-gallery cases and two mobile-inapplicable desktop
header checks explain all skips. Direct installed Playwright execution avoided
package-manager installation and the subsequently identified vulnerable
Lefthook binaries. No local app server or user port 3000 was touched.

Private live evidence is `/tmp/remorseless-release-80a83ce.3hE59b`. Uncapped
runtime captures retained 496 Backend and 377 Storefront rows. Both deliberate
400 responses match exact request/trace/SHA identities in application and
Railway HTTP logs. Four concurrent requests sharing a trace produced exactly
four distinct route-root completion spans, with no cross-request completion.
Response parent spans are distinct but are not equated to their child spans.
Independent post-browser 5xx queries returned zero for both deployments.
The general Storefront HTTP capture reached its 2,000-row cap, so it is not
complete-window evidence; targeted guard and 5xx queries remained uncapped.
Nine existing stream-cancellation diagnostics remain visible under the new
Next digest `1105982228`, with nine corresponding render-error records and no
unclassified warnings/errors after review. No credential-assignment or Trusted
Types error signals were observed. This is not a zero application-error claim.

These final notes remain local for the substantive maintenance follow-up;
no documentation-only deployment was triggered.

### Compatible maintenance and Git-hook remediation (September 8, local gates passed)

The next substantive batch exact-pins Backend SWC 1.15.47, both Node declaration
consumers at 26.1.2, Storefront React/React DOM declarations at 19.2.18/19.2.5,
browser data at 2.11.20 and tsx at 4.23.13. Existing framework/runtime/provider
versions, sixteen patches, security policy and Medusa licensing holds are
unchanged. The lock has eighteen precisely reviewed new package records and
thirty removals; independent structural review proves no unrelated edge or
policy drift. Its SHA-256 is
`5b08b5484fbd21150b1d6d4628d838fc42fc5d673258e90d2af77bbb383b4308`.
An initial caret-based lock-only draft selected unreviewed minor lines and was
rejected before installation; only the exact reviewed graph was installed.

Static scans discovered fixed HIGH findings in both the installed Lefthook
2.1.10 binary and the newer integrity-verified 2.1.12 candidate. Neither is
executed after discovery; the candidate was never installed. The root
dependency and old configuration are removed, all three build policies
explicitly deny Lefthook, and the Backend fallback permission is removed.
Global user tools and caches are untouched. Full findings and the distinction
between package-version detection and exploit reachability are recorded in
`DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md`.

Two repository-owned POSIX/Node wrappers preserve pre-commit root QA and serial
pre-push root QA plus Storefront coverage. Exact pnpm identity, disabled
downloads/automatic installs, bounded output, failure/cancellation propagation,
deadlines, refused custom/link targets and recoverable migration are covered
by 58 hook tests. A real tsx loader smoke brings the runtime gate to 59 cases;
the existing Medusa toolchain gate now has eight cases including actual SWC
legacy decorators, reflection metadata, TSX and invalid-input behavior. Root
CI executes the new runtime gate unconditionally, and 88 shared-contract tests
protect parity without changing the ten-member aggregate.

The actual one-time migration changed only the two exact recognized hooks,
preserved both original wrappers as private non-executable backups and left
seventeen unrelated hook entries and Git configuration unchanged. Repeat
installation is a no-op. Hook proof and reviewed lock evidence are retained
under `/tmp/remorseless-maintenance-proof.K3Nd6J`.

The first CI-mode app checks stopped before application execution because an
unset pnpm virtual-store setting resolved differently from the installed local
graph. The durable fix explicitly sets `enableGlobalVirtualStore: false` in
all three source workspaces and generated Backend configuration. Frozen
installation and the unchanged strict CI-mode probe then passed. No CI flag,
dependency-drift guard, cooling rule or build permission was relaxed.

Independent dependency/SBOM/license review passes with zero HIGH/CRITICAL
dependency findings, the same three ignored MODERATE metadata rows and five
known Medusa license-metadata omissions. All eighteen reviewed identities are
in the SBOM, and Lefthook is absent. The native SWC scan has no detected package
inventory and is not claimed as clean compiled-Rust coverage. Evidence is
`/tmp/remorseless-maintenance-security.aeOtwd`.

The final explicit-config graph passes full root QA, including 88 parity and
eleven supply-chain cases, plus the 59-case hook/loader gate. The latter took
5.76 seconds after removing an unnecessary child HOME override; coverage is
92.42% lines, 96.32% branches and 96.67% functions across both helpers, with
each helper independently above 80% on each axis. No HOME setting is changed.

Backend passes 278 suites / 2,163 tests at 91.83% lines/statements, 85.76%
branches and 95.80% functions. Build completed in 73.68 seconds with no warning
or error lines; 330 Admin assets remain within all unchanged budgets. The
generated manifest/lock projection, all sixteen patch hashes, bootstrap,
explicit build denials and virtual-store setting match. Evidence is
`/tmp/remorseless-backend-maintenance-final.ds1v41`.

Storefront passes 908 baseline cases across 143 files and 344 transactional
cases across 38 files, with unchanged coverage thresholds. Both standalone
and source-server builds pass their 131-asset secret/Trusted Types scan;
decoder five and request-completion-order two also pass. The responsive matrix
passes 81 cases with two existing mobile-inapplicable skips, the three-engine
critical matrix passes 48, and launch passes fourteen. Every browser case has
one result and zero retries/flaky outcomes. Representative rendered launch
screenshots were inspected. Owned ports 4010/4300 were released and probed;
user port 3000 was untouched. Evidence is
`/tmp/remorseless-maintenance-storefront-configured-20260908.AuYXPF/isolated.UUcmtT`.

Two earlier private harness attempts remain qualified: pnpm config drift
stopped execution before application tests; a subsequent coverage attempt
passed 907 cases and failed one because build-only optional media/asset values
leaked into a test expecting those values absent. Separating those private
coverage/build environments fixed the harness without changing application
code, assertions or thresholds. Local Pa11y/Lighthouse sandbox limitations are
not waived; supported-runner CI must provide acceptance.

This batch does not supersede accepted `80a83ced` until the combined release's
exact-SHA CI, runtime-image, Railway and deployed-browser/log checks pass. The
now-cooled, independently reviewed PostHog follow-up will share the release
push after its own transport and final-graph checks; no intermediate deployment
is requested for these local commits.

### PostHog follow-up in the combined release (September 8, local gates passed)

The toolchain/hook cohort is local commit
`50a73ef7ab399ac3bc3d062fc39d495797a17c2d`, not an intermediate deployment.
The now-cooled PostHog 5.51.5 / core 1.50.0 pair is included in the same push.
The parent and three mirrors are exact pins, with types 1.407.1 retained.
Independent source/metadata review and the three real-SDK transport tests pass;
the app's provider configuration is unchanged and no live events are sent.
Detailed source, cooling and transport boundaries are in the dependency audit
and QA runbook section 1.14.

The final lock is
`013f83c879d11be7aff1c4c562166b6e2373dcc6fb3915f4cc36d0eda06c45c2`.
Incremental structural proof permits exactly the two reviewed package
replacements, two override-derived peer declarations and one normalized
Medusa context change, with no unrelated edges or Storefront importer changes.
Frozen install passes, preserves explicit local/CI layout policy and leaves
the installed project hooks unchanged. Root parity now passes 102 cases;
the ten shared aggregate members and all earlier checks remain enforced.

Full final-graph root QA passes, including all 102 parity, 59 hook/loader,
three actual-SDK transport and eight Medusa toolchain cases, policy checks,
format/lint and both strict typechecks. Root proof is
`/tmp/remorseless-posthog-proof.pP9f0j/root-qa.log`.

Backend again passes 278 suites / 2,163 tests at 91.83% lines/statements,
85.76% branches and 95.80% functions. Build takes 55.22 seconds with no warning
or error lines; all 330 Admin assets meet the existing budgets. Generated
runtime SDK 5.51.5/core 1.50.0, manifest, lock projection, sixteen patches,
bootstrap and workspace policies are verified. Evidence is
`/tmp/remorseless-backend-posthog-final.kQLNOr/backend-summary.json`.

Storefront again passes 908 baseline and 344 transactional cases, standalone
and default builds (39.29 / 28.87 seconds), both 131-asset scans, decoder five
and runtime-completion two. Final browser results are 81 responsive passes
with two known skips, 48 three-engine critical passes and fourteen launch
passes, with no failures, flaky results or retries. All source checksums and
the lock remain unchanged. Owned ports 4010/4300 are independently verified
free; user port 3000 is untouched. Evidence is
`/tmp/remorseless-maintenance-final-storefront-20260908.4l2D6N`;
browser-summary SHA-256 is
`7fc8adb4d0f814cd9686264d815bb16060396e56ee3e091b9052134c58f324f5`.
Local Pa11y/Lighthouse acceptance remains unclaimed because of the documented
sandbox limitation; the supported CI runner must supply those results.

Independent final audits, exact tarball checksums, installed identities,
licenses and SBOM checks pass. Both production/all dependency audits report
zero HIGH/CRITICAL, with the same three ignored/patched MODERATE metadata rows.
Production/all license inventories retain 1,006 / 1,350 entries and only the
five known upstream-MIT metadata omissions. CycloneDX 1.6 contains 1,310
components / 1,311 dependency entries, including the exact pair and retained
types, with no Lefthook. Its SHA-256 is
`8b33433c059d4d4f2261ba53b21d911e5a11c18b701fafbda779e650ac37d251`.
Evidence is `/tmp/remorseless-posthog-security.FNuaPk`. SBOM inventory and
registry checksum verification are not independent provenance-signature or
compiled-Rust security certification; the previously documented gap remains.

Neither local commit supersedes accepted `80a83ced` until the final combined
SHA passes its own CI, runtime-image, Railway and deployed acceptance. No
intermediate commit was pushed or deployed separately.

### Remaining release work

1. Next.js 16.3.4 is accepted above. Complete the reviewed compatible
   maintenance cohort and dependency-free Git-hook remediation documented in
   `DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md`, preserving framework, provider,
   security-backport and licensing boundaries.
2. Hold Medusa 2.19.0: its [Enterprise license](https://raw.githubusercontent.com/medusajs/medusa/v2.19.0/ENTERPRISE-LICENSE.md)
   requires a commercial agreement for the listed RBAC/SSO materials,
   including policies, permission checks, and compiled forms. This app uses
   RBAC. Retain Medusa 2.18.0, its authorization guards, and Admin UI 4.2.0
   without assuming a paid Enterprise agreement or disabling permissions.
   This optional upgrade does not block unrelated work. The notice preserves
   earlier MIT grants; this is a separate hold, not a licensing change to the
   accepted application dependencies.

## Railway and GHCR cutover boundary

This slice creates deployable candidate images; it does not make them the
artifacts currently running on Railway. Backend and Storefront still build from
GitHub source through Railpack, so attesting the deployed artifact remains open.

A later, separately reviewed cutover must choose one registry access model:

- make each GHCR package public, which is an external and effectively
  irreversible visibility decision; or
- keep packages private and configure Railway Pro with a read-only registry
  credential stored only in Railway.

The cutover must use an immutable SHA tag or digest, change the Backend
pre-deploy command to `node ./scripts/runtime-release-prepare.mjs`, retain
`checkSuites`/release-gate semantics, prove both services and every readiness
dependency, verify GitHub attestations, and demonstrate rollback to the prior
accepted digest. Do not silently change Railway source, package visibility,
credentials, domains, traffic, or production state.
