# Release and Branch Operations

This runbook defines the only supported path from development to production.
It does not authorize a production deployment by itself.

## Branch authority

- `staging` is the default integration branch. Normal work is committed and
  pushed to `staging`; it is the only branch connected to the Railway staging
  Backend and Storefront services.
- `master` is the production-candidate branch. It advances only through a
  reviewed pull request from `staging` after the exact staging commit has
  passed local gates, GitHub CI, Railway deployment, and post-deploy checks.
- `main` is retired and must not be recreated.
- GitHub CI runs for pushes and pull requests targeting either `staging` or
  `master`. A pull request targeting `master` always runs the Storefront build,
  Playwright, pa11y, and Lighthouse jobs; those expensive jobs remain optional
  for ordinary pull requests targeting `staging`.
- Railway production must have automatic GitHub deploys disabled. Deploying an
  exact `master` commit is a separate manual operation after release approval.
- Both Railway staging deployment triggers must retain `checkSuites: true` so
  a source commit waits for GitHub checks before either service builds. Railway
  source reconnection can reset this field; verify it after every source or
  repository-link change.

## Normal staging workflow

1. Confirm `git status -sb` reports `staging...origin/staging` and a clean tree.
2. Implement one cohesive hardening slice and update the authoritative docs.
3. Run focused checks plus lint, strict typecheck, relevant coverage, security
   scans, and both production builds.
4. Create reviewable Conventional Commits and push only to `origin/staging`.
5. Confirm both exact-SHA Railway deployments enter `WAITING` while GitHub
   checks run. A deployment that starts building first is a release-control
   failure even if it later succeeds.
6. Wait for Root, Backend, Storefront, and Runtime Images CI to succeed on the
   exact SHA.
7. Wait for both Railway staging services to deploy that exact SHA, then run
   health, readiness, route/API, log, and applicable browser acceptance.

The Backend unit job and the Storefront unit, browser, accessibility, and
Lighthouse jobs start after security, lint, typecheck, and secret-scan gates.
They overlap the independent CodeQL job to shorten the critical CI path.
The Storefront browser gate runs responsive/launch and three-browser critical
suites on separate runners. Lighthouse audits the six existing routes in two
isolated three-route runners, retaining three runs and the same assertions per
route. The original Browser Smoke and Lighthouse check names are aggregate jobs
that fail unless both respective shards succeed; keep those exact names in
branch protection. Each Lighthouse shard retains its own private report
artifact, named `storefront-lighthouse-content-<run-id>` or
`storefront-lighthouse-commerce-<run-id>`. CodeQL and the production-build
jobs still have to pass before exact-SHA acceptance; no failed or skipped
required job may be treated as a release.

The last unsplit successful run spent 451 seconds in Browser Smoke and 408
seconds in Lighthouse. The first sharded run should target at most 330 and
270 seconds, respectively, before the small aggregate jobs; record actual
durations and report counts before claiming a gain. Extra isolated setup and
builds are expected to add roughly four to five runner-minutes per workflow
while reducing the critical path by about two minutes when both branches run.

Browser navigation gates must wait for an explicit rendered contract after
`domcontentloaded`. Do not use page-wide `networkidle` as a readiness signal:
the Storefront deliberately maintains background cache, telemetry, and
reconnection activity that can keep the network active after the page is ready.

Pre-deploy Browser Smoke uses the loopback-only deterministic Medusa fixture,
including during `next build`. It must not call the current staging Backend:
Railway waits for GitHub checks, so testing an unreleased Backend correction
against the previous live deployment creates a cyclic release gate. The local
fixture proves the Storefront production artifact and browser contracts; it
does not replace post-deploy acceptance. After both exact-SHA Railway services
are healthy, the staging operations monitor must make authenticated bounded
reads of the live Product list, Product-handle feed, merchandising shelves,
and discography projection and require non-empty catalog membership.

An intentional incident latch can keep the operations monitor in `alert` after
the latest heartbeat and every dependency recover. That observation must fail
closed, retain its sanitized JSON/Markdown evidence, and comment the exact
report on the owned alert issue. After successful issue delivery, the scheduled
monitor job itself stays green so Railway cannot conflate an operational alert
on the current default-branch SHA with release CI. A generic
`observation_evaluation_failed` comment while the artifact contains a valid
report is a release-control defect; fix and rerun the monitor before accepting
the observation evidence. Never clear the latch to make the observation
healthy.

Do not begin another slice while any exact-SHA staging gate is unresolved.

## Immutable runtime image candidates

The Runtime Images workflow validates Backend and Storefront images on
`staging` without publishing them. Only an exact `master` ref may publish an
immutable GHCR SHA tag. Manual dispatch does not broaden that rule. Each
published subject must have all of the following on the same digest:

- a passing non-root/package-manager-free runtime contract;
- zero fixed high or critical Trivy findings under the reviewed policy;
- a retained CycloneDX SBOM and schema-checked image record;
- GitHub build-provenance attestation; and
- GitHub CycloneDX SBOM attestation pushed to the registry.

The runtime recipes retain the reviewed Node image digest and install Debian
`libpcre2-8-0=10.42-1+deb12u1` for
[CVE-2026-86145](https://security-tracker.debian.org/tracker/CVE-2026-86145) and
[CVE-2026-89161](https://security-tracker.debian.org/tracker/CVE-2026-89161).
The amd64 and arm64 archive hashes in
[`runtime-image-policy.json`](../scripts/security/runtime-image-policy.json)
were verified against Debian's signed `bookworm-security` package indexes.
Docker verifies those checksums before exposing the archives through a
read-only build mount; package name, version, architecture, and installed
status must match. Unsupported architectures fail. The archives do not remain
in the runtime image. Refreshing this pin requires the same signed-metadata
verification, policy review, package-identity checks, and full image scan.
A package-only proof does not replace scanning the final application image or
establish that Railway's source-built deployment contains the same OS update.

### Bound scan evidence

`scan-runtime-image.mjs` scans the resolved local Docker image ID on Linux
amd64. The pinned Trivy 0.70.0 executable must match the reviewed SHA-256 in
`runtime-image-policy.json`. The pinned setup action's
[immutable installer](https://github.com/aquasecurity/trivy/blob/75c4dc0f45c5d7ffd05ae26df1e0c666787bdf2a/contrib/install.sh)
routes the release archive through `get.trivy.dev:443` before checking its
GitHub release checksum. Both blocked-egress runtime jobs allow that exact
HTTPS endpoint; wildcard Trivy hosts and plaintext ports remain disallowed.
The scanner independently verifies the executable's reviewed hash before use.
Each run downloads one fresh database into a private cache, freezes it,
disables subsequent updates, and streams SHA-256
hashes of the database and metadata before and after the vulnerability scan
and CycloneDX generation. The database must be current, unchanged throughout
the bounded scan interval, and younger than 48 hours at completion.
Before the master-only push, the workflow rechecks the retained evidence
against the runner clock: the scan must have completed no more than 30 minutes
ago, completion cannot be in the future, and the database must still be
unexpired and no more than 48 hours old. Historical artifact verification
omits that current-time check so retained evidence remains reviewable.

The schema 2 `<service>.image.json` record binds the image ID and revision to
scanner identity, database hashes/timestamps, exact report/SBOM byte hashes,
package coverage, complete severity counts, and fixed HIGH/CRITICAL findings.
Package URLs bind the inventories across Debian revision/epoch formatting and
scoped npm package names. Unfixed findings remain visible; the gate retains
its existing fixed HIGH/CRITICAL policy. The workflow uploads the small
metadata, full reports, records, and any failure markers even on failure;
it never uploads the database itself. Hashes establish the exact bytes used
by the trusted scan job, while replaying a historical scan would also require
those database bytes.

```bash
node scripts/scan-runtime-image.mjs \
  --service backend --revision '<40-character-source-sha>' \
  --image-id 'sha256:<local-image-config-id>' --output /absolute/new-evidence
node scripts/verify-runtime-image-artifacts.mjs \
  /absolute/new-evidence/backend.image.json
```

Use an existing, canonical parent directory; the scanner creates the new
output directory with mode 0700 and files with mode 0600. Verification rejects
symlinks, hardlinks, directory replacement, concurrent file changes, or a
failure marker. For downloaded GitHub artifacts, restore the entire artifact
including failure markers into a new private directory and restore JSON file
modes to 0600 before verification. Do not selectively copy a success record
away from its failure marker. The workflow verifies in the producing job,
where private modes are retained.

On `master`, the workflow revalidates the local evidence and tag identity
before pushing. `finalize-runtime-image-publication.mjs` then reads the
registry descriptor, fetches its exact manifest by digest, and checks raw
manifest hash/size and its configuration digest against the scanned local
image ID. It rejects multi-platform indexes. The separate
`<service>.published.image.json` record binds this manifest and descriptor to
the unchanged scan; attestations use that verified published digest. The
finalizer only reads the registry. Failed/cancelled publication evidence
cannot verify as success, and cancellation reaps the owned scanner/registry
child before returning.

Verify before any deployment source change:

```bash
gh attestation verify \
  'oci://ghcr.io/traweezy/remorseless-records-backend@sha256:<digest>' \
  --repo traweezy/remorseless-records
gh attestation verify \
  'oci://ghcr.io/traweezy/remorseless-records-storefront@sha256:<digest>' \
  --repo traweezy/remorseless-records
```

Railway's Debian 13 source runtime uses a separate package fix:
root `railpack.json` preserves Railpack's generated runtime package set and
adds `libpcre2-8-0=10.46-1~deb13u2`. The reviewed Railpack 0.39.0 generated
Backend and Storefront plans retain their existing build/start commands and
layers; the change adds that exact package to the runtime apt layer. A
throwaway copy of the current Railway runtime base verified Debian's signed
apt metadata and exactly one package upgrade from `10.46-1~deb13u1` to
`10.46-1~deb13u2`, with no additional or removed packages. This source-build
fix is distinct from the bookworm image recipe above. Acceptance requires
checking the installed package version in both new live application
deployments after exact-SHA success; a generated plan alone is insufficient.

Railway currently builds both applications from GitHub source with Railpack.
Publishing an image therefore does not prove the Railway deployment is that
image. Keep the hardening-plan deployed-artifact item open until a separately
approved source cutover deploys the verified digests and completes exact-SHA
health, readiness, route, log, and rollback acceptance.

When testing an image source in a controlled environment, Backend pre-deploy
must use `node ./scripts/runtime-release-prepare.mjs`; the source-build command
`pnpm --filter backend --silent run release:prepare` is not present in the
package-manager-free image. Never weaken the database role split, storage
check, or versioned search rebuild during that change.

## Abuse-control and trusted-proxy operations

Storefront and Backend generic abuse controls share Redis fixed-window
counters. Each request performs one atomic Lua evaluation containing `INCR`,
first-write `PEXPIRE`, and `PTTL`. The key contains the route class and an HMAC
of the resolved client address; it never contains the raw IP or User-Agent.
The command and connection deadline is two seconds, the offline queue is
disabled, and each process permits at most 1,000 queued Redis commands.

Railway is the only trusted forwarding boundary. Railway documents that its
edge terminates TLS and adds `X-Real-IP` for the client remote address, and that
`RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, and `RAILWAY_SERVICE_ID` are
provided to every deployment. The applications require all three system IDs
before accepting a validated `X-Real-IP`. Storefront otherwise uses the shared
`unknown` bucket because the Web Request object has no authenticated socket
peer; Backend otherwise uses its direct socket peer. Neither application uses
`X-Forwarded-For`, `CF-Connecting-IP`, or User-Agent for this decision. See
[Railway public-networking limits](https://docs.railway.com/networking/public-networking/specs-and-limits),
[edge architecture](https://docs.railway.com/networking/edge-networking), and
[system variables](https://docs.railway.com/variables/reference).

The Redis outage matrix is explicit:

| Surface                                                               | Redis unavailable                      |
| --------------------------------------------------------------------- | -------------------------------------- |
| Storefront catalog, product, bundle, news, search, and hydrate reads  | Use the bounded process-local fallback |
| Storefront contact, privacy, and cart mutations                       | Return correlated RFC 7807 HTTP 503    |
| Backend catalog, checkout-status, tax-record, refund, and media reads | Use the bounded process-local fallback |
| Backend Store, public-form, tax-control, and media mutations          | Return correlated RFC 7807 HTTP 503    |

After a staging deployment that changes these boundaries:

1. Require `/live` and dependency-aware `/ready` to return 200 on both services.
2. Exercise the standard Product list, bounded Product-handle feed, public
   merchandising shelves, bounded discography projection, one catalog/search
   read, and one non-mutating cart read. Require at least one visible Product
   and one shelf membership; do not deliberately exhaust a shared public
   bucket.
3. Confirm ordinary responses do not contain `rate_limit_unavailable` and
   inspect the exact-deployment logs for `rate_limit.unavailable`, Redis
   connection errors, or unexpected 429/503 growth.
4. Confirm Redis readiness, memory, evictions, rejected connections, and
   command latency remain healthy before accepting the deployment.
5. Treat mutation 503 responses as a Redis incident. Restore Redis rather than
   bypassing, raising, or changing the fail-closed policy during the incident.

Rollback is a normal revert on `staging`, followed by the complete exact-SHA
acceptance loop. Do not reintroduce process-only mutation limiting or trust a
client-supplied forwarding chain as an emergency workaround.

## Promotion to master

1. Freeze the accepted `staging` SHA in the release record.
2. Open a pull request whose head is `staging` and base is `master`.
3. Require a green master-targeted CI matrix, resolve review conversations,
   and verify the pull request contains only accepted staging commits.
4. Merge through GitHub. Direct pushes, force pushes, and deletion of `master`
   are prohibited.
5. Confirm `master` points to the reviewed merge commit. A merge does not
   authorize or trigger production deployment.

GitHub enforces the Backend and Storefront builds, Playwright smoke suite,
pa11y, Lighthouse, and the SBOM/license job as required master checks. Security
scans, CodeQL, lint, strict typecheck, and unit/coverage jobs remain mandatory;
long-running jobs may overlap CodeQL but cannot replace its result.

## Manual production release

Railway currently has no production environment. Creating it, adding domains
or credentials, changing traffic, or incurring production cost requires a
separate explicit approval and the remaining launch gates in
`PRODUCTION_HARDENING_PLAN.md`. The required topology, cost, database-role,
backup, restore, Redis, search, and media evidence is defined in
[`INFRASTRUCTURE_RECOVERY.md`](INFRASTRUCTURE_RECOVERY.md).

When production exists, keep Backend and Storefront GitHub autodeploy disabled.
An operator must select the approved exact `master` SHA, verify environment and
test/live credential boundaries, deploy manually, observe health and migrations,
run the production smoke matrix, and record immutable deployment identifiers.
Never use a moving branch head as the release evidence.

Database release preparation supports separate runtime and migration URLs.
Keep `DATABASE_ROLE_SPLIT_REQUIRED=false` only during the documented staged
role rollout. Once the distinct roles pass their audits, set it to `true` so a
missing or reused migration URL stops the release before migration.

## Rollback

- Staging: revert the faulty commit on `staging`, push, and repeat exact-SHA
  acceptance. Do not rewrite shared history.
- Master: revert through a new `staging`-to-`master` pull request unless the
  incident procedure explicitly authorizes an emergency reviewed hotfix.
- Production: restore the last accepted immutable artifact and follow the data
  rollback/runbook appropriate to the change. Never disable security controls
  or reverse a destructive migration ad hoc.

Tax collection-mode rollback is expand-only. Never remove
`Migration20260830150000`, rewrite disabled evidence as provider evidence, or
bulk-reset the durable mode. Follow
[`TAX_CONTROL_OPERATIONS.md`](TAX_CONTROL_OPERATIONS.md) and restore a runtime
that can read every historical mode before changing traffic.
