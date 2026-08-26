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

Do not begin another slice while any exact-SHA staging gate is unresolved.

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
`PRODUCTION_HARDENING_PLAN.md`.

When production exists, keep Backend and Storefront GitHub autodeploy disabled.
An operator must select the approved exact `master` SHA, verify environment and
test/live credential boundaries, deploy manually, observe health and migrations,
run the production smoke matrix, and record immutable deployment identifiers.
Never use a moving branch head as the release evidence.

## Rollback

- Staging: revert the faulty commit on `staging`, push, and repeat exact-SHA
  acceptance. Do not rewrite shared history.
- Master: revert through a new `staging`-to-`master` pull request unless the
  incident procedure explicitly authorizes an emergency reviewed hotfix.
- Production: restore the last accepted immutable artifact and follow the data
  rollback/runbook appropriate to the change. Never disable security controls
  or reverse a destructive migration ad hoc.
