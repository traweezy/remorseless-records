# Infrastructure, data protection, and recovery

Last reviewed: 2026-09-20 UTC

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
state still requires an explicit network review. MinIO Bucket retains a
Railway public domain; the Console domain was removed on September 20 after
review. The operator also approved removal of the Meilisearch staging domain
on September 20. Scoped inspection confirmed domain
`619e417f-4046-43d9-931b-ce3d55258d31` on the expected project,
environment and service immediately before deletion. Railway returned
`deleted: true` for that domain, its scoped domain list became empty, and the
former public `/health` returned a Railway HTTP 404. Meilisearch deployment
`95d54007-763d-4588-a67c-fabd6480b910` stayed successful; Backend
`/live`, `/ready`, and `/api/health` and Storefront `/`, `/ready`, and
`/catalog` all returned HTTP 200. The old hostname still resolves to the
Railway edge, so 404 and the empty scoped domain list are the removal evidence;
the exact hostname is not guaranteed recoverable.

The separately approved Console removal targeted only domain
`35a52594-ddc1-43e3-a230-b6f40c2ceb88` on staging service
`f9aaabc0-2137-4959-9f00-1215b1b8fde0`. The scoped list matched
`console-staging-4044.up.railway.app` before deletion and was empty afterward;
Railway returned `deleted: true` and the old URL returned HTTP 404. The
Console deployment remained `SUCCESS`, the separate Bucket domain remained
active, and Backend and Storefront `/ready` returned HTTP 200. Railway's
retained Console HTTP logs contained no requests in the preceding 30 days;
the sole later request was our bounded HEAD probe. Restoring the exact
hostname is not guaranteed. This does not change MinIO object access or close
the off-site media backup requirement.

Current support-service sources are:

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

The production role plan uses three distinct login roles and one non-login
owner role:

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
grants. The auditor checks whether `lo_compat_privileges` is currently enabled,
but does not inventory parameter `SET` grants that could permit enabling it
later; review those grants for the login and its inherited/reachable roles
separately. Role-audit tests create only transactionally rolled-back fixtures on
the explicitly guarded disposable local PostgreSQL service. Passing them does
not perform the staging role cutover or satisfy its operational evidence.

### Staging authority verification — September 15, 2026 UTC

The live PostgreSQL 16.11 audit exposed SQLSTATE `42883`: the previous query
called `has_largeobject_privilege`, which was introduced in PostgreSQL 18.
The compatibility fix inspects large-object catalog ACLs, including PUBLIC,
inherited and reachable grants, superuser authority, and the current
`lo_compat_privileges` setting. Inspection failures still fail closed.
Validation passed 54 unit tests and 39 real integration tests on each of
PostgreSQL 16.15 and 18.6, including actual large-object writes and PostgreSQL
18 native-function parity. All local fixtures and clusters were removed.

A read-only probe of the reviewed fixed query against live 16.11 correctly
rejected the existing administrator for all three profiles. This probe did
not deploy the fix or change authority. Backend still uses the sole superuser
login; all 914 application relations are superuser-owned, all four planned
roles are absent, migration/backup URLs are absent, and role-split enforcement
is disabled. The database contains 171 tables, 735 indexes and eight sequences
(45,781,475 bytes). Private evidence:
[live authority inventory](/tmp/remorseless-resume-20260914.oonsnior/postgres-readonly-authority-fixed.json)
and [local version matrix](/tmp/remorseless-resume-20260914.oonsnior/role-pg-matrix.jsonl).

On the accepted `7a9d1b9` release, a separate 03:07 UTC check ran the actual
packaged query against that source. Its query hash matched committed SQL and
all three profiles still rejected the administrator; backup also rejected its
write privileges. The read-only transaction rolled back and its connection
closed. Exact running-instance and source identities matched before/after.
This proves deployment of the compatibility fix, not completion of role
separation. The initial private helper refused retained removed-instance
history before SSH; its corrected strict running-instance check and original
refusal are recorded in the handoff and private evidence.

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

The September 15 UTC read-only probe verified native SSH forwarding to the
exact running PostgreSQL deployment instance, with strict existing host-key
verification and explicit project/environment/service/deployment guards before
and after the connection. PostgreSQL also negotiated TLS through that tunnel.
The original source URL remained unchanged; the transient loopback mapping
preserved credentials, database and query options only in process. Both probe
tunnels were closed. The public PostgreSQL proxy remains active. See the
[private tunnel receipt](/tmp/remorseless-resume-20260914.oonsnior/postgres-private-tunnel-locale.json).
An actual export still needs a companion receipt binding the original source
identity and Railway scope to the mapped endpoint, run and archive checksum.

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

The legacy backup, receipt, and restore commands accept `--help` without credentials and reject unknown,
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

A restore drill must target a new, empty, disposable database on the source's
PostgreSQL major version. The legacy two-command capture needs source writes
quiesced until its private receipt is captured after the archive. The newer
`data:postgres:snapshot-backup` shares one exported source snapshot across the
archive and receipt, so DML may continue while schema DDL is paused. The
receipt binds the archive
checksum and source fingerprint to every physical user table and its row count,
six schema counts, and the source major. It cannot retroactively certify an
earlier export or a source that changed between the legacy dump and receipt capture. See
the [PostgreSQL restore acceptance guide](POSTGRES_RESTORE_ACCEPTANCE.md) for
the complete sequence, isolation requirements, and failure handling:

```bash
DATABASE_BACKUP_URL='<backup-role-url>' \
  pnpm run data:postgres:restore-receipt -- \
  --manifest /absolute/path/postgres-....manifest.json \
  --output /absolute/private/postgres.restore-receipt.json
```

For the live Railway staging source, use
`data:postgres:staging-snapshot` to wrap the shared-snapshot capture with exact
project, environment, service, sole active deployment/instance, READY volume,
remote replica, and before/after database system-ID guards. It publishes a
fourth private `source-scope.receipt.json` only after the archive, manifest and
receipt validate. The [restore acceptance guide](POSTGRES_RESTORE_ACCEPTANCE.md)
contains the guarded command and its source-URL/TLS rules. This local bundle is
drill evidence, not scheduled or off-provider backup retention.

First run the read-only target verification with the source receipt:

```bash
DATABASE_RESTORE_URL='<disposable-target-url>' \
  pnpm run data:postgres:restore-drill -- \
  --archive /absolute/path/postgres-....dump \
  --manifest /absolute/path/postgres-....manifest.json \
  --receipt /absolute/private/postgres.restore-receipt.json
```

The command verifies canonical regular files, a manifest no larger than 64 KiB,
byte length, SHA-256, a distinct endpoint fingerprint, receipt binding, source
and target major-version parity, and the target inventory.
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
  --receipt /absolute/private/postgres.restore-receipt.json \
  --apply
```

Apply requires the receipt and confirms the complete physical-table list,
per-table row counts, all six schema counts, and server major against its
source invariants. A comparison failure reports `target_verification` without
a success record, but the restore transaction may already have committed.
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
input, snapshot, CLI failures and verified client provisioning.
`pnpm run qa:postgres-recovery:integration`
requires the explicitly guarded disposable local PostgreSQL fixture and is
included in `qa:disposable-integration:services`. The target-inventory matrix
rolls back its object fixtures. The real CLI suite creates separate randomly
named source/target databases, produces a custom archive and private checksum
manifest with `pg_dump`, verifies dry-run, then applies `pg_restore` and checks
representative rows, views, routines, identity sequences and database
constraints. It exercises archive corruption/budget rejection, source-target
and confirmation guards, populated targets, transaction rollback after a late
COPY failure, and actual lock-wait client cancellation with PID/file cleanup.
After releasing its owned lock, it verifies the server session disappears;
the default server does not poll for client disconnection during a query.
The verified snapshot remains restorable after the original archive
changes. The receipt-required path also has 45 focused tests and 12 real
same-major PostgreSQL 16.15 roundtrip cases, including a row-count mismatch
and populated-target rejection. These were local implementation results before
the later staging-data drill below. Every database and temporary
directory belongs to the test and is removed afterward.

These tests require actual PostgreSQL 18.6 clients. Backend CI provisions exact
PGDG `18.6-1.pgdg24.04+2` client/libpq packages privately on Ubuntu 24.04 after
signature and checksum verification. Metadata and package identities are
retained as CI artifacts; missing pins fail closed without a version fallback.
See [Disposable integration](DISPOSABLE_INTEGRATION.md) for local provisioning,
the complete evidence boundary and cleanup requirements. This closes the
synthetic CLI roundtrip gap. It does not establish a real provider backup,
PITR, a production recovery duration, or live application acceptance.

### Initial staging recovery assessment — September 15, 2026 UTC

Fresh inventory found eight volume snapshots, newest December 15, 2025, no
backup schedule, disabled PITR and `archive_mode=off`. The source remains
PostgreSQL 16.11 with UTF-8, libc `en_US.utf8` and collation version 2.41.
Verified 16.15 clients are available for a same-major logical recovery proof.
The existing 18.6 Alpine fixture does not establish that proof: a newer
`pg_dump` can read an older server, but its output is not guaranteed to restore
into that older major version. See [PostgreSQL's compatibility notes](https://www.postgresql.org/docs/18/app-pgdump.html#APP-PGDUMP-NOTES).

The official `postgres:16.15-trixie` linux/amd64 target was reviewed and pulled
by immutable manifest
`sha256:485935f94cc7165afa896978809c37b592dc07f0a37d2c8f645f12412d0212c8`.
Its package metadata identifies PostgreSQL `16.15-1.pgdg13+2` and libc/locales
`2.41-12+deb13u3`; runtime locale parity has not been tested. Trivy 0.70.0 with
the September 15 01:12 UTC database rejected it with 14 CRITICAL, 101 HIGH and
three UNKNOWN package findings. Of these 118 gate findings, 59 have listed
fixes; the remaining 59 span 13 advisories with no listed fix (one CRITICAL,
56 HIGH, two UNKNOWN). Fixable OS packages and bundled `gosu` dependencies
therefore do not account for the entire rejection. A private correction recipe
is only a draft; it was not built or accepted. See the
[target assessment](/tmp/remorseless-resume-20260914.oonsnior/postgres16-target-assessment.json).

That rejected official 16.15 target was never started. At this assessment,
no PostgreSQL bootstrap backup or real-data restore had occurred. Recovery required an accepted
same-major target, a bounded private export with source/transport binding,
and restore plus application
acceptance in an isolated target with no provider credentials, network egress
or consumers, followed by verified cleanup. Fresh source load and local/target
disk and memory capacity must be checked immediately before that operation.
Role cutover, scheduled backups, PITR and off-provider retention remain open;
neither the catalog probe nor the synthetic recovery tests satisfy them.
The linked `/tmp` receipts are private session evidence, not durable backup
storage or committed recovery artifacts.

### Accepted same-major target and actual backup — September 15, 2026 UTC

The recovery-only PostgreSQL 16.15 image is
`sha256:76db58e52e571729aa4ab51a5c597189e6f570086345c29b68b358067a6547e8`.
It builds unmodified official source with checksum
`c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed`,
also matched against the signed PGDG source index. Its runtime retains 18
complete, verified Debian package payloads, including libc/locales
`2.41-12+deb13u4`, ICU, OpenSSL, compression libraries, the shell and the bounded
loopback relay. All 1,075 package files matched their original SHA-256 values;
all 372 ELF loader checks passed. Build inputs and toolchains are pinned.
The repeated cached build returned the same image ID; a clean independent
reproducibility build is not established.

This deliberately reduced recovery image omits XML/XSLT, systemd, PAM, GSS,
LDAP, additional procedural languages and contrib extensions. A fresh read-only
source feature query found no objects requiring those omitted features. It is
not a full replacement for the live service image. Synthetic runtime checks
verified 16.15, UTF-8, libc `en_US.utf8`, collation version 2.41, ICU, PL/pgSQL,
SCRAM, TLS and all three supported dump compression formats.

The checksum-verified Trivy 0.70.0 scanner and September 15 01:12 UTC database
reported zero HIGH, CRITICAL or UNKNOWN package findings; 28 LOW and 42 MEDIUM
findings remain. Trivy does not establish coverage of the compiled PostgreSQL C
code. A separate review of the official PostgreSQL 16 security table found all
55 listed advisories fixed by 16.15. The private
[root-reviewed target receipt](/tmp/remorseless-resume-20260914.oonsnior/pg16-minimal.rZtAhf/candidate-root-reviewed-receipt.json)
binds source, packages, scanner/database, feature checks and runtime evidence.

One actual bootstrap export ran from 03:39:14–03:39:39 UTC using verified native
16.15 clients and the existing backup helper. The source was the unchanged
16.11 deployment `50c57d73-0457-4bdc-8765-99fa22a6c084`, running instance
`afc5f0ed-2fb6-4a17-94fb-d34129d0de1e`, on volume
`1f219ae4-1659-4d3f-972f-8a8020441293`. The existing administrator supplied this
bounded read-only bootstrap; it does not satisfy the least-privilege backup-role
requirement. The archive is **1,852,247 bytes**, SHA-256
`e9d492ea9049c7f23a7f4c2c029fbcddc069948b38f64afaf9e5bc9cb9e32c7a`.
Private directory/file modes are 0700/0600. Strict native SSH host-key checking,
PostgreSQL TLS and a separate source receipt bind the original source identity
to the temporary mapped endpoint, target, tools, archive and manifest.

The helper completed in 24.742 seconds; the complete guarded operation took
47.107 seconds. Before/after checks matched 171 application tables, 735 indexes,
eight sequences, three migration-table counts/digests, 518 Products (462 not
soft-deleted), 646 variants and zero orphan variants. These database counts
include draft/deleted records and are distinct from the published catalog API
counts. The source retained eight connections of 100, zero waiting locks,
zero recovery clients and no OOM events. Both application readiness contracts
remained healthy on `7a9d1b9`. All owned client groups and source tunnels closed.
Two earlier local preflights stopped before credentials, tunnel or dump work:
one rejected a non-private evidence-file mode, and one used an incorrect
Storefront health route. Both were corrected with the original refusals retained.

The [source recovery receipt](/tmp/remorseless-resume-20260914.oonsnior/postgres-real-recovery/export-20260915-0338/source-recovery-receipt.json)
has SHA-256 `c6c69c53556865d350ff4f7131b0337d45874908a2272badfef8cdeb5e32d3e9`.
Its schema-1 archive manifest remains unchanged. Export acceptance alone does
not establish restoration, production RTO, scheduled backups, PITR or off-site
retention. Private `/tmp` archives are session evidence, not durable storage.
The new restore receipt cannot be created after the fact for this earlier
export. Its private archive was unavailable in the resumed session, so a fresh
source-bound archive and receipt were required. The later shared-snapshot path
below allows DML to continue while schema DDL is paused.

### Guarded staging-data logical restore — September 20, 2026 UTC

The new staging wrapper captured a private, snapshot-bound archive, manifest,
complete row/schema receipt, and Railway source-scope receipt at
`2026-09-20T00:34:18.948Z`. The exact running Postgres deployment, instance,
READY volume instance, SSH runtime identity and PostgreSQL system identifier
matched before and after capture. The 1,851,532-byte archive SHA-256 is
`50a2a91629429233bbaa126018f04b3d934187a9eceb3618ab7f9f7f6515417c`.
The receipt covers 171 physical tables, 735 indexes, eight sequences and 385
constraints. The first two guarded attempts published nothing while a real
171-table limit in the inventory query was diagnosed and fixed. A native
PostgreSQL 16 regression now exercises that scale.

An owned, empty PostgreSQL 16.15 target from exact scanned image
`sha256:76db58e52e571729aa4ab51a5c597189e6f570086345c29b68b358067a6547e8`
had a different physical system identifier from the 16.11 source. Docker
inspection confirmed no network or published ports and a read-only root.
Private, checksum-bound preflight passed; one-shot apply restored all 171
tables and matched every row count and six schema counts. A separate verify
repeated that comparison. Backend readiness stayed healthy on accepted
`8dae008`. The runner removed the owned target directory, container and volume;
independent checks found none remaining. Full command and evidence limits are
in the [PostgreSQL restore acceptance guide](POSTGRES_RESTORE_ACCEPTANCE.md).
This closes the staging-data logical restore proof, not application startup
against the target, scheduled/off-site backups, PITR, least-privilege roles,
or production RTO.

The guarded tooling subsequently passed exact-revision staging CI, both
Railway deployments, deployed browsers and bounded runtime checks at
`e7a37c2180f890e0562495a5897b3cef7decc5c2`; see the
[session handoff](NEXT_SESSION_HANDOFF.md). This release acceptance does not
expand the recovery proof above.

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
SIGINT/SIGTERM cancellation covers client-version lookup, source/target
listing, dry-run, the mutating mirror and content reads. Every command is
asynchronous; cancellation kills the active direct `mc` child and waits for
closure before exiting; no later commands start. Repeated signals remain
handled while that child is being reaped. This does not claim termination of
arbitrary descendants or rollback of writes already accepted by the provider.
Provider stderr and raw object names are not emitted; failures report only a
fixed phase, failed status and duration. A failed or cancelled workflow emits
no successful manifest. Cancellation during publication removes only its
exclusively created manifest; a pre-existing file is never removed. If that
cleanup itself fails, the reported `manifest_cleanup` phase requires operator
inspection. Investigate any partial remote copy before rerunning.

The private `0600` schema-version-2 manifest includes client version, endpoint
fingerprints, canonical key/size inventory hashes, a combined key/size/content
hash, verified object/read-byte counts, and total/verification durations. A
version-1 manifest only established key/size inventory parity and is not
content-verified evidence. No object bytes are retained locally. Use the same
boundary from off-site storage to a disposable restore bucket for the weekly
drill. Keep the source quiescent for a consistent current-state copy: sequential
reads do not establish an atomic multi-object snapshot or prevent subsequent
changes. The helper's local tests use synthetic streams and disposable fake
client processes. They exercise both cancellation signals in all seven command
phases, child reaping, deadlines, repeated signals, command failures and
manifest-publication races; they do not complete an off-site operational drill.
Version ID history still requires bucket replication and separate provider
evidence; the mirror manifest intentionally does not claim to protect it.

Weekly, restore a deterministic sample plus the newest object to a disposable
bucket and verify bytes and checksums. Quarterly, perform a full manifest
comparison and record duration.

### Guarded full current-state restore drill

`pnpm run data:media:restore-drill -- --help` describes a full off-site-to-
disposable-bucket drill. Its default mode checks a private schema-version-2
backup manifest against an independently recorded SHA-256, validates the
off-site endpoint fingerprint and exact current object inventory, requires an
empty pre-created disposable bucket, and runs `mc mirror --dry-run`. It prints
only counts, planned bytes, a direction-and-manifest-specific confirmation, and
opaque hashes. It does not print object keys or provider diagnostics.

The backup manifest must have `preservedTargetObjects: 0` and matching source/
target inventory hashes. Existing version-2 manifests with target-only objects
cannot bind a full restored set to their recorded content hash and fail closed.
Keep the off-site source and disposable target free of concurrent writers for
the entire drill; the CLI rechecks the empty target immediately before copy,
but it cannot lock either remote bucket or prove two aliases resolve to
different underlying locations. Review those identities independently.

After reviewing the dry-run and provider transfer/GET/egress cost, set the
explicit budgets and confirmation to apply:

```bash
MEDIA_RESTORE_SOURCE='offsite/catalog' \
MEDIA_RESTORE_TARGET='disposable/catalog' \
MEDIA_RESTORE_MANIFEST='/absolute/private/media-backup-manifest.json' \
MEDIA_RESTORE_MANIFEST_SHA256='<independently-recorded-sha256>' \
MEDIA_RESTORE_OUTPUT_DIR='/absolute/private/restore-evidence' \
  pnpm run data:media:restore-drill

MEDIA_RESTORE_SOURCE='offsite/catalog' \
MEDIA_RESTORE_TARGET='disposable/catalog' \
MEDIA_RESTORE_MANIFEST='/absolute/private/media-backup-manifest.json' \
MEDIA_RESTORE_MANIFEST_SHA256='<independently-recorded-sha256>' \
MEDIA_RESTORE_OUTPUT_DIR='/absolute/private/restore-evidence' \
MEDIA_RESTORE_CONFIRM='<dry-run-confirmation>' \
MEDIA_RESTORE_MAX_TRANSFER_BYTES='<reviewed-source-bytes>' \
MEDIA_RESTORE_VERIFY_MAX_BYTES='<reviewed-two-download-bytes>' \
  pnpm run data:media:restore-drill -- --apply
```

Apply mirrors current objects with SHA-256 upload checksums and no `--remove`,
then requires an exact key/size inventory and streams every off-site and
restored object through SHA-256 readers. The recomputed full-set content hash
must equal the original backup manifest before a private `0600` restore receipt
is published. The receipt records only opaque endpoint identities, checksums,
counts, bytes, client version and duration. A failed or cancelled partial copy
remains in the disposable bucket for inspection; no success receipt is
published. The planned byte budgets do not cap provider metadata, retry or
wire overhead. The current-state drill does not restore version history,
delete markers, scheduled retention, or prove another provider/account is in
use. These still need actual provider evidence and a controlled live drill;
the production hardening checkbox remains open.

Do not enable physical Catalog-media purge until a full off-site restore drill
passes. Keep the MinIO API public only if immutable Storefront object delivery
requires it. Remove the public Console domain or place it behind reviewed SSO;
credentials alone are not an acceptable public-console boundary.

## Redis recovery and memory

### Actual staging RDB export and isolated restore — September 14

At September 15 02:25 UTC (September 14 in the operator timezone), the first
actual full synchronization exported a private **1,633,338-byte RDB** from the
existing Redis 8.0.3 staging deployment. The unchanged source checker consumed
exactly that byte count and verified its checksum: 1,282 keys, seven expiries,
zero already expired and zero hash-field subexpiries. The archive SHA256 is
`92966f920080514c3b4c1b4a0a6d84f5a68d25e48f6921e7041f0a6030051cf7`.

Fresh preflight bound the project, environment, service, deployment, process,
volume and filesystem. The source runs as UID/GID 1000, correcting the old
historical-image UID 1001 assumption; the SSH shell runs as root. Persistence
paths resolve under the expected `/bitnami` volume, with 48.86 GB available.
The actual cgroup and provider ceiling agree at 32,000,000,000 bytes; cgroup
peak was 56,569,856 bytes with no recorded OOM/high/max events. Current RSS
was about 20.44 MB and no save, rewrite or replica was active. Diskless sync,
RDB checksums and compression were already enabled. Existing credentials
passed exact ACL dry runs; no grants or settings were changed. The loaded
`vectorset` v1 module is supported by the isolated target. Host overcommit
`0` and enabled transparent huge pages were recorded, not changed.

The one-shot helper used the checksum-verified vendor Redis CLI 8.0.3 through
the existing SSH agent and a fresh private, empty regular file. Its 25-second
export deadline and 32 MiB OS file limit include the temporary diskless marker.
The outer remote operation has a 90-second deadline with five seconds for
cleanup, inside a 120-second local deadline. Diagnostics share a 32 MiB hard
per-file limit and must pass a subsequent 64 KiB acceptance limit; that latter
check is not a separate wire cap. Directory-FD anchoring, exact inode/owner/mode
checks, child reaping and identity-checked removal protect the owned temporary
files. The base64 transfer is bounded, canonical and bound to the source size,
hash, run ID and checker evidence. The whole command took 10,868 ms, including
SSH and the existing five-second diskless delay.

Do not use `redis-cli --rdb -` for this procedure. The reviewed 8.0.3 client
retains the 40-byte diskless delimiter on stdout, while regular-file truncation
failure can still accompany exit zero. Both reviewed checkers can accept
trailing bytes or a disabled checksum. Require the exact CLI success grammar,
one checksum-success line, the complete final success/count footer and both
consumed offsets equal to the complete file length. Validate all four numeric
key/expiry counters. Raw checker failures may expose key names and remain
private. An actual empty 8.10.1 fixture and eleven rejection cases validated
these parser boundaries before the live export.

The first wrapper invocation stopped before SSH because its minimal
environment omitted the existing `SSH_AUTH_SOCK`. Independent observations
showed zero full syncs, no new fork, no temporary files and healthy apps.
Preserving the existing agent socket fixed the wrapper; a preflight-only probe
passed before the sole actual synchronization. Neither failure triggered an
automatic SYNC retry or key registration.

Independent postchecks matched the preflight run-ID fingerprint and showed
exactly one full sync and one fork: 3,730 microseconds and 1,331,200 bytes of
copy-on-write memory. RSS became 21,278,720 bytes; cgroup peak and OOM counters
were unchanged. No replica, save, rewrite, exporter/checker/timeout process or
owned temporary directory remained. Source settings and volume identity were
unchanged; all six application health checks passed on `aac22a7`. A passive
1 MiB replication backlog remained active with zero replicas. It was recorded
and left to normal Redis lifecycle management, not cleared to improve evidence.

At 02:29 UTC the exact hardened local image
`sha256:99267d3e232c751add077e98c4fc1b9e508d4241740b52229e44986f7173f71b`
restored a separate tmpfs copy. The current-session scan binds that image to
zero findings across 22 detected OS packages and 23 SBOM components; compiled
server/module dependency coverage remains unestablished. Before starting Redis,
its genuine 8.10.1 checker verified the original read-only artifact and exact
checksum/footer offsets. Actual container inspection verified network-none,
no published ports or provider credentials, read-only root, dropped
capabilities, no-new-privileges, one CPU, 256 MiB with no swap, 64 PIDs and
UID/GID 1000:1001. This deliberately chosen identity is not an image-default
deployment claim. AOF and scheduled saves were disabled for the isolated RDB
load; restored workers were never started.

The target loaded 1,278 keys and discarded four expired keys, accounting for
all 1,282 snapshot keys. Three expiries remained; subsequent aggregate counts
were stable with no eviction. All 16 target databases were checked: only
database zero was populated. A random target-only NX write/read/delete and
benign Lua execution passed. The complete isolated drill took about 3.77
seconds; these tiny-data timings are not a production RTO. The exact owned
container was removed and absence independently verified. Original archive
and manifest bytes, hashes, identities, ownership and private modes remained
unchanged. The original export manifest retains its historical
`restoreProven: false`; the separate later restore evidence supplies the proof.

Private artifacts and helpers are under
`/tmp/remorseless-resume-20260914.oonsnior/redis-real-recovery`, including
`export-tBNn6Q` and `restore-BWqxPS`; independent source checks are under
`/tmp/remorseless-redis-preflight-20260915-_t7rhnzu`. Keep the local private
archive for the controlled migration review. The helper did not change provider
snapshots, retention schedules, live keys, configuration, ACLs or source-volume
files. Normal application writes continued. The replication operation incurred
the measured fork and bookkeeping above.

This closes **actual RDB format/load recovery**, not current multipart-AOF
replay, unattended/off-site retention, queue/lock/idempotency reconciliation,
image-default compatibility or rollback after subsequent live writes. The
configured/running image mismatch, missing immutable live-image identity,
affected Redis version, unbounded maxmemory and disabled RDB schedule remain
open. Preserve the untouched source data before any controlled image cutover.

### Offline multipart-AOF verification

Use `pnpm run data:redis:aof:verify -- --help` for a bounded check of an
**offline, operator-owned copy** of the Redis multipart-AOF directory. The
command requires an absolute private directory owned by the running user, mode
0700, containing only `appendonly.aof.manifest` and its listed regular 0600
BASE, INCR and optional HISTORY files. It rejects symlinks, hard links, extra
files, malformed or duplicate manifest entries, noncanonical names, missing
listed files, an absent active BASE/INCR file and more than 32 AOF files. A
valid set can contain only a BASE or only INCR files. HISTORY files are
inventoried and hashed, but Redis's checker validates only active BASE/INCR
content; the report exposes both counts. It accepts the default
`appendonly.aof` name only; a
different Redis `appendfilename` needs a separate review. Example:

```bash
REDIS_AOF_CHECKER_SHA256='<independently-reviewed-checker-sha256>' \
REDIS_AOF_MAX_BYTES=536870912 REDIS_AOF_TIMEOUT_MS=120000 \
  pnpm run data:redis:aof:verify -- \
  --archive-dir /absolute/private/offline-appendonlydir \
  --checker /absolute/trusted/redis-check-aof
```

The checker SHA-256 must come from independently reviewed binary provenance,
not from hashing an untrusted candidate at run time. It is verified before and
after execution; version output alone is not identity evidence. The verifier
copies at most 512 MiB by default to a new private temporary
directory, hashes every file, invokes the trusted Redis 8.10.1
`redis-check-aof` there **without `--fix`**, then checks the snapshot hashes
again and removes it. An explicit `REDIS_AOF_MAX_BYTES` can raise the total
budget to 10 GiB; `REDIS_AOF_TIMEOUT_MS` is an overall 100–600,000 ms deadline.
It bounds the checker manifest path to 240 bytes before invocation, uses bounded
64 KiB streaming buffers and suppresses raw checker diagnostics,
which can include private paths and key data. Successful JSON reports only
version/checker hash, active/history file counts, byte count, SHA-256
manifest/set fingerprints, duration and
`replayProven: false`; failures use fixed phases and no source path or key names.
The source archive is read-only to this command. Redis's checker opens files
read/write even in check mode, which is why it only sees the owned snapshot.

This verifier proves structural and checker acceptance of the copied set, not
that an active AOF directory was copied consistently. Redis warns that copying
multipart files during an AOF rewrite can produce an invalid backup; use a
reviewed quiesce or Redis 8.10 `BACKUP START`/`BACKUP SEAL` boundary before
creating the offline copy. See the [Redis persistence
guide](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).
The disposable integration gate creates a synthetic BASE plus INCR in the
digest-pinned, scanned Redis 8.10.1 image and checks it with that image's real
checker; it also checks BASE-only and HISTORY-inventory variants. The gate
binds the checker wrapper to the scanned image ID. A second fixture runs that
image with no network or published ports, a read-only root and bounded CPU,
memory and PIDs. Synthetic BullMQ `events-queue` and `medusa-workflows` jobs
cover completed, failed, waiting and delayed states. It rewrites a BASE, adds
INCR writes and a key with an absolute expiration, shuts down the source and
verifies a private copy with the offline checker. A separate worker-free
Redis 8.10.1 startup loads that copy; the test compares queue counts and job
states, confirms the post-rewrite marker and expiration, then retains a
target-only write across a second startup. Source and archive hashes remain
unchanged. This proves only synthetic AOF replay and BullMQ state serialization,
without live queues, PostgreSQL, Stripe or provider egress.

### Pinned offline checker and worker-free replay

`pnpm run data:redis:aof:replay -- --help` describes the local isolated replay
gate for a **captured, private copy**, never the live Redis volume. It requires
the 0600 `capture.receipt.json`, an independently recorded SHA-256 of that
receipt, the private 0700 `appendonlydir`, and an exact local image ID from the
reviewed disposable-image scan. It checks every file name, size and SHA-256
against the receipt before running the existing offline verifier. The checker
sees another private writable copy because Redis opens AOF members with `r+`
even without `--fix`; the capture remains read-only.

The checked-in wrapper uses the historical [Docker Official Redis 8.10.1
Alpine image](https://hub.docker.com/layers/library/redis/8-alpine3.23/images/sha256-9c3ecc609a8087c0f11c494fefaf37a8f7bf9a967631d4a0da8967a9810be354)
at immutable index digest
`sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576`,
its Linux amd64 config/image ID
`sha256:00c30ddf0ef8074bbc7b7e5ea655bb6d359dc66694edd57d70fe95ce6ba531aa`,
and the independently recomputed `/usr/local/bin/redis-check-aof` SHA-256
`c9ed119a46bfe87ace4048eb22479da7d3ca4857f0ea5b1d1729e212bc5aabca`.
The [official Alpine Dockerfile](https://raw.githubusercontent.com/redis/docker-library-redis/v8.10.1/alpine/Dockerfile)
pins its Redis full-source tarball SHA-256
`e5cae2686231290bf55ae5cc4da01e646c3424233cae7618ebf3a64250ef1583`.
The wrapper checks the local digest association, image ID, checker bytes and
version every time; it never resolves the now-moving tag or pulls an image.
No image signature was verified, and this historical image is not an accepted
staging runtime image. It is used only as a no-network disposable checker.

After a separately approved capture, record its receipt SHA-256 outside the
mutable bundle and use a scan-approved local Redis 8.10.1 target image ID:

```bash
REDIS_AOF_REPLAY_MAX_BYTES=536870912 REDIS_AOF_REPLAY_TIMEOUT_MS=120000 \
  pnpm run data:redis:aof:replay -- \
  --archive-dir /absolute/private/capture/appendonlydir \
  --capture-receipt /absolute/private/capture/capture.receipt.json \
  --receipt-sha256 '<independently-recorded-receipt-sha256>' \
  --image-id 'sha256:<reviewed-scanned-local-redis-image-id>'
```

The command and checker wrapper require Docker's explicit `default` context to
resolve to the socket node at `/var/run/docker.sock`; alternate Unix proxy
paths, symlink endpoints, and TCP contexts fail closed. The local Docker daemon
remains an operator trust boundary. The command uses `--pull never` and checks
that the target image's checker bytes match the official pin. It copies to
owned private directories, then starts Redis as the current non-root user with
no network, published ports, workers, provider credentials or external mounts,
a read-only root, one CPU, 1 GiB memory, 64 PIDs and only private data/socket
binds. It verifies
those container facts, startup, Redis 8.10.1 AOF health and aggregate keyspace,
then restarts and checks aggregate parity and a changed run ID. A bounded
read-only probe also scans at most 5,000 keys in database zero through the
private target socket, classifies the four Medusa 2.18 BullMQ namespaces plus
workflow checkpoints, locks, cart idempotency, health snapshots and rate
limits, and records only category/type/TTL-bucket and fixed queue-state
cardinalities after both startup and restart. It never emits discovered key
names, job IDs, lock owners or values; malformed scan/type responses, a key
cap, populated nonzero database, or a 15-second scan deadline fail the replay.
The probe starts no BullMQ worker or provider client. These isolated summaries
do not compare live staging, prove individual job delivery, or reconcile
PostgreSQL and Stripe; `queueReconciled` remains false. The exact
owned container and private directories are removed before success output;
`cleanup_unverified` is an incident requiring private local inspection.
The report omits keys, values, paths and raw checker diagnostics and keeps
`queueReconciled` and `businessReconciled` false. The later staging-data replay
is recorded below; BullMQ state reconciliation and production recovery remain
open. The disposable CI fixture exercises receipt-bound replay on synthetic
BASE/INCR data with its separately verified fixture checker because that job
does not provision the named historical official image. It does not execute the
digest-pinned wrapper or supply live recovery evidence. Run the pinned wrapper
on a host where its reviewed official image is already present for any future
staging-data replay.

For optional **offline failed-job triage** on that same receipt-bound,
worker-free target, append `--classify-failed-jobs` to the replay command.
The opt-in reader checks the existing aggregate's failed counts against the
BullMQ failed sorted sets before reading at most 500 members across the event
and scheduled-job queues. Before either member-range read, it performs exact
`MEMORY USAGE ... SAMPLES 0` checks and rejects any nonempty failed set over
256 KiB or without a valid memory measurement. It caps each job ID at 256
bytes and all IDs at 64 KiB, each reason at 4 KiB and all reasons at 1 MiB,
and each startup/restart classification at 30 seconds. Oversized reasons are
counted without reading their content. BullMQ 5.13 stores the attempt count
in `atm`; the reader never requests the legacy `attemptsMade` field. Event
jobs skip `name` and `data`. For a scheduled job whose outer `name` is exactly
`schedule`, the reader may fetch its `data` field after a length check of at
most 1 KiB per job and 256 KiB total. It parses only the Medusa `jobId`
category; extra scheduler data is ignored and never emitted. Other job
payloads, stack traces and results are never read.
The output contains only fixed allowlisted scheduled-job category buckets,
heuristic failure-reason buckets, attempt buckets, and totals. Medusa 2.18
registers an app task as `job-<config.name>` inside `data.jobId`; the outer
BullMQ name is `schedule`. Exact matches to the six checked-in task names get
their fixed buckets. Other IDs remain `unlisted`, and missing, oversized, or
invalid scheduler data gets an explicit bucket. The event job name is never
printed. Missing hashes and fields get explicit buckets. The
classifier requires the startup and restart count reports to agree before
success, and retains `queueReconciled: false` and
`businessReconciled: false`. The reason buckets are lexical triage hints, not
proof of cause, business impact, or retry safety. For this staging capture,
compare its result with the independently recorded 237 scheduled failures and
one event failure; do not treat the older AOF as a live snapshot. Do not infer
retry safety from `atm` or categories. These are raw `atm` buckets; BullMQ may
prefer a legacy `attemptsMade` field when both fields exist in a migrated job,
so they are not authoritative SDK attempt counts for historical hashes. An
unexpected prevalence of `unlisted`, invalid data, or missing `atm` calls for
an installed-package contract review before using the classification for
incident decisions.
The root `qa:workflow-scheduler-timestamps` gate pins Medusa's registered
`job-<config.name>` identifier, `schedule` queue envelope, queue name, and
BullMQ's `atm` field in the installed packages. The disposable multipart-AOF
fixture exercises a failed scheduled job through BullMQ and checks its category
and raw `atm` counter after isolated replay. Both gates must pass before using
this reader on the private capture.

The first opt-in run on the verified private September 20 capture passed
receipt/file checks and worker-free startup/restart, then cleaned up its
owned container and temporary replay directory. It classified all 238
failed-set entries: one event job with an `other` reason hint, and 237
scheduled jobs with 73 `providerHint` and 164 `other` reason hints. Every
scheduled-job name fell outside the initial static allowlist; every attempt
field was absent or invalid under this reader's schema. This suggests the
allowlist does not represent Medusa's stored scheduler job names, not that
the app's six scheduled tasks were absent. No job identity or raw error was
emitted, and the lexical hints do not prove provider causation. The count-only
private report is
`/tmp/rr-failed-jobs-20260920/classification.json` (0600 in a 0700
directory), SHA-256
`19e21adf217b8c992f1f7325d084c9dbd58dd0320668b8133b02c6080edffe23`.
That report used the previous classifier schema; its name and attempt buckets
remain historical evidence only. A second receipt-bound, worker-free replay
with classifier schema 2 passed startup/restart and cleaned up its owned
container and private directory. It matched the same 238 failed-set entries:
164 scheduled entries in `reconcile-checkout-payments`, 73 in
`sync-taxrate-io-quota`, zero unlisted or invalid scheduled categories, and
one event entry. All 237 scheduled entries had raw `atm=1`; the event entry
had `atm>1`. The 73 provider-related lexical hints and 164 other hints are
unchanged. This identifies stored task categories and counter buckets only;
it does not prove why they failed, whether payments or quota sync were
affected, or whether any retry is safe. The count-only private report is
`/tmp/rr-failed-jobs-20260920/classification-v3.ziC0Sz.json` (0600 in a
0700 directory), SHA-256
`04ac6bc4aeaddd0cdea450a9f0555e9ee0f6888ea6d113d45bd69dfcc42945b2`.
Both reconciliation flags remain false.

September 19 read-only staging preflight found Redis 8.0.3 still running from
deployment `f75e3583-3d71-4787-9ada-12852e976fa0`, without a recorded image
digest. The current AOF directory is `/bitnami/redis/data/appendonlydir`:
manifest sequence 23 lists one 1,633,389-byte BASE and one 60,352,828-byte
INCR, with no HISTORY or extra files. AOF is enabled with `everysec`, last
write/rewrite status `ok`, no current rewrite, and automatic rewrites still
enabled at 100%. The live directory/files are 0755/0644, so they do not meet
the offline verifier's private 0700/0600 archive precondition. Current size is
under its default 512 MiB limit, but a fresh preflight is required at capture.
Redis 8.0.3 lacks the [8.10 `BACKUP START`/`BACKUP SEAL`
boundary](https://redis.io/docs/latest/commands/backup-start/). Its
[multipart-AOF backup procedure](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
requires a controlled temporary rewrite hold, checking that no rewrite is
active, a bounded copy, and restoration of the prior setting. At that
September 19 observation, the live configuration change and source export had
not been performed. The later September 20 drill below completed the
source-bound local capture/checker/replay proof. Queue and business
reconciliation, retained backup, and timed operational recovery remain open.
Do not count the synthetic fixture as a staging or production restore drill.

### Controlled staging multipart-AOF capture

`pnpm run data:redis:aof:capture -- --help` describes the source-bound capture
CLI. Its `preflight` mode is read-only: it queries Railway metadata and connects
by exact deployment-instance ID, then checks the remote project, environment,
service, deployment, replica, volume and `/bitnami` environment identities.
It uses the existing `REDIS_PASSWORD` only through `REDISCLI_AUTH` in the
container; no password is passed as a command argument or printed. The remote
helper verifies Redis 8.0.3 primary status, `appendonly yes`, `everysec`,
rewrite/write health, no active or scheduled rewrite, and the canonical
`/bitnami/redis/data/appendonlydir` realpath. It opens the directory and every
manifest-listed regular file with no-follow semantics, rejects extra files,
and returns only bounded metadata and a SHA-256 fingerprint. It never scans
keys or prints AOF data. Refresh all Railway IDs before each run; the September
19 IDs and manifest hash above are observations, not permanent configuration.

```bash
pnpm run data:redis:aof:capture -- preflight \
  --project-id '<reviewed-project-id>' \
  --environment-id '<staging-environment-id>' \
  --service-id '<redis-service-id>' \
  --deployment-id '<active-redis-deployment-id>' \
  --instance-id '<active-redis-deployment-instance-id>' \
  --volume-id '<redis-volume-id>' \
  --volume-instance-id '<redis-volume-instance-id>'
```

The live `capture` mode is a separate, controlled configuration change.
Obtain operational approval for temporarily changing the exact staging Redis
instance's `auto-aof-rewrite-percentage`; do not infer that approval from a
successful preflight. Avoid deployment, restart, manual `BGREWRITEAOF`, and
volume operations during the window. Create an operator-owned local 0700
output parent on storage with sufficient free space, then invoke `capture`
with the same seven pinned IDs, `--output-parent <absolute-private-path>`,
and `--confirm <fingerprint-from-a-fresh-preflight>`. The default cap is
512 MiB and the hold deadline is five minutes (`--max-bytes` up to 10 GiB;
`--deadline-seconds` 30–600). A changed run ID, manifest, source identity,
file set, or rewrite state fails closed before publication. A stale fingerprint
cannot authorize a changed source.

```bash
pnpm run data:redis:aof:capture -- capture \
  --project-id '<same-reviewed-project-id>' \
  --environment-id '<same-staging-environment-id>' \
  --service-id '<same-redis-service-id>' \
  --deployment-id '<same-active-redis-deployment-id>' \
  --instance-id '<same-active-redis-deployment-instance-id>' \
  --volume-id '<same-redis-volume-id>' \
  --volume-instance-id '<same-redis-volume-instance-id>' \
  --output-parent /absolute/private/redis-captures \
  --confirm '<fresh-preflight-fingerprint>'
```

The remote helper forks and acknowledges a detached watchdog **before** setting
the live rewrite percentage to `0`. It uses `CONFIG SET` without
`CONFIG REWRITE`, waits for no active/scheduled rewrite, and streams only the
manifest plus listed BASE/INCR/HISTORY files through bounded base64 chunks.
The source directory stays open by file descriptor; listed files are opened
through that descriptor with `O_NOFOLLOW`. BASE/HISTORY and manifest metadata
must remain unchanged; an active INCR is copied to a fixed observed size and
may grow afterward. Redis's own normal AOF writes can continue. The helper
does not copy onto or create any file in the source volume. It checks the
manifest, file set, run ID and rewrite state again before restoring the prior
percentage. Both the parent and watchdog attempt restoration on normal error,
signal, timeout or SSH-stream loss. A second SSH session independently checks
the exact prior value and run ID before an archive is published. An unexpected
`restoreVerified:false` after `liveConfigChangeAttempted:true` is an active
incident: verify and restore the prior setting on the pinned instance before
repeating anything. No mechanism can
promise restoration if Redis itself refuses commands or the whole host becomes
unavailable; do not interpret a failed capture as a backup.

The published directory contains `appendonlydir/` (0700 with 0600 AOF files)
and `capture.receipt.json` (0600). The receipt binds Railway IDs, run-ID hash,
manifest/file hashes, the previous rewrite setting and independent restore
check. The AOF may contain sensitive application data; keep the archive private
and apply the reviewed retention/encryption policy. Do not print its contents
or place it in the repository. Failed partial local copies are removed; the
source files are never repaired or modified by the capture helper.
If `redis.aof_capture.cleanup_unverified` appears, inspect the private output
parent for an owned partial before retrying; do not treat it as a backup.

Capture success alone is **not** offline verification or replay. The separate
`data:redis:aof:verify` gate still requires an independently reviewed SHA-256
for a trusted Redis 8.10.1 checker; hashing an arbitrary runtime wrapper is not
provenance. Apply the documented checker command to the returned
`appendonlydir` only after that approval, without `--fix`. Then copy the
verified set to a separate worker-free, no-egress Redis 8.10.1 target and
record actual startup/restart, key/expiry, module and BullMQ
`events-queue`/`medusa-workflows` state evidence. Compare live queue aggregates
within the capture window, account for ongoing writes and expired keys, and
reconcile carts/orders/payment state with PostgreSQL and Stripe before any
worker or traffic cutover. A capture receipt alone closes none of those gates.

### Approved staging multipart-AOF capture and isolated replay — September 20

The operator approved this bounded capture after the application release
settled. Immediate preflight pinned Redis 8.0.3 deployment
`f75e3583-3d71-4787-9ada-12852e976fa0`, instance
`a565fb05-17bb-4801-85e7-13e4f8e3b982`, volume
`1b69088f-0a38-4ecb-bddf-d43715b97d52`, and source fingerprint
`d8cb5c8efe046fd37bb8e382bf2bcd0e1e25fccb81c19fea8279815161e63dff`.
Its active AOF set was 63,393,426 bytes with rewrite percentage 100. The
guarded copy completed in 11.7 seconds: the private published bundle held
three files totaling 63,394,218 bytes, with manifest SHA-256
`a4e76e8e93e144466f309768357298d338a357018eb638612bed689221dcf188`.
Normal AOF writes continued during the copy, so the initial and copied byte
counts need not match. The capture reported `rewriteRestored: true`, and a
separate read-only post-preflight confirmed the live rewrite percentage was
back at 100. The temporary setting was not persisted with `CONFIG REWRITE`.

The capture receipt SHA-256 was independently retained outside the mutable
bundle as
`7f4f1d51b78bf81714e1123cc5feef7b3f9e9dee84f2bdfc0129f980ab75fbf7`.
The reviewed wrapper's SHA-256 was
`0b251dce0e7a0db2ecafb64626d30763d5ea6bfb6ec8f7086978676ac52fcc98`.
Pinned offline verification returned `verified`, with active-set SHA-256
`a61d55b674d9dd45f2b011d5c17fcca63446aba94c50e85d9387137cf97238cf`.
Receipt-bound worker-free replay used the reviewed local Redis 8.10.1 target
image
`sha256:99267d3e232c751add077e98c4fc1b9e508d4241740b52229e44986f7173f71b`.
Startup and restart both passed; the isolated target reported 1,278 keys,
three expiring keys and one populated database. Independent cleanup found
zero owned containers and temporary directories. The target had no network,
workers or provider egress, and no raw AOF content entered the repository.

This proves bounded source capture, local checker acceptance and isolated
Redis startup/restart of the captured set. It does not prove an off-site or
retained backup, queue/lock correctness, business-state consistency,
application startup with restored Redis, production RPO or RTO. Reconcile
BullMQ `RedisEventBusService:events-queue` and `bull:medusa-workflows` jobs
and locks against the capture
window, then compare carts/orders/payments with PostgreSQL and Stripe before
any worker or traffic cutover. The replay correctly retained
`queueReconciled: false` and `businessReconciled: false`.

A subsequent receipt-bound replay of the same private capture added a bounded,
read-only Redis aggregate at both startup and restart. By then one ephemeral
key had expired, leaving 1,277 keys and two remaining expiries; the aggregate
was identical across those two replay phases. The Medusa event queue
(`RedisEventBusService:events-queue`) had five keys, one failed job and 10,030
event entries. The workflow queue had three keys and 89 event entries. The
scheduled-jobs queue had 1,258 keys, including six delayed, 1,000 completed,
237 failed and eight repeat entries, plus 10,019 event entries. The cleaner
queue had seven keys, one delayed and one repeat entry, plus 10,037 event
entries. None of the four fixed queue prefixes had a populated wait or active
state at observation time. Two health snapshots remained; the fixed lock,
idempotency and rate-limit categories were empty. These are historical state
counts on an isolated, aging copy, not a point-in-time live comparison. In
particular, the 237 failed scheduled-job entries need classification before
any replay or cutover; this aggregate does not identify their jobs, causes or
business impact. No workers ran on the target, and both reconciliation flags
remain false.

For a later live comparison, `pnpm run data:redis:live-aggregate -- --help`
describes the dedicated read-only command. Supply the seven Railway source IDs
from a fresh AOF preflight and the expected run-ID SHA from the private capture
receipt. The command checks Railway source identity before and after, and its
checked-in helper checks container identity, Redis run ID, DB0-only keyspace
count and AOF health on both sides of a bounded scan. It rejects a changing
key count or a scan that missed the observed DB0 count. It uses one persistent
loopback RESP connection with a fixed read-only command allowlist. The existing
SSH capture transport can carry
raw command replies; sending `SCAN` through it would expose private key names.
This helper keeps key names, replies and errors inside the container and emits
only the fixed aggregate schema plus a bounded UTC observation window. It caps
keys, pages, bytes and time.
The disposable fake-RESP integration test uses the pinned Redis 8.10.1 Alpine
fixture with exact SHA-256-pinned Alpine `perl-5.42.2-r0.apk` and its
`libbz2-1.0.8-r6.apk` dependency. Backend CI builds it, validates a fresh
Trivy vulnerability report and CycloneDX SBOM for its exact image ID, and
exports that ID only after both fixture scans pass. The no-build integration
runner checks the scanned image and started container identities, then passes
the verified Redis ID to the fake-RESP test. That test uses `--pull never`, no
network and a read-only filesystem. It covers normal and empty aggregates plus
wrong type, oversized response, run-ID drift, other DB, count drift and key
replacement failures. A local 0.74.0 Trivy scan of the new fixture, using the
September 19 database, found zero UNKNOWN/HIGH/CRITICAL findings and validated
all 24 detected Alpine packages against the SBOM. At exact staging SHA
`9020b7798ed4fd5e156f379e8e879b84d3178e71`, Backend CI integration job
`106021157990` built the pinned fixture, scanned its exact image
`sha256:4e307ae819327efb553462276460c961e5b7cc2c893f125bb2f2ba81b68d6356`
with zero findings, retained its 25-component CycloneDX SBOM, and passed the
fake-RESP test. This satisfied the live collector's CI prerequisite.
For a direct local repeat, build the checked-in Redis fixture on the local
`default` Docker context, inspect its `sha256:` image ID, then set
`DOCKER_CONTEXT=default`, `INTEGRATION_TESTS_ENABLED=1` and
`RR_REDIS_AGGREGATE_TEST_IMAGE_ID=sha256:<reviewed-local-image-id>` before
`pnpm run qa:redis-live-aggregate:integration`.
The first live read-only aggregate ran from 04:34:24 to 04:34:29 UTC on
September 20. An immediate AOF preflight matched the captured seven source
IDs, fingerprint, manifest and run-ID SHA, with rewrite percentage 100 and no
configuration change. The guarded collector verified source identity before
and after and counted 1,282 keys. The event queue held one failed job and no
waiting or active jobs; scheduled jobs held 237 failed, 1,000 completed, six
delayed and no waiting or active jobs. The workflow and cleaner queues also
had no waiting or active jobs. These failed-job counts match the isolated AOF
replay, although normal writes and TTL expiry changed other counts. The
count-only evidence is private at
`/tmp/rr-live-aggregate-20260920/redis-live-aggregate.json` (0600 in a 0700
directory), SHA-256
`47d0e26f04281b5fa8c59449deaf9903594b0cbc0e455dcd5abe2097a711c007`.
The live and captured aggregates are diagnostic rather than one cross-system
snapshot. No failed-job identities or causes have been classified;
`queueReconciled` and `businessReconciled` remain false.

The PostgreSQL business-evidence query contract lives in
`scripts/lib/postgres-business-aggregate.mjs`. It requests one read-only,
repeatable-read
PostgreSQL snapshot, fixes `statement_timeout` at five seconds and `lock_timeout`
at one second, and returns only nine physical table row counts plus fixed
active tax-evidence and Stripe-event status counts. Physical table counts
include soft-deleted rows where those tables support soft deletion; they are
not active business-entity counts. Tax/event status buckets exclude deleted
rows. The parser rejects extra fields, non-count data, or output over 8 KiB
and always leaves `businessReconciled: false`. The fixed tax collection-mode
columns are from the later `Migration20260830150000` migration. The query
and parser pass a disposable local PostgreSQL 18 fixture via
`RR_POSTGRES_TEST_BIN=/usr/lib/postgresql/18/bin node --test scripts/postgres-business-aggregate.test.mjs`.
The guarded runner is `pnpm run data:postgres:live-business-aggregate -- --help`.
It requires the seven exact Railway PostgreSQL source IDs, system ID, and
original endpoint fingerprint from the private staging snapshot scope receipt.
It reuses the strict SSH host-key, exact single-deployment/instance/volume,
loopback TLS tunnel and source system-ID guards, adding pre/post Railway and
database identity checks around the query. The returned report includes only
fixed counts, a bounded UTC window and duration, `readOnly: true`, and
`businessReconciled: false`; failures reveal no connection string, token,
query error or row data. Its mocked local boundary tests run in the shared
CI contract, while the SQL itself has the disposable PostgreSQL fixture test.
The live run followed the schema and count-cost rehearsal below. It used the
same exact source IDs and endpoint fingerprint as the verified staging
snapshot. The wrapper checked Railway deployment, instance, volume and
database system ID before and after the read-only query. At 04:35:53–04:35:58
UTC it counted 68 carts, 49 payment collections, 44 sessions, seven each of
orders, payments, captures, order-cart links and order transactions, and zero
refunds. The snapshot receipt had 67 carts and identical counts for the other
eight physical tables. The live query also counted two active succeeded tax
quotes in collection mode and ten active ignored Stripe lifecycle events;
all other fixed event statuses and livemode were zero. These counts contain
no row identities and do not establish whether the ignored events need
action. The private count-only evidence is
`/tmp/rr-pg-live-business-20260920.0JLSyT/counts.json` (0600 in a 0700
directory), SHA-256
`2a6365434aa9c9b2ca5cc0a2dad5cb5f63653cd036fef838833ee0e5386b821f`.
The five-second statement timeout bounds query work but these small staging
tables do not prove a production-scale cost. A future least-privilege role
must retain guarded `pg_control_system()` access or use a reviewed equivalent
identity check. Comparing identified Medusa payments and tax evidence with
bounded Stripe test-mode reads requires a separate privacy-preserving step;
`businessReconciled` remains false.

An offline measurement on September 20 reused the previously verified private
staging snapshot and a fresh, isolated PostgreSQL 16.15 restore. The target had
no network or published port, and its system ID differed from the source.
The one-shot restore and independent check matched all 171 physical tables.
The aggregate parsed successfully on that staging schema in three local psql
runs of 22.14, 12.49 and 20.57 ms. `EXPLAIN ANALYZE BUFFERS` reported 3.952 ms
planning, 0.573 ms execution, 29 shared buffer hits and zero reads for its
small tables. The owned target container, volume and directories were removed
and independently found absent. This is a small restored-data baseline under
a superuser; a future least-privilege/RLS identity may see different rows, and
these timings do not bound production-scale counts. No live aggregate or Stripe
comparison was run.

### Recovery policy

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
