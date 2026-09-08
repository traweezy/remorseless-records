# Disposable PostgreSQL and Redis verification

These fixtures exercise the real Medusa application and recovery helpers with
synthetic data. They are not deployment images, backups of staging, or approval
to change a live support service. Use the repository's pinned Node and pnpm
toolchain and Docker with Linux/amd64 support.

## Local functional verification

```bash
pnpm run qa:disposable-integration
```

The runner builds the two recipes under `docker/integration`, starts their exact
local images, waits for readiness, runs the integration contracts and removes
its disposable resources. It refuses a pre-existing Compose project rather
than adopting or deleting someone else's containers, networks or volumes.
Do not remove that safety check to reuse a live database.
Run local invocations serially: the fixed-project preflight is not a
cross-process mutex. CI already serializes overlapping runs through its
workflow concurrency group.

The PostgreSQL database uses synthetic credentials and tmpfs storage. Redis
uses tmpfs with RDB/AOF disabled, a 64 MiB `noeviction` budget and no persistent
volume. Both expose only loopback ports: PostgreSQL 55432 and Redis 56379 by
default. `RR_INTEGRATION_POSTGRES_PORT` and `RR_INTEGRATION_REDIS_PORT` may
select distinct non-privileged ports if another local process owns a default.
The fixtures use an ordinary Docker bridge because the test processes run on
the host. An internal-only bridge discarded published ports on Docker Desktop
29.7.2 despite healthy in-container checks; an isolated comparison reproduced
the difference. The runner verifies each actual loopback port binding before
starting tests. This is not an outbound network firewall for host-run tests.
Compose explicitly ignores automatic `.env` input. Medusa itself still loads
its environment files; the runner overrides known Stripe, Resend, Meilisearch,
MinIO, tax-provider and telemetry credentials/routing with empty or safe test
values so those files cannot re-enable these integrations. A synthetic `.env`
regression verifies that override behavior against the installed loader.

The suite verifies real API readiness, custom migrations, payment-lifecycle
idempotency/retries, distributed locks, PostgreSQL backup/restore CLI guards,
the Redis audit's read-only command allowlist and API contract parity. Its
Redis audit intentionally reports persistence disabled: this is the correct
result for an ephemeral test fixture, not an accepted live configuration.
The runner bounds local image building to ten minutes, service readiness to
two minutes, and the test aggregate to fifteen minutes. Scanning has a
fifteen-minute overall deadline and five-minute Trivy command deadlines.
These are failure budgets, not expected durations: the initial corrected
106-case service run completed in 21.82 seconds.

The session-rotation matrix additionally uses the installed Medusa
authentication middleware and official session-creation handler with their
installed Express session/Redis-store dependencies. Four loopback HTTP
instances share only a unique synthetic Redis session namespace. It tests
unchanged keys, JWT-only rotation, cookie-only rotation and both-secret
rotation, including old-instance rejection of new credentials and session
precedence over an invalid bearer. Exact owned session keys and HTTP servers
are cleaned up. Credentials are generated for the test; it does not exercise a
password/OAuth provider, a browser TLS handshake, a live instance drain or a
real account. See `CHECKOUT_OPERATIONS.md` for the still-required live drill.

## Image security and identity

The recipes retain immutable official PostgreSQL 18.6 and Redis 8.10.1 bases.
Only documented, exact-version security corrections are applied. Redis keeps
its server, CLI, modules and privilege-dropping entrypoint. PostgreSQL keeps
its server and entrypoint; its `gosu` helper is rebuilt from checksum-pinned
upstream source with a pinned Go toolchain and reviewed dependency fixes.
The build context excludes repository code, `.env`, credentials and app data.
Package repository signature verification remains enabled. Missing exact
package versions fail the build instead of floating to a replacement.

Backend CI builds these same recipes rather than starting a second set of
unpatched GitHub service images. It then runs
`scripts/scan-disposable-integration-images.mjs` against resolved local image
IDs with a reviewed Trivy version and vulnerability database. The scan is
Docker-only, includes OS and detected library packages, and retains all
severity results without ignore files, VEX or an `ignore-unfixed` exemption.
Both images must pass before their IDs are exported to the integration runner.
`--no-build` requires those two IDs and checks the actual running containers;
it neither rebuilds after scanning nor falls back to a registry pull.

CI retains the image-bound JSON vulnerability reports, CycloneDX SBOMs and
identity/checksum records in the private `disposable-integration-images`
artifact for 14 days, including available evidence when a gate fails.
The local scanner accepts `--output <new-directory>` and optional `--offline`;
offline mode records the cached database's age and is not a fresh-DB CI result.
It refuses existing output directories instead of overwriting prior evidence.

The rebuilt `gosu` main Go module is reported without a package version; that
gap is explicitly retained in the image record, with source identity established
separately by the pinned archive, recipe and executable version check.
Detected package inventories do not establish complete compiled-server
coverage. In particular, Redis modules/server internals and PostgreSQL's
compiled internals are not fully inventoried by these package scans. This
fixture gate does not replace upstream advisory review, production licensing,
immutable deployment publication or real-backup restore acceptance.

## Failure handling

Do not suppress a scan, change a severity, drop a test or switch back to a
vulnerable fixture to make CI green. Record the exact failed image, scanner
database and finding; remediate the pinned recipe and repeat the entire
build/scan/test chain. A passing functional run alone is not image-security
acceptance. Changes to staging Redis or PostgreSQL remain separately reviewed
operations under `INFRASTRUCTURE_RECOVERY.md`.
