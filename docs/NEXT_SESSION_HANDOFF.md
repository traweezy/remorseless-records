# Next-session handoff

Last updated: 2026-09-06

This document records the local and GitHub acceptance boundary for the
runtime-image hardening slice. GitHub image evidence does not prove which
artifact Railway is running; verify Railway separately with the sequence below.

## Repository state

- Branch: `staging`
- Current accepted implementation head:
  `94d914a12bfc2f25952517ada9167c4d393e20f1`. It includes the accepted Next.js
  16.3.3 build split, Redis 6.2.1, upstream `qs` 6.16.0, Trusted Types
  enforcement, the Form/Resend/PostHog/Pacer/Query/Virtual/Sonner batch, and
  the AWS/Stripe/OpenTelemetry, UI/parser/image/tooling, and recovery batches.
  Complete local, exact-SHA CI, runtime-image, and Railway staging evidence is recorded
  below, including the deployed test-only hydration correction and the bounded
  PostgreSQL backup/restore execution batch.
- Latest exact runtime-image validation SHA:
  `94d914a12bfc2f25952517ada9167c4d393e20f1`
- The prior recovery release's acceptance notes shipped with this substantive
  PostgreSQL execution batch. Its final acceptance notes remain local for the
  next substantive batch; no documentation-only push was made.
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

Local validation passes 61 focused cases at 100% helper lines/functions and
98.90% branches (80% enforced), plus eight read-only tests against the real
pinned Redis 8.10.1 fixture. Real RESP2 tests prove the exact command allowlist,
one connection, denied-command/error redaction, and signal/deadline cleanup.
Review reproduced a pending TLS handshake surviving ordinary client destroy;
an underlying socket AbortSignal fixes it, with real peer-closure regressions
for both timeout and external abort. DNS TLS endpoints also receive SNI while
certificate verification remains mandatory.

A separate synthetic local drill used one owned 256 MiB container with 8 MiB
maxmemory, noeviction, AOF everysec and a `60 1` RDB schedule. Five 1 MiB fill
keys fit; further fill and a 16 MiB write failed OOM without evicting the marker
(evictions 0 to 0). Only the five owned fill keys were deleted. Same-connection
`WAITAOF 1 0 5000` returned `[1,0]` in 995 ms. The marker survived SIGKILL and
restart; it was recovered in 505 ms and a healthy CLI audit completed in
637 ms from the start of the kill call. These are small-fixture measurements
of an acknowledged write, not general RPO/RTO or crash-window-loss guarantees.
The owned container/anonymous volume were removed and its port released.

Frozen installation, the unchanged dependency policy, full root QA over 1,312
files, both strict typechecks and application builds pass. Backend/Admin
builds took 6.56/15.91 seconds; Storefront compiled in 5.7 seconds and its
131-asset secret/Trusted Types bundle scan passed. The initial Storefront
build correctly rejected an inadequate local secret; the successful rerun
used the existing CI-only secret/provider fixtures, without modifying `.env`
or live credentials. Existing fixture search/category fallbacks remain
visible and are not claimed as live provider evidence. Final exact-SHA CI,
runtime images and staging acceptance still follow the grouped push.

### Remaining release work

1. Re-evaluate Next.js 16.3.4 no earlier than
   `2026-09-07T20:00:51.381Z`. Keep it isolated from the `qs`, Medusa, TanStack,
   Stripe, AWS SDK, OpenTelemetry, and small-patch cohorts documented in
   `DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md`.
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
