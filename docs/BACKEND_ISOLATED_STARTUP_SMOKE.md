# Isolated Backend startup smoke

This check starts the exact-revision Backend application against a **fresh,
disposable, already restored** PostgreSQL 16 target. It first reruns the
source-scope, image, collation, and row-count verification in
`postgres-isolated-target verify`. It then starts a server-only Medusa process
and disposable Redis in a Docker network namespace whose anchor has
`--network none`. No port is published. The Backend sees PostgreSQL only through
an in-container loopback-to-Unix-socket relay; the target password is mounted
read-only and never placed in Docker arguments or container metadata.

Medusa startup can create default store records. Treat this as a **one-use
target**: do not use the target for another restore acceptance check after this
smoke. The private source snapshot bundle remains untouched. This check uses
`NODE_ENV=development` to omit provider credentials, with
`MEDUSA_WORKER_MODE=server`; it checks `/live` and `/ready` for the exact SHA and
only the database and Redis probes. These settings prove compiled module
loading and worker-free startup compatibility with the restored database. They
do not prove production provider configuration, background jobs, or provider
readiness. The network boundary prevents provider egress even if application
code tries it.

From an exact-SHA checkout with the reviewed, local PostgreSQL target and
runtime image already available:

```sh
REVISION="$(git rev-parse HEAD)"
TARGET_DIR=/absolute/private/path/pg16-target-0123456789abcdef0123456789abcdef
BACKEND_IMAGE_ID="$(docker --context default image inspect \
  --format '{{.Id}}' "rr-backend-smoke:$REVISION")"
node scripts/backend-isolated-startup-smoke.mjs \
  --target-dir "$TARGET_DIR" \
  --backend-image "$BACKEND_IMAGE_ID" \
  --revision "$REVISION"
```

The CLI rejects a nonlocal Docker default context, a source/target identity or
receipt mismatch, an unexpected image ID/revision or image user other than
`1000:1000`, changed container security settings, unavailable Redis, degraded
health, and cleanup failure. It emits
only a bounded status JSON object, never raw Backend logs or credentials. It
removes only its randomly labeled anchor, Redis, and Backend containers. The
restored PostgreSQL target is intentionally left for inspection; use the
separate `postgres-isolated-target cleanup` command when the operator is done.

If the exact-SHA Backend runtime image is not yet local, build it from this
checkout following the pinned root lockfile and the Runtime Images CI recipe:

```sh
pnpm install --frozen-lockfile
NODE_ENV=test \
  DATABASE_URL=postgresql://postgres:synthetic@127.0.0.1:5432/synthetic \
  JWT_SECRET=synthetic-backend-smoke-jwt-secret-20260919 \
  COOKIE_SECRET=synthetic-backend-smoke-cookie-secret-20260919 \
  pnpm --filter backend run build
docker --context default build --pull=false \
  --build-arg "REVISION=$(git rev-parse HEAD)" \
  -f backend/Dockerfile.runtime \
  -t "rr-backend-smoke:$(git rev-parse HEAD)" .
```

The build uses only synthetic local configuration; the smoke process itself
generates its own JWT and cookie secrets inside the container. The image build
is a local artifact and is not a substitute for the Runtime Images CI scan.
Before treating the resulting image as an accepted recovery artifact, run the
repo's `scan-runtime-image.mjs` gate against its exact ID and revision, and
review the SBOM and vulnerability evidence. Keep the source scope receipt and
archive private; do not pass a live Railway URL or credential to this CLI.

The 2026-09-19 local acceptance ran this check against a fresh, source-bound
disposable PostgreSQL 16 restore. Backend image
`sha256:9591cb4ee6d0ececd940ed8f04333129409d549e11139937f6abc26a290cdcbd`
at revision `2c472a20d7183972e3df29bc373f991226647281` returned HTTP 200 from
both health routes with exact revision and `database`/`redis` checks `ok`.
The smoke containers were removed. This is a local worker-free startup result,
not a production provider or worker acceptance. The local Runtime Images
evidence gate passed with its reviewed Trivy 0.70.0 scanner and fresh database:
4 CRITICAL and 52 HIGH findings, none with a listed fix. A scan of the prior
`e7a37c2180f890e0562495a5897b3cef7decc5c2` image against the same
database revision had identical package and advisory sets and counts. The
policy in force for that historical check accepted zero fixed HIGH/CRITICAL
findings. The September 20 security correction superseded that policy: a
fresh final-image scan must report zero UNKNOWN, HIGH, and CRITICAL findings.
Local evidence does not replace the CI publication gate; rebuild and repeat
the check for the final integrated SHA.

The focused tests do not touch the private source bundle or target:

```sh
node --test scripts/backend-isolated-startup-smoke.test.mjs
RR_DOCKER_FIXTURE=1 node --test scripts/backend-isolated-startup-smoke.test.mjs
```

The Docker fixture uses a synthetic Unix echo socket and pinned local Redis
image. It verifies Backend UID 1000 and Redis UID 999 access, loopback relay,
shared network namespace, no published ports, and blocked external traffic.
The fake-backed tests cover exact revision, target preflight, health,
cancellation, network and user tampering, and owned-container cleanup.

A later restored-target smoke exited before either health route with the fixed
`filesystem_permission` diagnostic. The runner had forced UID 999 for the
Backend, while the exact Backend image owns its application tree as UID 1000.
The runner and exact-image inspection now require UID 1000 for the Backend and
network anchor; disposable Redis remains UID 999. A subsequent startup exit
exposed a second bootstrap boundary: its child environment dropped the image's
required `LD_LIBRARY_PATH=/usr/local/lib`, so Node could not load
`libatomic.so.1`. The fixed child environment preserves that exact path
without inheriting provider secrets.

On September 20, a new PostgreSQL 16.15 target was restored from a fresh
source-bound private snapshot (171 physical tables verified). The Backend
image `sha256:ff43bf8840eff19f485fe6f88197ce176bfbe96fd673a5640d77c76ca1b7b0af`
at revision `a5d3d613ab09d859c16023f5e4958c9b3fad0cb0` returned HTTP 200 from
both `/live` and `/ready`; database and Redis checks were `ok`, and the
worker-free, network-none smoke containers were removed. This verifies local
restored-database startup for the accepted staging SHA. It does not exercise
production providers, worker jobs, or client credentials.
