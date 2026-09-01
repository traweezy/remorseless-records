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
6. Wait for Root, Backend, and Storefront CI to succeed on the exact SHA.
7. Wait for both Railway staging services to deploy that exact SHA, then run
   health, readiness, route/API, log, and applicable browser acceptance.

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
pa11y, Lighthouse, and the SBOM/license job as required master checks. Their
dependency chains also require security scans, CodeQL, lint, strict typecheck,
and unit/coverage tests.

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
