# Infrastructure, data protection, and recovery

Last reviewed: 2026-08-30

This runbook defines the production approval packet and the recovery contract
for PostgreSQL, media, Redis, and Meilisearch. It does not authorize creating a
Railway production environment, changing credentials, enabling paid backup
features, removing public endpoints, or restoring data. Those are separate
reviewed operations.

## Current staging inventory

The read-only inventory on 2026-08-30 found one Railway environment,
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

The auditor never prints a role name or connection string. It verifies the
absence of cluster-wide attributes and default-admin use, rejects
`pg_read_all_data`/`pg_write_all_data` outside the reviewed backup profile, and
proves negotiated TLS for a public connection.

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
the archive with `pg_restore --list`, applies mode `0600`, and writes a bounded
manifest containing byte length, SHA-256, tool version, timestamp, and a
credential-free source fingerprint.

A restore drill must target a new, empty, disposable database. First run the
read-only verification:

```bash
DATABASE_RESTORE_URL='<disposable-target-url>' \
  pnpm run data:postgres:restore-drill -- \
  --archive /absolute/path/postgres-....dump \
  --manifest /absolute/path/postgres-....manifest.json
```

The command verifies canonical regular files, manifest bounds, byte length,
SHA-256, a distinct target fingerprint, and an empty target. It prints the
target fingerprint required for the explicit apply:

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

The dry-run prints a direction-specific confirmation. Apply only after review:

```bash
MEDIA_BACKUP_SOURCE='source/catalog' \
MEDIA_BACKUP_TARGET='offsite/catalog' \
MEDIA_BACKUP_OUTPUT_DIR='/absolute/private/evidence' \
MEDIA_BACKUP_CONFIRM='<dry-run-confirmation>' \
  pnpm run data:media:backup -- --apply
```

The command rejects MinIO Client releases older than the checksum feature,
never uses `--remove`, adds SHA-256 checksums to copied objects, and requires
every current source key and byte size to match the target. It preserves and
counts target-only objects instead of deleting safe history. Its private
`0600` evidence manifest contains the exact client release, credential-free
endpoint IDs, source and target inventory SHA-256 values, object counts, byte
total, and duration. Use the same boundary from the off-site bucket to a
disposable restore bucket for the weekly restore drill.
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
