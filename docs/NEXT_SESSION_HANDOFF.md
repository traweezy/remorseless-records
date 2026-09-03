# Next-session handoff

Last updated: 2026-09-03

This document records the local and GitHub acceptance boundary for the
runtime-image hardening slice. GitHub image evidence does not prove which
artifact Railway is running; verify Railway separately with the sequence below.

## Repository state

- Branch: `staging`
- Current accepted implementation head:
  `6df5cbb2d0dcd111b87ed7cf0b2c03015f336e1a`. It includes the accepted Next.js
  16.3.3 build split, the Storefront's five-package TanStack Query 5.102.7
  patch cohort, and the shared Redis 6.2.1 client cohort. Complete local,
  exact-SHA CI, runtime-image, and Railway staging evidence is recorded below.
- Latest exact runtime-image validation SHA:
  `6df5cbb2d0dcd111b87ed7cf0b2c03015f336e1a`
- Implementation/runtime-image acceptance SHA
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
- Runtime Images run `33688896070` passed both services at the exact accepted
  SHA; Backend job `100442798263` and Storefront job `100442798721` succeeded,
  while publication job `100442800014` skipped on `staging` as required.
- Root run `33688896124`, Backend run `33688896267`, and Storefront run
  `33688896038` all passed at the exact accepted SHA. Storefront included
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
  Storefront Redis client graph to the cooled 6.2.1 patch line.

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
- `qs` remains exactly 6.15.3 while 6.16.0 completes the mandatory seven-day
  cooling window. The two upstream security hunks are copied identically into
  the root, Backend, and Storefront workspaces. The verifier exercises the
  bracket/comma `arrayLimit` rejection and hostile `constructor.isBuffer`
  parse-to-stringify round trip through both application dependency paths.
  Only the two corresponding GHSA records are ignored, with machine-readable
  evidence. Replace this backport with 6.16.0 no earlier than
  2026-09-05T23:50:15.803Z, then remove both ignores, all three patch copies,
  and `qa:qs-security` in the same change.

## Local acceptance evidence

- `pnpm install --frozen-lockfile`: passed with pnpm 11.17.0.
- `pnpm run qa:lint`: passed, including Biome, both strict TypeScript checks,
  database release boundaries, runtime-image policy, CI egress policy, and all
  repository contract verifiers after the final code and documentation edits.
- Runtime policy: 8/8 focused tests plus static verifier passed.
- CI runtime-security policy: 4/4 focused tests plus the six-workflow verifier
  passed; the Runtime Images workflow contains two separately hardened jobs.
- Release-plan policy: 6/6 focused tests passed.
- Backend coverage: 273 suites / 2,066 tests passed; 91.58% statements, 85.31%
  branches, 95.78% functions, and 91.58% lines.
- Storefront baseline coverage passed at 94.37% statements, 86.06% branches,
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
  `fast-uri` 3.1.6, and the patched `qs` 6.15.3 graph.
  The client-bundle scanner found no server-only secret or public Meilisearch
  input in 131 Storefront assets.
- `pnpm audit --prod --audit-level=moderate` passed with five documented,
  behaviorally patched findings ignored: the three existing React Router
  records and the two new exact-version `qs` records. The four `fast-uri`
  findings are eliminated by the 3.1.6 upgrade.
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

## Remaining work for this slice

1. After the report-only observation window reaches
   `2026-09-03T22:08:00Z`, rerun real staging browser coverage and inspect the
   complete Trusted Types report window before deciding whether enforcement is
   eligible. Do not enable enforcement from empty short-window logs alone.
2. No earlier than `2026-09-05T23:50:15.803Z`, replace the `qs` 6.15.3
   backport with mature 6.16.0 and remove both audit ignores, all three patch
   copies, and `qa:qs-security` together. Run the complete local and exact-SHA
   acceptance matrices again.
3. Re-evaluate Next.js 16.3.4 no earlier than
   `2026-09-07T20:00:51.381Z`. Keep it isolated from the `qs`, Medusa, TanStack,
   Stripe, AWS SDK, OpenTelemetry, and small-patch cohorts documented in
   `DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md`.
4. Continue cooled isolated cohorts with TanStack Form 1.33.5, Resend 6.24.0,
   PostHog 5.51.3, UI/test patches, and exact GitHub Action commit updates.
   Redis 6.2.1 is complete. Keep Pacer 0.22.0, Stripe, AWS SDK,
   OpenTelemetry, and Medusa in their separately reviewed compatibility
   cohorts.

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
