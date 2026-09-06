# Next-session handoff

Last updated: 2026-09-06

This document records the local and GitHub acceptance boundary for the
runtime-image hardening slice. GitHub image evidence does not prove which
artifact Railway is running; verify Railway separately with the sequence below.

## Repository state

- Branch: `staging`
- Current accepted implementation head:
  `c20efbebed1ef328388ced0f99edd8ac3dacc7ed`. It includes the accepted Next.js
  16.3.3 build split, Redis 6.2.1, upstream `qs` 6.16.0, Trusted Types
  enforcement, the Form/Resend/PostHog/Pacer/Query/Virtual/Sonner batch, and
  the AWS/Stripe/OpenTelemetry batch. Complete local, exact-SHA CI,
  runtime-image, and Railway staging evidence is recorded below. The next
  UI/parser/image/tooling batch does not yet supersede this deployed revision.
- Latest exact runtime-image validation SHA:
  `c20efbebed1ef328388ced0f99edd8ac3dacc7ed`
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

### Next UI, parser, image, and tooling batch

The next shared frozen graph groups 15 reviewed direct upgrades: Lucide,
Motion/Framer Motion, Zustand/Immer, the owned CSV parser, Sharp, PostCSS,
esbuild, Biome, Vitest/coverage, Testing Library, and Playwright. The dependency
audit records exact versions, official publication/cooling evidence, preserved
patches and framework-owned holds. The UI corrections are committed at
`ec66bb99618a170be8dd4e0a3f5e8f10833827db`; this next batch is not yet deployed.

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
no sandbox bypass or host change was used. Require the exact-SHA sandboxed
GitHub accessibility and Lighthouse gates before accepting the next revision.

The final rebuilt Admin passes 12/12 under Node 26.5.0 with
`ADMIN_ACCEPTANCE_BASE_URL` unset, zero axe violations/incomplete checks,
findings, review codes, or case errors. Five inspected Product, News, and
Merchandising Chromium screenshots at 760–1,920 px show no visible regression;
artifacts are at `/tmp/remorseless-tooling-admin-node265.SYThuV`. These remain
deterministic local fixtures, not live Admin or provider acceptance.

### Remaining release work

1. Re-evaluate Next.js 16.3.4 no earlier than
   `2026-09-07T20:00:51.381Z`. Keep it isolated from the `qs`, Medusa, TanStack,
   Stripe, AWS SDK, OpenTelemetry, and small-patch cohorts documented in
   `DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md`.
2. Finish the next UI/parser/image/tooling batch's exact-SHA CI, image, and
   staging gates. Ship implementation and evidence
   together; do not add documentation-only checkpoint pushes. Keep Medusa
   changes subject to their separate migration review; batching is not
   permission to skip compatibility checks.
3. Hold Medusa 2.19.0: its [Enterprise license](https://raw.githubusercontent.com/medusajs/medusa/v2.19.0/ENTERPRISE-LICENSE.md)
   requires a commercial agreement for the listed RBAC/SSO materials,
   including policies, permission checks, and compiled forms. This app uses
   RBAC. Retain Medusa 2.18.0, its authorization guards, and Admin UI 4.2.0
   until the user confirms licensing or separately approves an authorization
   migration. The notice preserves earlier MIT grants; this is a separate
   hold, not a licensing change to the current 15-direct batch.

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
