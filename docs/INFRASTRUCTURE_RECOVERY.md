# Infrastructure, data protection, and recovery

Last reviewed: 2026-09-06

This runbook defines the production approval packet and the recovery contract
for PostgreSQL, media, Redis, and Meilisearch. It does not authorize creating a
Railway production environment, changing credentials, enabling paid backup
features, removing public endpoints, or restoring data. Those are separate
reviewed operations.

## Current staging inventory

The read-only inventory, rechecked on 2026-09-02, found one Railway environment,
`staging`, with Backend, Storefront, PostgreSQL, Redis, MinIO, MinIO Console,
and Meilisearch. PostgreSQL and Redis have no HTTP service domain, but their TCP
proxy state still requires an explicit network review. MinIO, its Console, and
Meilisearch have Railway public domains. Current support-service sources are:

- PostgreSQL: `ghcr.io/railwayapp-templates/postgres-ssl:latest`;
- Redis: `railwayapp/redis`;
- MinIO: `minio/minio:latest`;
- MinIO Console: `railwayapp-templates/minio-console`; and
- Meilisearch: `getmeili/meilisearch:v1.11.3`.

The floating and unpinned sources are not an accepted production baseline.
Changing them is intentionally deferred until a backup and restore drill can
protect the upgrade.

Backend and Storefront still use GitHub source/Railpack builds. The repository
contains a locally and GitHub-validated contract for GHCR runtime candidates,
but no Railway service currently consumes one and staging publication remains
disabled by design; see `NEXT_SESSION_HANDOFF.md`.

## Application image source and rollback

An application image is production-eligible only when its SHA tag resolves to
the recorded OCI digest, its Trivy high/critical gate is clean, and GitHub
verifies both provenance and CycloneDX attestations for this repository. A
moving tag such as `latest`, `staging`, or `master` is not release evidence.

Railway Pro may pull a private registry image with a registry credential. If
GHCR packages remain private, use a dedicated read-only package credential
stored only in Railway; never use a broad personal token, print it, or place it
in GitHub/repository files. Making a package public is a separate visibility
decision and must not be performed as an implementation side effect.

Before changing a service from GitHub source to an image source:

1. record the current successful Railway deployment and source SHA as the
   rollback target;
2. verify the candidate digest and both GitHub attestations independently;
3. verify the image exposes the same port, non-root identity, health paths,
   environment contract, resource limits, and graceful-shutdown behavior;
4. change Backend pre-deploy to
   `node ./scripts/runtime-release-prepare.mjs` and retain its distinct
   migration/runtime database authorities;
5. deploy by immutable digest or unique SHA tag, then record Railway's exact
   deployment ID and resolved digest;
6. require both `/live` and dependency-aware `/ready`, representative catalog
   and checkout-safe reads, release-preparation logs, and bounded error-log
   review; and
7. prove rollback to the prior accepted source/image without a destructive
   database reversal.

Do not remove the Railpack source configuration, registry credential, or prior
rollback reference until that acceptance is complete. An image publication by
itself does not authorize a Railway source change.

## Production approval packet

Production remains absent. Before provisioning, record and approve all of the
following in one change request:

- the exact Railway project/environment IDs and one primary region;
- approved Storefront and Backend custom domains and their DNS owners;
- Backend, Storefront, PostgreSQL, Redis, object-storage, and Meilisearch
  service sources, immutable image evidence, volume sizes, and memory/CPU
  ceilings;
- monthly soft and hard workspace spend limits, alert recipients, and a cost
  estimate based on the most recent complete staging billing period plus
  backup storage and expected traffic;
- live/test credential boundaries and rotation owners;
- scheduled volume backup, PITR, logical backup, and off-site media retention;
- the public-exposure allowlist (normally only Storefront and Backend);
- the exact accepted `master` SHA, migration plan, rollback artifact, and
  restore evidence; and
- named launch operator, reviewer, incident owner, and go/no-go authority.

Use `railway usage projects --period previous --json` for the cost input and
set reviewed workspace soft/hard limits before workloads run. Do not copy raw
usage JSON, credentials, or connection strings into the repository.

Initial capacity is one instance per application while traffic is absent.
Replicas, PgBouncer, overlap, draining, or multi-region operation are added
only after measured connection, memory, CPU, and latency demand shows the
need. A second application replica without a database/queue capacity budget is
not availability work.

## Service objectives

These are launch objectives and incident thresholds, not provider guarantees:

| Surface | Availability/latency objective | RPO | RTO |
| --- | --- | --- | --- |
| Public Storefront reads | 99.9% monthly; p95 server response under 750 ms excluding third-party media | 24 hours for cache/search projections; PostgreSQL remains authoritative | 60 minutes |
| Cart, checkout, Admin writes | 99.9% monthly; p95 non-provider request under 1 second | 5 minutes for PostgreSQL; Stripe remains payment authority | 60 minutes |
| PostgreSQL | readiness success and no sustained pool saturation; slow-query budget below 1% of requests | 5 minutes with PITR plus daily portable dump | 60 minutes to a verified sibling/fork |
| Managed media | 99.9% successful object reads | 24 hours | 4 hours |
| Redis | p95 command under 100 ms; zero evictions/rejected connections | Redis data may lose up to 1 second with AOF; PostgreSQL/Stripe are durable truth | 15 minutes |
| Meilisearch | p95 search under 500 ms and exact published-product parity | zero source-data loss because PostgreSQL is authoritative | 60 minutes for rebuild and validation |

Measure these objectives from the external operations monitors and provider
metrics. Do not add replicas or paid monitoring until the baseline and alert
owner exist.

## PostgreSQL authority split

Production uses three distinct login roles and one non-login owner role:

- `app_owner`: owns application schemas/objects; `NOLOGIN`;
- `app_runtime`: DML and sequence use required by the running application,
  without schema creation, ownership, predefined read/write-all membership, or
  cluster privileges;
- `app_migrator`: member of `app_owner`, used only by release migration and
  link-sync steps; and
- `app_backup`: `pg_read_all_data` only, used only for portable backups.

Every login is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
with a bounded connection limit and a rotated secret from Railway. Inventory
every existing schema, relation, sequence, function, type, extension, and owner
before changing ownership. Transfer application objects individually to
`app_owner`; never run an unreviewed cluster-wide `REASSIGN OWNED`.

`DATABASE_URL` belongs to `app_runtime`. `DATABASE_MIGRATION_URL` belongs to
`app_migrator`. Release preparation uses the migration URL only for
`db:migrate` and `db:sync-links`, then returns to the runtime URL for storage
and search readiness. Roll out in this order:

1. take a verified PostgreSQL backup;
2. inventory schemas, owners, extensions, grants, and default privileges;
3. create the four roles and grant only the reviewed schema/table/sequence
   privileges;
4. set both Railway URLs without changing traffic;
5. run `DATABASE_ROLE_PROFILE=migration pnpm --filter backend run
   database:role:audit` through the migration URL and repeat with `runtime`;
6. deploy with `DATABASE_ROLE_SPLIT_REQUIRED=false` and complete release
   preparation plus application smoke tests;
7. set `DATABASE_ROLE_SPLIT_REQUIRED=true`, redeploy, and prove the release
   fails closed if the migration URL is removed or equals the runtime URL; and
8. only then revoke the old superuser URL from Backend.

The auditor never prints role/database names, connection strings, or raw
driver errors. Its single read-only catalog query checks the original session
login, any narrowed current role, roles reachable through `SET ROLE`, and
inherited privileges. It rejects cluster attributes, default-admin use,
dangerous predefined memberships, and role-membership administration rights.
Runtime/backup identities also fail on database or schema `CREATE` and object
ownership, including effective inherited/reachable ownership. A migration
identity may retain the owner/schema authority needed for DDL, but not cluster
or membership-administration rights.

The backup profile requires usable inherited `pg_read_all_data`, not merely
an inert membership; it rejects table/column/sequence/large-object write
privileges. The other profiles reject predefined read/write-all memberships.
Tests distinguish `INHERIT`, `SET`, and `ADMIN OPTION`, preserve legitimate
runtime DML and migrator ownership, and prove that an initially narrowed
`SET ROLE` cannot conceal a privileged login. Query and connection deadlines
remain 30 and 10 seconds. Public connections must prove negotiated TLS, and
connect/query/close failures cannot produce an accepted result.

These are bounded catalog capability checks, not a complete authorization
certification: separately review executable `SECURITY DEFINER` functions,
extensions, application-specific capabilities, default privileges, and future
grants. Role-audit tests create only transactionally rolled-back fixtures on
the explicitly guarded disposable local PostgreSQL service. Passing them does
not perform the staging role cutover or satisfy its operational evidence.

## PostgreSQL transport

Railway private service traffic uses environment-isolated WireGuard networking
and `*.railway.internal`. The Backend permits that transport or local loopback
without a public TLS query parameter. Every other PostgreSQL URL must use
`sslmode=require`, `verify-ca`, or `verify-full`; Railway TCP proxy URLs without
an explicit mode are upgraded to `require`. Prefer `verify-full` with an
approved CA whenever the provider supports hostname validation.

Application startup and database CLIs share this policy. Plaintext,
`sslmode=allow`, and `sslmode=prefer` external URLs fail before connecting.
After the private role cutover and a documented administrative access path,
remove the PostgreSQL and Redis public TCP proxies.

## PostgreSQL backup and restore

Production requires three independent layers:

1. Railway volume schedules: daily (six-day retention), weekly (one month),
   and monthly (three months).
2. Railway PITR: pgBackRest WAL archiving and rolling base backups, currently
   retaining roughly four weeks. Restore always creates a sibling service so
   the source remains untouched.
3. A daily portable custom-format logical backup using `app_backup`, encrypted
   in transit and written to a separate account/provider.

Create and verify a portable backup without putting credentials in process
arguments:

```bash
DATABASE_BACKUP_URL='<backup-role-url>' \
  pnpm run data:postgres:backup -- \
  --output-dir /absolute/private/backup/directory
```

The command uses `pg_dump --format=custom --no-owner --no-privileges`, verifies
the archive with `pg_restore --format=custom --list`, applies mode `0600`, and writes a bounded
manifest containing byte length, SHA-256, tool version, timestamp, and a
credential-free source fingerprint.

Both PostgreSQL commands accept `--help` without credentials and reject unknown,
duplicate, or incomplete arguments. One optional leading `--` forwarded by
`pnpm run` is normalized before parsing; repeated or interior separators still
fail. `DATABASE_RECOVERY_TIMEOUT_MS` bounds the
overall client/hash/copy workflow: default 30 minutes, minimum 100 milliseconds,
maximum four hours. The connect timeout remains 10 seconds; `pg_dump` also
limits initial lock waits to 10 seconds. SIGINT/SIGTERM cancel the active client
with SIGKILL, await process closure, and then remove owned temporary files.
Success output is withheld until temporary cleanup completes. Subprocess
stdout is capped at 20 MiB, stderr is discarded, and failures report only a
fixed phase and elapsed time. Raw driver/tool errors, SQL, credentials, and
connection strings must not be copied into logs.

Use trusted client executables on `PATH`. Child environments contain only the
reviewed runtime/libpq fields; ambient `PGOPTIONS`, connection overrides, and
unrelated application secrets are not inherited. Connection URLs accept only
one `sslmode` and one optional `sslrootcert`; unsupported or repeated options
fail rather than being silently ignored. IPv6 hosts are normalized for libpq.
Reserve sufficient local archive space before starting a dump; a deadline is
not a disk quota. A failure during the final two-file publication can leave an
orphan archive without its manifest; do not treat that as verified evidence.

A restore drill must target a new, empty, disposable database. First run the
read-only verification:

```bash
DATABASE_RESTORE_URL='<disposable-target-url>' \
  pnpm run data:postgres:restore-drill -- \
  --archive /absolute/path/postgres-....dump \
  --manifest /absolute/path/postgres-....manifest.json
```

The command verifies canonical regular files, a manifest no larger than 64 KiB,
byte length, SHA-256, a distinct endpoint fingerprint, and the target inventory.
It copies the archive into an exclusive private `0600` snapshot and uses only
that verified copy for both archive listing and restore. Replacing the original
path after verification cannot change the restored bytes. Dry-run therefore
writes local temporary files but performs no database mutation.

`DATABASE_RESTORE_MAX_ARCHIVE_BYTES` bounds the declared snapshot size: default
10 GiB and maximum 1 TiB. Reserve that space in the system temporary directory
(or an approved private `TMPDIR`). The snapshot is removed on success/failure.
The SHA-256 manifest establishes integrity, not authenticity or safety of SQL
inside an archive: PostgreSQL warns that restoring a dump executes code chosen
by source superusers. Use only a trusted source/archive and a dedicated target.
See the [PostgreSQL restore warning](https://www.postgresql.org/docs/18/app-pgrestore.html).

Preflight uses an explicit read-only transaction with `search_path=pg_catalog`,
not privilege-filtered `information_schema.tables` or user-schema function lookup.
It rejects user schemas, namespace-owned objects (including relations, routines,
types, operators, and collations), non-default extensions, large objects,
foreign servers/wrappers, event triggers, publications/subscriptions, custom
casts/languages, and default grants. Counts are strict nonnegative integers;
malformed output and inspection failures fail closed. The default `public`
schema and built-in `plpgsql` extension are allowed. These checks are a bounded
object inventory, not a complete security audit of database/role settings.

The endpoint fingerprint cannot discover private/public aliases for the same
database. Independently prove that the target is disposable and distinct from
the source, and exclude concurrent writers throughout the drill: preflight and
restore use separate connections and do not lock out other actors. The command
prints the target fingerprint required for the explicit apply:

```bash
DATABASE_RESTORE_URL='<disposable-target-url>' \
DATABASE_RESTORE_CONFIRM='<dry-run-target-fingerprint>' \
  pnpm run data:postgres:restore-drill -- \
  --archive /absolute/path/postgres-....dump \
  --manifest /absolute/path/postgres-....manifest.json \
  --apply
```

Record archive checksum, start/end time, restored application-table count,
Medusa migration status, representative read-only queries, and destruction of
the disposable target. A successful command without an application smoke test
does not satisfy the drill.

Apply keeps `--single-transaction --exit-on-error`, without `--clean` or
`--create`; see [PostgreSQL's transaction guarantee](https://www.postgresql.org/docs/18/app-pgrestore.html).
Cancellation, a lost response, or a failed post-restore inventory must not be
interpreted as proof of rollback: the restore may already have committed.
Inspect the isolated target before deciding whether to accept or discard it.
Never retry against a populated target or repurpose this command for in-place
production recovery.

Regression gates: `pnpm run qa:database-release-boundary` covers process,
input, snapshot, and CLI failures. `pnpm run qa:postgres-recovery:integration`
requires the explicitly guarded disposable local PostgreSQL fixture and is
included in `qa:disposable-integration:services`. It creates only its own
randomly named database, rolls back each object fixture, and drops that owned
database afterward. No real backup-provider setup or live restore is implied.

## Media backup and restore

MinIO's application bucket requires versioning and an off-site target in a
different provider/account or failure domain. Prefer bucket replication when
version history and delete markers must survive. `mc mirror` copies only the
latest object and is therefore acceptable only for an explicitly current-state
copy. Run a dry-run first and use `--checksum SHA256` for copied objects.

Configure credential-bearing `MC_HOST_<alias>` values only in the operator's
secret environment. Then dry-run a current-state copy:

```bash
MEDIA_BACKUP_SOURCE='source/catalog' \
MEDIA_BACKUP_TARGET='offsite/catalog' \
MEDIA_BACKUP_OUTPUT_DIR='/absolute/private/evidence' \
  pnpm run data:media:backup
```

The dry-run prints a direction-specific confirmation and the additional
content-verification read budget: two downloads per current source object,
totalling twice its bytes, excluding the mirror transfer itself. Review the
GET/request and egress costs before choosing an explicit planned-content byte
budget. Client metadata requests, retries, and buffered read-ahead add overhead;
this budget is not a hard provider-billing or wire-byte ceiling. Apply only
after review:

```bash
MEDIA_BACKUP_SOURCE='source/catalog' \
MEDIA_BACKUP_TARGET='offsite/catalog' \
MEDIA_BACKUP_OUTPUT_DIR='/absolute/private/evidence' \
MEDIA_BACKUP_CONFIRM='<dry-run-confirmation>' \
MEDIA_BACKUP_VERIFY_MAX_BYTES='<reviewed-total-verification-download-bytes>' \
  pnpm run data:media:backup -- --apply
```

The command rejects old clients, overlapping literal source/target paths,
unsafe object paths, and insufficient verification budgets before the mutating
mirror. Operators must still ensure different aliases do not resolve to the
same underlying location. It never uses `--remove` and preserves target-only
objects. [`mc mirror --checksum SHA256`](https://docs.min.io/aistor/reference/cli/mc-mirror/#--checksum)
adds an upload checksum; it does not independently prove retained target
content. After matching keys and sizes, the helper streams each source and
target through [`mc cat`](https://docs.min.io/aistor/reference/cli/mc-cat/),
computes SHA-256, and rejects same-size corruption, truncated or oversized
reads, and unsuccessful reader exits. ETags are not treated as content hashes.

Verification is sequential with bounded streaming memory, an explicit planned
content-download budget, at most 10,000 source objects by default, and a
ten-minute overall content-read deadline. `MEDIA_BACKUP_VERIFY_MAX_OBJECTS`
may be reviewed up to 100,000 and `MEDIA_BACKUP_VERIFY_TIMEOUT_MS` up to one
hour. Individual listing/mirror commands have a ten-minute deadline and bounded output.
Cancellation kills active content readers and waits for process closure;
provider stderr and raw object names are not emitted. A failed or cancelled
verification writes no successful manifest and does not roll back an already
performed mirror. Investigate the partial copy before rerunning.

The private `0600` schema-version-2 manifest includes client version, endpoint
fingerprints, canonical key/size inventory hashes, a combined key/size/content
hash, verified object/read-byte counts, and total/verification durations. A
version-1 manifest only established key/size inventory parity and is not
content-verified evidence. No object bytes are retained locally. Use the same
boundary from off-site storage to a disposable restore bucket for the weekly
drill. Keep the source quiescent for a consistent current-state copy: sequential
reads do not establish an atomic multi-object snapshot or prevent subsequent
changes. The helper's local tests use synthetic streams and disposable fake
client processes; they do not complete an off-site operational drill.
Version ID history still requires bucket replication and separate provider
evidence; the mirror manifest intentionally does not claim to protect it.

Weekly, restore a deterministic sample plus the newest object to a disposable
bucket and verify bytes and checksums. Quarterly, perform a full manifest
comparison and record duration.

Do not enable physical Catalog-media purge until a full off-site restore drill
passes. Keep the MinIO API public only if immutable Storefront object delivery
requires it. Remove the public Console domain or place it behind reviewed SSO;
credentials alone are not an acceptable public-console boundary.

## Redis recovery and memory

Redis contains rate limits, caches, BullMQ/workflow state, locks, event-bus
state, and bounded checkout-reconciliation snapshots. PostgreSQL and Stripe
remain the durable business/payment authorities. During Redis loss, reads use
only their documented bounded fallbacks; writes fail closed rather than risk a
duplicate payment, order, or mutation.

Production policy is `maxmemory` at no more than 70% of the service memory
limit, leaving headroom for allocator overhead, fork/copy-on-write, clients,
and AOF buffers. Keep `maxmemory-policy noeviction`: silently evicting locks,
queues, rate limits, or idempotency state is less safe than a visible write
failure. Use AOF with `appendfsync everysec` plus reviewed RDB snapshots and a
persistent volume. Test current memory, fragmentation, fork peak, AOF rewrite,
restart load time, key count, evictions, and rejected connections before
setting the ceiling.

Recovery order is Redis process/volume, readiness, persistence status, queue
health, stalled-job reconciliation, then write traffic. Never reconstruct
orders or payments from Redis. AOF every-second durability permits about one
second of infrastructure-state loss; application reconciliation must close
that window from PostgreSQL and Stripe.

### Read-only capacity and persistence audit

Use `pnpm run data:redis:audit -- --help` for the observation contract. Supply
the reviewed endpoint and independently verified Railway service/container
memory ceiling through the operator's secret environment:

```bash
REDIS_AUDIT_URL='<reviewed-redis-url>' \
REDIS_SERVICE_MEMORY_LIMIT_BYTES='<approved-service-limit-in-bytes>' \
  pnpm run data:redis:audit
```

This command never applies settings, scans keys, reads values, resets counters,
or requests broader ACL grants. It uses the existing pinned Redis client,
RESP2, no reconnect/offline queue, and an explicit five-second total deadline
(`REDIS_AUDIT_TIMEOUT_MS`: 100–30,000 ms). Cancellation closes both an in-flight
TCP/TLS handshake and an established socket. External endpoints require
`rediss://` with certificate verification; plaintext is restricted to literal
loopback or Railway private hostnames. Only database zero is accepted because
the observation is server-wide. URL options/fragments and command arguments
other than `--help` are rejected after normalizing one optional leading
package-manager separator. Both `pnpm run data:redis:audit --help` and the
documented `pnpm run data:redis:audit -- --help` form are exercised through the
real package manager without credentials.

For Redis 7+, the exact [CONFIG GET](https://redis.io/docs/latest/commands/config-get/)
allowlist is `maxmemory`, `maxmemory-policy`, `appendonly`, `appendfsync`,
`save`, and `no-appendfsync-on-rewrite`. Permission denial fails closed; do not
substitute `CONFIG GET *`, which could expose secrets. The six
[INFO](https://redis.io/docs/latest/commands/info/) sections are `server`,
`memory`, `persistence`, `stats`, `replication`, and `keyspace`. Returned
configuration must agree with INFO's overlapping values. Missing, duplicate,
malformed, oversized, or unsafe numeric fields cannot produce healthy output.
Accepted INFO sections are capped at 64 KiB/1,024 lines; these are post-parse
validation limits, not a hard wire-buffer limit in the Redis client. Connect
only to the reviewed service.

`REDIS_SERVICE_MEMORY_LIMIT_BYTES` must be an explicit decimal byte count
between 16 MiB and 16 TiB. INFO's `total_system_memory` is deliberately ignored:
host RAM is not evidence of the service allocation. The exact 70% maxmemory
ceiling is checked without floating-point rounding. Counted memory subtracts
Redis's [buffers excluded from eviction accounting](https://redis.io/docs/latest/develop/reference/eviction/)
from `used_memory`; observed RSS at or above 90% of the declared service limit
is an additional repository headroom warning, not a guarantee below that
threshold. Fragmentation, fork duration and prior copy-on-write sizes remain
observations for capacity review, not a replacement for a load test.

The audit degrades unbounded/over-budget memory, reached maxmemory, unsafe
eviction, non-standalone/non-primary targets, loading, persistence failures,
disabled AOF or RDB schedules, and a mismatch from the reviewed `everysec`
policy. `no-appendfsync-on-rewrite=yes` is also rejected: it can relax
[AOF synchronization](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
during a rewrite. Background saves/rewrites, delayed-fsync counters and the
last-save timestamp are reported without inventing a backup-freshness or RPO
guarantee. AOF-only fields are absent from Redis when disabled and are reported
as `null`, not fabricated success.

Exit 0 means this bounded policy observation is healthy; exit 2 returns fixed
degradation reasons; exit 1 emits only a fixed unavailable event. Output has
numeric/enum metrics, duration and a credential-free endpoint fingerprint, not
credentials, raw server errors, paths, hostnames, database names or key names.
Eviction/rejected-connection counters are historical since server start/reset;
they neither prove a sustained zero-error SLO nor count all OOM write errors.
Do not reset them to obtain a passing audit.

Healthy output does not prove a persistent volume, restart recovery,
queue/stalled-job reconciliation, backup retention, p95 latency, production
capacity or launch approval. The existing capacity/persistence rollout item
remains open until the controlled change and timed operational drill pass.

`pnpm run qa:redis-capacity` exercises parsing, policy, actual client protocol,
redaction, deadlines and socket cleanup with enforced 80% helper coverage.
`qa:redis-capacity:integration` is part of the existing disposable Backend
integration gate; it accepts only the explicit loopback fixture and uses an
independent command allowlist. It verifies that the persistence-disabled
test service is degraded without changing its configuration or reading keys.

## Meilisearch recovery

PostgreSQL Products are authoritative. A version-matched Meilisearch snapshot
is the fastest same-version recovery, while a dump is the portable upgrade
artifact. Schedule daily snapshots off the Meilisearch volume and create a dump
before every version change, retaining both off-server.

If the index is unavailable or untrusted, restore a matching snapshot or run:

```bash
pnpm --filter backend run search:rebuild
pnpm --filter backend run search:check
```

The rebuild creates and validates a versioned candidate, atomically swaps it
to `products`, and retains the prior index for rollback. Acceptance requires
published Product count/ID parity, stock invariants, representative query,
facet, and sort checks. Snapshot restore without those checks is incomplete.

## Current staging acceptance evidence

The recovery-tooling release at exact source SHA
`f0e512fc372c18a221785a0db16415c8d08b8e21` completed its 2026-08-30
staging acceptance without querying or changing production:

- Root CI run `33331236327`, Backend CI run `33331236333`, and Storefront CI
  run `33331236393` all completed successfully on the exact SHA.
- Railway Backend deployment `d6e5b281-e3dd-4c74-bcd8-64e5502ce53c` and
  Storefront deployment `320bc6e0-ad1f-4a12-b6c2-6224e03f8f0f` both reached
  `SUCCESS` on that SHA.
- Backend release logs recorded completed database migrations, database-link
  synchronization, object-storage readiness, and search preparation in that
  order. No preparation step was skipped or left incomplete.
- Backend `/live`, `/ready`, and `/api/health` returned HTTP 200 with the exact
  SHA. Readiness reported PostgreSQL, Redis, search, object storage, payment,
  tax, notification, payment lifecycle, search, storage, and Admin RBAC
  capabilities healthy.
- Storefront `/live`, `/ready`, `/api/healthcheck`, `/`, and `/catalog` returned
  HTTP 200 with the exact SHA on health responses. Storefront readiness
  reported Backend and Redis healthy.
- Railway's exact-deployment HTTP records independently captured Backend
  `/ready` at 96 ms and Storefront `/ready` at 255 ms with HTTP 200 and no
  upstream error.

This proves the portable tooling and authority-boundary release is deployable;
it does not close the still-controlled role cutover, backup scheduling, off-site
media destination, timed restore drills, support-service image pinning, or
production approval items below.

## Required evidence before launch

- approved production topology/domains/cost ceiling;
- private-only support networking and no public Console;
- role audit for runtime, migration, and backup identities;
- actual TLS proof for every remaining non-private database connection;
- volume-backup schedule and PITR archiver status;
- timed PITR sibling restore plus portable logical restore;
- off-site media checksum and restore manifests;
- Redis memory/persistence/restart drill;
- Meilisearch snapshot/dump and full rebuild drill;
- image version/digest inventory and upgrade rollback evidence; and
- updated exact-SHA CI, deployment, readiness, metrics, and incident contacts.

## Research basis

- [Railway PostgreSQL backup and restore guide](https://docs.railway.com/guides/postgres-backups-restores)
- [Railway point-in-time recovery](https://docs.railway.com/volumes/point-in-time-recovery)
- [Railway private networking](https://docs.railway.com/networking/private-networking)
- [Railway volume reference](https://docs.railway.com/volumes/reference)
- [PostgreSQL role attributes](https://www.postgresql.org/docs/current/role-attributes.html)
- [PostgreSQL libpq TLS modes](https://www.postgresql.org/docs/current/libpq-ssl.html)
- [PostgreSQL `pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html)
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- [Meilisearch backup methods](https://www.meilisearch.com/docs/resources/self_hosting/data_backup/overview)
- [MinIO `mc mirror`](https://min.io/docs/minio/linux/reference/minio-mc/mc-mirror.html)
