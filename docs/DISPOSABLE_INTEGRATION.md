# Disposable PostgreSQL and Redis verification

These fixtures exercise the real Medusa application and recovery helpers with
synthetic data. They are not deployment images, backups of staging, or approval
to change a live support service. Use the repository's pinned Node and pnpm
toolchain, PostgreSQL 18.6 clients (`pg_dump`, `pg_restore`, `psql`) on `PATH`,
and a Linux host with Docker Linux/amd64 support (client-reaping verification
uses `/proc`). The fixture and real recovery suite reject
client/server version drift before creating a test database.

## Local functional verification

```bash
pnpm run qa:disposable-integration
```

On Ubuntu 24.04 amd64 (or an Ubuntu 24.04-compatible noble derivative), the
repository can provision the reviewed clients without root privileges or
changing system packages:

```bash
recovery_tools="$(mktemp -d)"
node scripts/provision-postgres-recovery-client.mjs --output-dir "$recovery_tools/postgres"
PATH="$recovery_tools/postgres/bin:$PATH" pnpm run qa:disposable-integration
```

The helper needs `gpg`, `gpgv`, `dpkg-deb` and the normal Ubuntu client runtime
libraries. It has a two-minute overall deadline. It verifies the pinned PGDG
key bytes/fingerprint, the signed `InRelease`, the package-index SHA256, and
both independent package hashes before extracting exact
`postgresql-client-18` and `libpq5` version `18.6-1.pgdg24.04+2`. Private
launchers select that libpq and `exec` the real client; the recovery supervisor
still owns the actual client PID. Maintainer scripts and package installation
are never run. Remove only the temporary directory created for this command
when finished. Official repository setup is documented by
[PostgreSQL](https://www.postgresql.org/download/linux/ubuntu/).

Backend CI pins Ubuntu 24.04 and provisions these clients before integration.
It retains `verification.json`, the signing key, `InRelease` and `Packages.gz`
in `postgres-recovery-client-provenance` for 14 days. The record binds the
signature identity, metadata hashes and package hashes. If PGDG removes an
older pinned package from its current signed index, provisioning fails: review
the current release and update the verified pins deliberately. There is no
fallback to a newer package, unsigned metadata or the runner's older client.

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
idempotency/retries, distributed locks, a real PostgreSQL backup/restore CLI
roundtrip and rejection/cancellation guards,
the Redis audit's read-only command allowlist and API contract parity. Its
Redis audit intentionally reports persistence disabled: this is the correct
result for an ephemeral test fixture, not an accepted live configuration.
The runner bounds local image building to ten minutes, service readiness to
two minutes, and the test aggregate to fifteen minutes. Scanning has a
fifteen-minute overall deadline and five-minute Trivy command deadlines.
These are failure budgets, not expected durations: the initial corrected
106-case service run completed in 21.82 seconds.

The recovery roundtrip creates independent, randomly named source and target
databases from `template0`, using only the fixed loopback synthetic fixture
credentials. It runs the actual backup and restore commands, independently
checks the custom archive/manifest hashes and private modes, verifies dry-run
leaves an empty target, and restores Unicode, exact numeric, JSONB, timestamp,
binary and nullable values. Restored views, routines, identity sequences,
foreign keys, unique, not-null and check constraints are exercised. Other
cases reject changed/truncated/invalid archives, excess snapshot bytes, wrong
confirmation, the source endpoint and populated targets. A late COPY check
failure must roll back the whole transaction before the deadline; cancellation
tests observe a real blocked `pg_dump`, verify its host PID exits and partial
files disappear, then release the owned lock and check server-session cleanup.
PostgreSQL's default `client_connection_check_interval=0` means a running
lock-wait query can retain its server session until the next socket interaction;
local client cancellation does not promise immediate server cancellation.
See the [PostgreSQL connection-check documentation](https://www.postgresql.org/docs/18/runtime-config-connection.html#GUC-CLIENT-CONNECTION-CHECK-INTERVAL).
The snapshot test changes the original
archive after copying and restores the verified private copy. The existing
mocked CLI race test separately covers mutation between snapshot verification
and command execution. All owned connections, databases and temporary files
are cleaned up. This exercises synthetic logical recovery, not a provider
backup, PITR, production restore timing or application acceptance after a live
restore.

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

### Recovery acceptance on 2026-09-14

The original recovery test files passed all 28 cases in 3.54 seconds against
an owned native loopback PostgreSQL `18.6-1.pgdg24.04+2` cluster, using the
verified private clients and the final dependency graph. The late COPY error
returned in 319 ms, signal cancellation in 104 ms, and the two-second deadline
case in 2,063 ms. The test-owned cluster process, socket and data directory
were removed. Signed client provisioning also passed against official PGDG
metadata; independently changing signed metadata made `gpgv` reject it.

The same 28 cases also passed against the exact hardened fixture images in
4.59 seconds, with 21 relay connections opened and closed and all owned
containers/networks/volumes removed. The late COPY failure returned in 863 ms,
signal cancellation in 236 ms, and the deadline case in 2,151 ms.

This host had a separate Docker bridge publication defect: mapped ports
accepted TCP while PostgreSQL protocol requests timed out. Local image proof
therefore used a private loopback-to-`docker exec` transport, verifying the
immutable container/image IDs before connection. The earlier BusyBox `nc`
relay retained EOF during cancellation; its replacement used the image's
existing Bash/`dd` to forward short reads and close on either peer's EOF.
Only the corrected transport's strict results were accepted. No fixture image
or global Docker settings changed. This verifies real CLI behavior and the
exact fixture images, with a local transport limitation. Backend CI runs the
same files over the normal published loopback ports and must pass before
release acceptance.

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
