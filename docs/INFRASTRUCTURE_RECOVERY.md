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
and Meilisearch. PostgreSQL and Redis have no HTTP service domain. A subsequent
September 6 check confirmed an active Redis public TCP proxy; its separately
approved removal completed at `2026-09-07T01:23Z` with both apps healthy over
private networking. See the Redis security follow-up below. PostgreSQL proxy
state still requires an explicit
network review. MinIO, its Console, and
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

September 6 staging observation at accepted revision
`6f61520fbd3677b15aeecb1052a86b8dffff0e9d`: the existing audit ran over
Railway private networking from Storefront deployment
`edbdef4d-832c-472b-9a82-b71d9b82e4ed`, instance
`bcfee748-4c5c-45f4-accf-2491b3666238`. Railway's Redis
`serviceInstanceLimits.containers.memoryBytes` reported **32,000,000,000
bytes**, including plan defaults. This is an independently verified ceiling,
not evidence that reserving 70% of it is appropriate or cost-approved.
The endpoint fingerprint matched Redis service metadata:
`9702205e1609f960448554037c844c03b3bb22c347aea0a37331dec3f571bc41`.

The 133 ms audit returned exit 2 for exactly `maxmemory_unbounded` and
`rdb_schedule_disabled`. `maxmemory` was zero; used memory was 7,788,776 bytes
and RSS 18,878,464 bytes. AOF was enabled with `everysec`, rewrite fsync
suppression disabled, and last write/rewrite status `ok`. Historical delayed
fsync was 942; eviction and rejected-connection counts were zero. These
counters do not establish a rate, freshness guarantee, recovery result or SLO.
The complete private SSH observation took 2,922 ms.

No settings, keys, ACLs or files were changed or uploaded. Backend's existing
Redis URL contains a query string and was rejected before connecting; it was
not normalized to bypass policy. Storefront's existing query-free private
reference supplied the safe alternative, with credentials retained in-process.
Before remediation, inspect the current volume, backup schedule and immutable
image, size the ceiling using a reviewed load/fork budget, and approve exact
configuration and rollback changes. This observation does not close the live
capacity/persistence rollout or timed recovery requirement.

Follow-up read-only metadata inspection found Redis 8.0.3 running from
deployment `f75e3583-3d71-4787-9ada-12852e976fa0` (created July 15, 2025).
That deployment records `bitnami/redis`, while the configured service source
is `railwayapp/redis`; no immutable image digest/tag was retained in the
inspected metadata. A generic redeploy could therefore cross an unverified
image/source boundary. Do not use redeploy as a harmless prerequisite.

Volume `1b69088f-0a38-4ecb-bddf-d43715b97d52`, staging volume instance
`1f83ec52-ded6-4c3b-a0cc-8622c3bdf5b6`, was READY at `/bitnami`, provisioned
at 50,000 MB with 1,071.566848 MB used and no pending deletion. Both backup
schedules and recorded backups were empty. Redis's configured persistence
directory is under `/bitnami` and its append directory is relative; this
configuration check does not prove filesystem realpath/symlink containment.
That read-only inspection did not create a backup. The separately discussed
one-time backup was subsequently created after the user instructed the agent
to continue following the specific staging-backup/cost approval question.
That direction was applied only to the named backup, not to a restart, restore,
image migration, schedule or Redis configuration edit.

### Staging Redis recovery checkpoint

The single `volumeInstanceBackupCreate` operation targeted the exact volume
instance above with name `pre-hardening-20260906`. Fresh preflight metadata
confirmed the Redis/staging association, READY state, `/bitnami` mount,
unchanged volume identity, no pending deletion, no existing backups and no
schedules. The 1,071.566848 MB used was below the documented 50%-of-capacity
manual-backup limit. Both applications' readiness checks passed before the
operation on accepted application revision `4ba7996`.

The create command exited successfully. Fresh metadata records exactly one
named backup:

- Backup ID: `129379c6-8a3c-42bf-9695-5e0ef5840e3d`.
- Created: `2026-09-07T00:37:22.198Z` (September 6 in the operator timezone).
- Name: `pre-hardening-20260906`.
- Referenced size: 1,072 MB; source volume capacity: 50,000 MB.
- Initially reported exclusive usage: 0 MB. This is not a promise of zero
  charges; snapshot accounting can lag and exclusive blocks change over time.
- `expiresAt: null`, `scheduleId: null`; no expiry is currently reported and
  no schedule was added. No lock/expiration mutation was issued.

The terminal-output handler did not retain the returned workflow identifier;
therefore a `workflowStatus: Complete` response is not claimed. No create
retry was issued. Verification instead used the fresh exact-volume backup
record plus an empty `environmentPendingWork` result. Redis remained on
successful deployment `f75e3583-3d71-4787-9ada-12852e976fa0`, and both
applications remained ready. The subsequent ordinary Backend heartbeat at
`2026-09-07T00:38:00.082Z` completed on `4ba7996`; scheduler, operations,
catalog and dependencies were healthy with no incident at `00:39:03Z`.
These are bounded observations, not a continuous no-downtime guarantee.

[Railway volume backups](https://docs.railway.com/volumes/backups) are
incremental copy-on-write snapshots. Current
[resource pricing](https://docs.railway.com/pricing/plans#resource-usage-pricing)
is $0.15/GB/month, making $7.50/month a conservative 50 GB storage envelope,
not a measured snapshot bill or provider spending cap. Published retention does
not specify a default manual expiry. Keep this checkpoint until a separate
retention/cleanup decision; do not silently lock it, schedule more backups,
delete it, or wipe the parent volume. It is not an off-site backup and does
not survive wiping the parent volume: that deletes all its backups.

Backup existence does not prove Redis application consistency, AOF replay,
restorability, RPO/RTO, or image compatibility. Railway's documentation does
not establish Redis-specific quiescing, and this operation did not issue
`SAVE`, `CONFIG SET`, AOF rewrite controls, file copies or data reads.
The configured/running-image mismatch above remains unresolved. A reviewed
compatible immutable image and controlled restore drill are still required
before changing memory, persistence or service source. Restoration is a
separate operation that stages replacement storage and redeploys the service;
it was not attempted on the active instance.
Read-only API introspection identifies `volumeInstanceBackupRestore` by its
source volume-instance and backup IDs; it has no documented independent
destination-service argument. Its optional `wipeServiceIds` must not be used
for this drill. Neither this interface nor the inspected `VolumeCreateInput`
establishes a safe detached clone of the named snapshot. Confirm a supported
isolated restore route before invoking a restore mutation; do not substitute
a new volume ID experimentally or use PostgreSQL PITR semantics for Redis.

### Redis security and image compatibility follow-up

The reported live Redis 8.0.3 version predates the upstream 8.0.4 fix for
critical [CVE-2025-49844](https://github.com/redis/redis/security/advisories/GHSA-4789-qfc9-5f9q).
The advisory describes potential remote code execution by an authenticated
user through crafted Lua. No vendor-backport or running-binary evidence has
been established, so treat this as an unresolved affected-version risk, not
as a claim that exploitation or compromise occurred. The first patched 8.0
release is not by itself a currently approved upgrade target.

Read-only Railway metadata also confirmed one Redis public TCP proxy:
`4640854a-a8c8-4053-85f1-52b1df1882f2`, application port 6379, sync status
`ACTIVE`. No public connection, authentication attempt or exploit test was
made; the endpoint is intentionally omitted. Before removal, verify private
application connectivity and the administrative access path, and obtain the
separate network-change approval. Do not assume that external clients are
unused merely because Storefront has a private reference.

At `2026-09-07T01:02:20Z`, bounded read-only SSH checks examined only each
application process's selected `REDIS_URL` metadata on verified `4ba7996`
deployments. Both reported a Railway-private hostname, port 6379, database
zero, a password and no fragment. Backend still has a query string;
Storefront does not. No URL, hostname, credential or query value was emitted,
and no Redis connection or normalization was performed. This confirms the
two applications' configured private paths, not that every external operator
or client has migrated. The user approved removal with the external-client
impact identified. At `2026-09-07T01:23:41Z`, after a fresh exact-ID/ACTIVE
preflight and healthy readiness checks, the single approved command ran:

```bash
node_modules/.bin/railway tcp-proxy delete \
  4640854a-a8c8-4053-85f1-52b1df1882f2 \
  --service Redis --environment staging --yes
```

The command exited zero; an independent fresh listing contained zero Redis
TCP proxies. Both apps then returned ready/200 with all checks healthy on
`4ba7996`; Redis took 12 ms in Backend and 2 ms in Storefront. The ordinary
`01:24:00.054Z` reconciliation heartbeat completed on that exact SHA, and the
01:24 operations/catalog, Storefront HTML/security-header/AVIF and deliberate
400 guard probes passed. This removed only the public TCP exposure, not the
Redis service, storage, credentials, source, ACLs or persistence settings.
The subsequent exact-volume check still reported `READY`, no pending deletion,
the same single backup and no backup schedules.
External clients can no longer use the removed endpoint. Recreating a proxy
would be a separately reviewed change and may assign a different endpoint.
The reported Redis 8.0.3 security risk remains unresolved.

The advisory's Lua-denial workaround is not compatible with the current app
without a functional outage:

- Backend and Storefront rate-limit helpers use `EVAL`; strict mutation
  policies fail closed when Redis cannot execute it.
- Storefront cart idempotency uses Lua for claim, completion and release;
  Redis failures return `cart_idempotency_unavailable` with HTTP 503.
- Medusa's default Redis locking provider uses Lua for acquire/release, and
  the Redis event bus and workflow engine use BullMQ's Lua-backed commands.
  Checkout, reconciliation, scheduled work and retries depend on these paths.
- Installed ioredis uses both `EVAL` and `EVALSHA`, including script reload
  after `NOSCRIPT`; preloading does not remove the dependency.

Application readiness checks only Redis `PING`, so ready/200 would not prove
that an ACL change preserved these capabilities. No ACL or command policy was
changed. The capacity/persistence auditor is likewise not a vulnerability
scanner or image-security certification.

Public registry research identified this immutable historical candidate for
isolated compatibility testing, not a production or rollback-approved image:

```text
docker.io/bitnamilegacy/redis:8.0.3-debian-12-r1@sha256:189aae381e7f2de2fbf90847cc753f7f75077cd119e1af688a0c9e0e86ffd096
linux/amd64: sha256:25b2ea01cc2d5dae05982a98468e39201a615e1351265c7a00b31677ac4badd2
linux/arm64: sha256:0fc8d5c56abffea9223f886115b41fa7d7ca33d328a0acf699f1fe790b8cc80e
```

At `2026-09-07T00:42:53.637Z`, anonymous registry index/platform manifests
returned HTTP 200 with matching calculated digests; config/layer HEAD checks
matched digest and byte-count metadata. Independent Docker Hub metadata
agreed. Historical official source at commit
`7cae83c281089791e24905d6a05e7d66e91c24ac` (July 6, 2025) declares Redis
8.0.3, UID 1001 and `/bitnami/redis/data`, predating the live July 15 deployment.
This supports a layout hypothesis, not identity with the running artifact,
signature verification, current filesystem permissions or a successful restore.
The later `r3` candidate postdates that deployment.

[Bitnami Legacy](https://github.com/bitnami/containers/issues/83267) receives
no updates or support and is only a temporary migration fallback. This old
image also predates the Redis security fix; do not redeploy it as remediation.
A controlled migration still requires a maintained, digest-pinned target with
reviewed licensing and vulnerability evidence, actual backup restoration on
isolated storage, mount/UID compatibility, queue/lock/idempotency acceptance,
and a rollback path that preserves the untouched source data. Never downgrade
data files already rewritten by the newer Redis process.
Isolate replay side effects as well as storage: restored queue/workflow
consumers must remain stopped until live PostgreSQL/provider credentials and
provider egress are excluded. Use fixture or sandbox consumers for the drill;
restored delayed/repeatable jobs must not reach live systems.

The existing local/CI target fixture is also not an accepted staging image:
`redis:8.10.1-alpine3.23@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576`.
An offline, Docker-only Trivy 0.74.0 scan with the cached database updated at
`2026-09-06T19:02:10Z` reported 26 finding rows: eight HIGH, six MEDIUM,
12 LOW and zero CRITICAL/UNKNOWN, across 16 unique advisories. No ignore file,
VEX suppression, database refresh or image pull was used. The report matched
the exact fixture digest and detected 22 Alpine 3.23.5 OS packages only; it
does not certify the compiled Redis server or bundled modules.

All eight HIGH rows have fixes available:

- `libcrypto3` and `libssl3`: CVE-2026-14456, installed 3.5.7-r0,
  fixed 3.5.8-r0 (two rows).
- `setpriv`: CVE-2026-53612, CVE-2026-53613, CVE-2026-53614,
  CVE-2026-76642, CVE-2026-78408 and CVE-2026-78410, installed
  2.41.4-r0, fixed 2.41.6-r0 except CVE-2026-78408 at 2.41.6-r1.

Private evidence is
`/tmp/remorseless-redis-image-audit.LBdUPn/redis-8.10.1-amd64.vuln.json`.
The public tag still resolved to that same immutable index during this review;
the existing app integration pass does not override the security findings.
The repository's CI scanner pin remains 0.70.0; no scanner or fixture-image
policy was changed by this local assessment.

The same bounded scanner/database assessment ruled out a simple distro swap
and identified a separate PostgreSQL fixture risk:

| Inspected fixture/candidate | CRITICAL | HIGH | MEDIUM | LOW | UNKNOWN |
| --- | ---: | ---: | ---: | ---: | ---: |
| Redis 8.10.1 Alpine above | 0 | 8 | 6 | 12 | 0 |
| Redis 8.10.1 Trixie | 3 | 52 | 62 | 68 | 6 |
| PostgreSQL 18.6 Alpine 3.24 | 1 | 30 | 28 | 14 | 11 |

Trixie candidate index
`sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5`
has 97 unique advisories across 191 rows and 78 detected Debian OS packages.
Two HIGH OpenSSL rows have fixes; the other 53 HIGH/CRITICAL rows do not list
a fix. Its exact-digest report is
`/tmp/remorseless-redis-image-audit.LBdUPn/redis-8.10.1-trixie-amd64.vuln.json`.
The official Alpine tag still uses the original digest and no 8.10.1 Alpine
3.24 variant was available. No repository fixture pin was changed.

The existing PostgreSQL fixture index
`sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2`
has 74 unique advisories across 84 rows, covering 53 Alpine OS packages and
four Go dependencies detected in `/usr/local/bin/gosu`. All 31 HIGH/CRITICAL
rows list fixes. The critical Go stdlib finding is CVE-2025-68121 against
v1.24.6; OS HIGH fixes include OpenSSL 3.5.8-r0 and libuuid 2.42.3-r0/r1.
Private report:
`/tmp/remorseless-postgres-fixture-audit.RtiIRL/postgres-18.6-amd64.vuln.json`.
These are fixture-image findings, not evidence about the different live
Railway PostgreSQL image or the accepted Backend/Storefront runtime images.
Package detection does not establish exploitable reachability, and successful
report generation is not vulnerability acceptance. No exceptions were added.

### Local synthetic Redis persistence compatibility

An isolated Linux/amd64 experiment passed from the exact historical 8.0.3
image above to the existing 8.10.1 Alpine fixture. Eleven synthetic keys
covered strings, hashes, lists, sets, sorted sets and streams, with additional
HyperLogLog/bitmap checks. Logical values/types and three absolute expiration
timestamps matched after replay. A same-connection `WAITAOF` acknowledged a
post-rewrite marker before source SIGKILL, distinguishing AOF recovery from
the older RDB snapshot. Four persistence files were copied byte-for-byte
from a read-only source mount into a separate owned target volume.

The target loaded the expected data and executed benign Lua. A target-only
durable write left the source persistence hashes unchanged. Reopening that
untouched source on 8.0.3 recovered the original baseline without the target
write; no target-written data was downgraded. The unchanged repository
capacity/persistence policy reported healthy on source, target and reopened
source, with the synthetic 16 MiB maxmemory/256 MiB container budget.

Total successful test time was 9,438.02 ms; initial source, target and source
reopen readiness took 178.62, 217.09 and 204.97 ms. These small-fixture timings
are not staging RTO estimates. The harness verified UID/GID 1001,
`/bitnami/redis/data`, network-none/exec-only access, read-only container roots,
explicit CPU/memory/PID limits and owned-volume mounts. Eight owned test
containers and two synthetic volumes were removed after exact ID/label checks;
independent final checks found no labeled resources remaining. Three preceding
harness failures (capability normalization and INFO output handling) and their
successful cleanup are retained, not represented as Redis compatibility faults.

Private script and evidence are
`/tmp/remorseless-redis-compat-20260906.GRUPXr/compatibility-proof.mjs` and
`/tmp/remorseless-redis-compat-20260906.GRUPXr/evidence.json` (0700 directory,
0600 evidence). This used direct server binaries, bypassing image entrypoints,
and AOF plus RDB rather than the live AOF-only setup. The policy helper ran
through `docker exec`, not the network audit CLI. No real backup, queue,
application/provider data, image-default compatibility or live restore was
tested. The source/target security findings remain unresolved.

### Local minimal-package Redis candidate

A separate local-only build demonstrated a narrow package remediation without
replacing the Redis distribution or binary. Starting from the exact 8.10.1
Alpine index above, it installed only `libcrypto3=3.5.8-r0`,
`libssl3=3.5.8-r0` and `setpriv=2.41.6-r1`. Exact versions were confirmed in
official Alpine 3.23/main metadata. APK used that official HTTPS repository
and the base image's trusted signing keys, with no certificate/signature
bypass. No package was added or removed; the other 19 versions were unchanged.

The retained local Docker image ID is
`sha256:7451f4003e18e5d5146e99e06b14a8520cc7bfb8d213078b6547b7e98c907288`
(`remorseless-redis-minimal-proof:qubhv1`, Linux/amd64). This is not a published
registry reference. Seven base layers plus one patch layer were verified.
The entrypoint, server, CLI and four module binary hashes were unchanged,
as were ten runtime configuration fields. The image still defines the Redis
account as UID 999/GID 1000 and uses `/data`; this does not adopt the live
Bitnami layout automatically.

Using the same cached database, Docker-only Trivy 0.74.0 reported zero finding
rows in every severity across the same 22 detected OS packages, compared with
26 rows before the patch. CycloneDX 1.7 contains 23 components (22 libraries
and the OS). Compiled Redis/module dependency coverage is still absent;
neither the scan nor SBOM is a complete server security certification. No
ignore, VEX suppression, scanner/database update or repository policy change
was used. The successful build took 2,647 ms. Its earlier attempt rejected an
APK boolean-option spelling before package retrieval; both logs are retained.

Recipe, full package inventory, binary/configuration comparison, scan, SBOM
and build logs are private under
`/tmp/remorseless-redis-minimal-proof.QUBHV1` (0700; reports 0600).
The recipe is `context/Dockerfile`; comparison is `candidate-preservation.json`.
`candidate.vuln.json` SHA-256 is
`cbe33a1e483d98ee0f41b0639b6991572202ff85c210f73b6dca32ae9beb3a6f`;
`candidate.cdx.json` SHA-256 is
`2c47d2fe49f4f5b3b3d32de24e5507229021aca005db37885ddef53ea91c85bf`.

The complete synthetic persistence experiment was then repeated against that
exact local image ID, with its proof label and base-layer ancestry asserted.
All 11 keys, three expiration timestamps, durable AOF marker, benign Lua,
policy audits and untouched-source reopen checks passed in 9,606.12 ms;
target readiness took 202.50 ms. Eight owned containers and two volumes were
removed; independent final checks found no leftovers. New script/evidence:
`/tmp/remorseless-redis-patched-compat-20260906.4DvK54` (0700/0600).
Prior evidence was preserved. The direct-binary, UID 1001 override,
synthetic-data and AOF+RDB limitations above still apply: neither image-default
startup nor an actual Railway backup/queue restore was accepted.

During the image experiment no image was published, repository fixture changed,
or live Redis source, configuration, ACL or public endpoint altered. The local image remains for
review. The live 8.0.3 security issue and PostgreSQL fixture findings remain
open. Final staging readiness during this follow-up returned HTTP 200
with all checks healthy on `4ba7996` for both applications; Redis checks took
10 ms in Backend and 2 ms in Storefront. The later approved proxy removal and
its independent health checks are recorded above. Image publication, a
supported isolated real-backup restore path and controlled
live migration remain separate decisions.

### Hardened disposable fixture implementation

The subsequent grouped implementation adopts minimal hardened test recipes in
`docker/integration` and makes Backend CI build, scan and run those same local
image IDs. This is test infrastructure only, not a live support-image rollout.
`DISPOSABLE_INTEGRATION.md` defines the executable commands, ownership checks,
private evidence, provider isolation and failure handling.

Redis retains its pinned 8.10.1 server/CLI/modules/entrypoint, with exact signed
Alpine `libcrypto3`/`libssl3` 3.5.8-r0 and `setpriv` 2.41.6-r1 corrections.
PostgreSQL retains its pinned 18.6 server and entrypoint, with exact signed
Alpine OpenSSL 3.5.8-r0, `libuuid` 2.42.3-r1 and `libcurl` 8.22.0-r0.
Its `gosu` 1.19 source is pinned to commit
`6456aaa0f3c854d199d0f037f068eb97515b7513` and archive checksum, then rebuilt
with checksum-pinned Go 1.27.1. Only `golang.org/x/sys` changes to 0.44.0 plus
its required minimum Go directive; exact before/after module-file checksums
and Go checksum-database verification reject unrelated module drift. Relevant
source/toolchain/module licenses remain in the image. The root pnpm lock is
unchanged.

The PostgreSQL default-entrypoint proof passed readiness in 1,155 ms, a real
18.6 SQL write/read, actual PID-1 UID/GID 70, named/numeric `gosu` identities,
environment/HOME/PATH behavior and child-exit propagation. Inherited SIGINT
shutdown exited zero in 208 ms. All 2,404 other `/usr/local` files and ten
runtime configuration fields were unchanged. Proof and source evidence are
private under `/tmp/remorseless-postgres-minimal-proof.bf89TZ`; no owned
containers remain. Redis's official entrypoint separately ran as UID 999/GID
1000 with a read-only root and tmpfs data during the session proof.

The repository Compose build produced these exact local IDs:

- PostgreSQL: `sha256:070ad9c0ce13e78b791e7502e16466436e08353e597bfbdf64db0f7cd221ec28`;
- Redis: `sha256:620ce917889d7f11478f48ac7a18249f5e44eb5c059935ada3c38a8b15d5fa90`.

Independent fresh-database Trivy 0.74.0 scans passed with zero findings at
every severity, retaining 53 OS plus four Go packages/59 CycloneDX components
for PostgreSQL and 22 OS packages/23 components for Redis. The database was
updated `2026-09-07T01:01:06.547536359Z`, downloaded at
`01:34:05.43100022Z`, and 1,978,928 ms old at validation. Evidence is private
under `/tmp/remorseless-fixture-security-20260907.qHIXmc/evidence`; image
records bind each report's exact SHA-256. A second real run with the existing
CI-pinned Trivy 0.70.0 also passed using a fresh database, including Go 1.27.1
detection and CycloneDX 1.6 output; evidence is
`/tmp/remorseless-trivy070-compat.jquIIW`. Its official downloaded binary was
checksum-verified, not installed over the workstation's scanner.

Neither scan suppresses unfixed or unknown findings. The rebuilt `gosu` main
module's absent package version is explicitly recorded, with its source
identity proven separately. Full compiled PostgreSQL/Redis/module coverage is
not established. These clean test-image scans do not close the reported live
Redis 8.0.3 advisory or authorize registry publication and live migration.

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
- [Railway volume backups](https://docs.railway.com/volumes/backups)
- [Railway volume backup API](https://docs.railway.com/integrations/api/manage-volumes)
- [Railway resource pricing](https://docs.railway.com/pricing/plans#resource-usage-pricing)
- [PostgreSQL role attributes](https://www.postgresql.org/docs/current/role-attributes.html)
- [PostgreSQL libpq TLS modes](https://www.postgresql.org/docs/current/libpq-ssl.html)
- [PostgreSQL `pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html)
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis CVE-2025-49844 advisory](https://github.com/redis/redis/security/advisories/GHSA-4789-qfc9-5f9q)
- [Bitnami Legacy lifecycle](https://github.com/bitnami/containers/issues/83267)
- [Historical Redis image definition](https://github.com/bitnami/containers/blob/7cae83c281089791e24905d6a05e7d66e91c24ac/bitnami/redis/8.0/debian-12/Dockerfile)
- [Historical Redis persistence configuration](https://github.com/bitnami/containers/blob/7cae83c281089791e24905d6a05e7d66e91c24ac/bitnami/redis/8.0/debian-12/rootfs/opt/bitnami/scripts/redis-env.sh#L70)
- [Meilisearch backup methods](https://www.meilisearch.com/docs/resources/self_hosting/data_backup/overview)
- [MinIO `mc mirror`](https://min.io/docs/minio/linux/reference/minio-mc/mc-mirror.html)
