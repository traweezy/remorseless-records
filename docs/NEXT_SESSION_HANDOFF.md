# Next-session handoff

Last updated: 2026-09-02

This document records the local acceptance boundary for the runtime-image
hardening slice. Local evidence does not establish GitHub exact-SHA acceptance
or prove which artifact Railway is running; verify those separately with the
sequence below.

## Repository state

- Branch: `staging`
- Local validation base SHA:
  `1689969cd0b3546c6d54e1efc0d6def0e79a7e28`
- Root CI run `33504622716` and Backend CI run `33504622709` passed that SHA.
  Storefront CI run `33504622686` failed because the deterministic discography
  fixture used a date-only value and the `/catalog` three-sample median total
  blocking time was 372.5 ms against the unchanged 350 ms budget. Both failures
  are corrected and pass locally in this worktree.
- Scheduled staging operations and scheduler monitors continue to pass on the
  committed SHA. No production environment exists and no production state was
  changed.
- Dependabot PR `#6` proposes only the Backend manifest half of the
  `sanitize-html` 2.17.7 update and fails its frozen install. This worktree
  upgrades both direct consumers, updates the shared lockfile, and proves the
  compatibility path. Do not merge the incomplete PR over this work.
- `Default/` is unrelated untracked user data. Do not read, modify, stage, or
  commit it.
- Railway remains on the existing staging source/Railpack configuration. No
  service source, credential, package visibility, domain, or traffic setting
  changed in this slice.

The containing change set updates the following tracked files for the
runtime-image implementation, documentation, and fixture/security corrections:

- `README.md`
- `backend/package.json`
- `backend/scripts/lib/release-prepare.mjs`
- `backend/src/lib/content/rich-text.test.ts`
- `docs/DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md`
- `docs/INFRASTRUCTURE_RECOVERY.md`
- `docs/PRODUCTION_HARDENING_PLAN.md`
- `docs/QA_RUNBOOK.md`
- `docs/RELEASE_OPERATIONS.md`
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

## Local acceptance evidence

- `pnpm install --frozen-lockfile`: passed with pnpm 11.17.0.
- `pnpm run qa:lint`: passed, including Biome, both strict TypeScript checks,
  database release boundaries, runtime-image policy, CI egress policy, and all
  repository contract verifiers after the final code and documentation edits.
- Runtime policy: 7/7 focused tests plus static verifier passed.
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
- Backend and Storefront production builds passed with `sanitize-html` 2.17.7.
  The client-bundle scanner found no server-only secret or public Meilisearch
  input in 130 Storefront assets.
- `pnpm audit --prod --audit-level=moderate` passed with only the three existing,
  documented, behaviorally patched React Router findings ignored.
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
release artifacts. GitHub must rebuild and record definitive images against an
exact candidate commit SHA.

## Remote acceptance sequence

1. Require Root, Backend, Storefront, and Runtime Images CI on the exact
   candidate SHA. GitHub's workflow parser is the final YAML/expression
   validation because local `actionlint` had no selected asdf version during
   local acceptance.
2. Confirm staging Runtime Images builds, smokes, scans, and retains evidence
   without logging in or publishing a GHCR package. Recheck that the incomplete
   Dependabot PR is superseded before closing it.
3. Observe the normal exact-SHA Railway staging deployments and bounded health,
   catalog, and log checks. Do not change Railway's source model in this slice.

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
