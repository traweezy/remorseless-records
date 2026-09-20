# PostgreSQL logical restore acceptance

Use this workflow for a trusted custom-format archive and an owned, empty,
disposable PostgreSQL database on the **same server major** as its source.
The two-command capture path below requires source writes to be quiesced before
`pg_dump` starts and until the receipt has been captured. Otherwise the
post-export row counts may describe a different state from the archive. The
receipt cannot retroactively establish consistency for an earlier export. Keep
the disposable target isolated from application workers, providers, and other
writers throughout the drill.

When application DML must continue, use this **alternative to steps 1–2**. Pause
schema DDL before starting it and until it finishes. The command holds a
read-only exported PostgreSQL snapshot open, imports that same snapshot for the
complete source table/count inventory, and passes it to `pg_dump --snapshot`.
It publishes a private `0700` bundle containing a `0600` custom archive,
manifest, and restore receipt only after all three pass validation:

```bash
DATABASE_BACKUP_URL='<source-backup-role-url>' \
  pnpm run data:postgres:snapshot-backup -- \
    --output-dir /absolute/private/backup-directory
```

Use the three absolute paths emitted by that successful command in steps 3–4.
This shared snapshot makes the dump and row counts consistent despite DML
commits after snapshot export. It does not freeze external systems or make
uncommitted rows visible. A long-running exported snapshot can retain old row
versions on the source, so budget the bounded command deadline and monitor
source load. The command requires trusted `psql`, `pg_dump`, and `pg_restore`
clients matching the source server major. See PostgreSQL's
[`pg_dump --snapshot`](https://www.postgresql.org/docs/16/app-pgdump.html),
[`pg_export_snapshot`](https://www.postgresql.org/docs/16/functions-admin.html),
and [`SET TRANSACTION SNAPSHOT`](https://www.postgresql.org/docs/16/sql-set-transaction.html).

For the Railway staging source, use `data:postgres:staging-snapshot` around that
shared-snapshot command. First read the current Railway project, environment,
Postgres service, sole active deployment and instance, and READY volume
instance/volume IDs. Pause schema DDL, use trusted PostgreSQL 16 clients, and
allow sufficient private local disk for the archive. Run the local command with
Postgres service variables injected by `railway run`; never put the database
URL on a command line or in a shell history entry:

```bash
railway run --project <project-id> --environment staging --service Postgres -- \
  pnpm run data:postgres:staging-snapshot -- \
    --project-id <project-id> --environment-id <environment-id> \
    --service-id <service-id> --deployment-id <deployment-id> \
    --deployment-instance-id <deployment-instance-id> \
    --volume-instance-id <volume-instance-id> --volume-id <volume-id> \
    --output-dir /absolute/private/staging-snapshot-directory
```

The wrapper accepts only the Railway Postgres URL from the matching local
`railway run` scope or one process-only `DATABASE_BACKUP_URL`. It verifies the
existing SSH host key, Railway's sole running deployment and READY volume, and
the remote project/environment/service/deployment/replica IDs. It maps the
original proxy URL to a loopback-only TLS tunnel without logging credentials,
checks the source system identifier before and after capture, and repeats the
Railway scope query before publication. Success emits four private files in
one directory: archive, manifest, restore receipt, and
`source-scope.receipt.json`. The scope receipt binds the original and mapped
endpoint fingerprints, source system identifier, Railway IDs, source major,
and artifact hashes. A failure publishes no accepted bundle. This is a
read-only source capture, not a staging-data restore or retained backup.

1. Create the archive using the existing backup command, preserving its
   private `0600` archive and manifest. Reserve enough disk space for one
   complete additional archive copy during restore.

   ```bash
   DATABASE_BACKUP_URL='<source-backup-role-url>' \
     pnpm run data:postgres:backup -- \
       --output-dir /absolute/private/backup-directory
   ```

   Use the exact archive and manifest paths emitted by the successful command
   in the steps below.

2. While the source remains quiesced, capture a private source receipt. The
   output parent must already exist, be canonical, and have no group or other
   permissions. Use the same source identity as the archive manifest.

   ```bash
   DATABASE_BACKUP_URL='<source-backup-role-url>' \
     pnpm run data:postgres:restore-receipt -- \
       --manifest /absolute/private/postgres.manifest.json \
       --output /absolute/private/postgres.restore-receipt.json
   ```

   The read-only capture records every physical user table and its exact row
   count, plus counts of tables, indexes, sequences, views, constraints, and
   routines. It binds these invariants to the archive SHA-256, source endpoint
   fingerprint, and source server major. It does not modify the source or
   authenticate the archive. A concurrent schema or data change can make the
   receipt inconsistent with the dump; stop and recapture from a new archive.

3. Provision a fresh target through the approved isolated recovery process.
   Independently verify its physical service/volume identity; endpoint
   fingerprints cannot distinguish aliases for one database. Keep it empty and
   block other writers. Run the read-only preflight:

   ```bash
   DATABASE_RESTORE_URL='<disposable-target-url>' \
     pnpm run data:postgres:restore-drill -- \
       --archive /absolute/private/postgres.dump \
       --manifest /absolute/private/postgres.manifest.json \
       --receipt /absolute/private/postgres.restore-receipt.json
   ```

   Record the `confirmation` fingerprint in the dry-run result. The command
   checks receipt/archive/source binding, a checksum-verified private archive
   snapshot, an empty target inventory, and the target's server major. A dry
   run does not restore data.

4. Apply only to that same, still-empty disposable target:

   ```bash
   DATABASE_RESTORE_URL='<disposable-target-url>' \
   DATABASE_RESTORE_CONFIRM='<dry-run-confirmation>' \
     pnpm run data:postgres:restore-drill -- \
       --archive /absolute/private/postgres.dump \
       --manifest /absolute/private/postgres.manifest.json \
       --receipt /absolute/private/postgres.restore-receipt.json \
       --apply
   ```

   The restore uses one transaction without `--clean` or `--create`. Success
   requires the complete restored physical-table list, every row count, all six
   schema counts, and the same server major to match the receipt. A failed
   post-restore comparison returns `target_verification` and no success record;
   the transaction may already have committed. Preserve that target for
   inspection or remove it through its owned-resource cleanup procedure. Do
   not rerun apply against it. A timeout or lost client response likewise
   requires direct target inspection before any retry.

`DATABASE_RECOVERY_TIMEOUT_MS` sets the entire command deadline (default 30
minutes, maximum four hours). `DATABASE_RESTORE_MAX_ARCHIVE_BYTES` bounds the
verified temporary snapshot (default 10 GiB, maximum 1 TiB). The receipt is
limited to 256 KiB and 1,000 lower-snake-case physical user tables. Unsupported
identifiers or incomplete access fail closed. The commands emit fixed phase
names without database errors, credentials, row contents, or SQL values.

For a bundle produced by the guarded staging wrapper, the local
`data:postgres:isolated-target` runner owns a PostgreSQL 16.15 Docker target.
Use a pre-existing canonical `0700` base directory and the four files from
one published source bundle:

```bash
pnpm run data:postgres:isolated-target -- create \
  --base-dir /absolute/private/target-base \
  --source-scope /absolute/private/source-bundle/source-scope.receipt.json \
  --archive /absolute/private/source-bundle/database.dump \
  --manifest /absolute/private/source-bundle/database.manifest.json \
  --receipt /absolute/private/source-bundle/database.restore-receipt.json
pnpm run data:postgres:isolated-target -- verify --target-dir <created-target-dir>
pnpm run data:postgres:isolated-target -- preflight --target-dir <created-target-dir>
pnpm run data:postgres:isolated-target -- apply --target-dir <created-target-dir> \
  --confirm <preflight-confirmation>
pnpm run data:postgres:isolated-target -- verify --target-dir <created-target-dir>
pnpm run data:postgres:isolated-target -- cleanup --target-dir <created-target-dir>
```

Keep the created target until its restore evidence and application acceptance
have been reviewed; `cleanup` is explicit. The runner accepts only the pinned
local Docker `default` Unix daemon and exact scanned image ID, then checks the
source scope/hashes and the target's distinct PostgreSQL system identifier,
major, locale and collation version. It creates a named owned volume and a
private Unix socket with no Docker network, published port, provider secret, or
worker. Each dry-run/apply takes hash-checked private copies of all four source
files. Apply is single-use even after an interrupted or ambiguous result; use
`verify` or inspect the owned target, then clean up rather than retrying apply.
`verify` after restore rechecks the complete receipt inventory. Local free
space is checked and archive input is capped at 512 MiB, but the Docker volume
has no hard disk quota. This isolated database check does not itself prove
application startup, payment/provider behavior, durable backup retention, or
production recovery time.

These checks detect missing/extra physical tables, row-count drift, and broad
schema drift. Matching counts do not prove byte-for-byte row equality, exact
constraint definitions, permissions, extension behavior, application startup,
queue reconciliation, or a production recovery duration. Follow with the
approved application, migration, catalog, and health acceptance on the
isolated target. Do not promote the target or retire the source based on this
receipt alone. A private `/tmp` archive is drill evidence, not scheduled or
off-site retention.

As of September 19, 2026, the previously reviewed reduced PostgreSQL 16.15
recovery image is present in the local Docker `default` context by exact image
ID `sha256:76db58e52e571729aa4ab51a5c597189e6f570086345c29b68b358067a6547e8`.
Its private build recipe and original receipt are absent from this session;
the earlier provenance and runtime evidence remain recorded in
[Infrastructure recovery](INFRASTRUCTURE_RECOVERY.md). A fresh Trivy 0.74.0
scan of that exact image ID with the September 19 07:03 UTC database found
zero CRITICAL, HIGH, or UNKNOWN package findings, 46 MEDIUM, and 28 LOW;
the private report is `/tmp/rr-pg16-private-rescan-20260919.json`. This package
scan does not establish complete compiled-server coverage. A separate local
`--network none`, read-only-root, tmpfs-only startup of that exact image
initialized a fresh `en_US.utf8` cluster and returned PostgreSQL `16.15`,
`UTF8`, database collate/ctype `en_US.utf8`, and declared/actual collation
version `2.41` over an internal Unix socket; TCP listening was disabled. The
ephemeral container was removed. This proves fresh-cluster locale parity, not
a durable isolated target, archive restore, application acceptance, or live-data
recovery.
The newly republished official `postgres:16.15-trixie` linux/amd64 image, digest
`sha256:a85daf0dbd5e79586e850e3fe4b21b796799828ad015ce2166aeb98cc24da61c`,
was rejected as a recovery target: Trivy 0.74.0 with vulnerability database
updated September 19 at 07:03:12 UTC found 2 CRITICAL, 82 HIGH, and 3 UNKNOWN
package findings, including findings without listed fixes. At that point the
reduced image had not yet been used for a staging-data restore.

### Staging-data drill — September 20, 2026 UTC

The guarded wrapper captured a fresh source bundle at
`2026-09-20T00:34:18.948Z` from the sole running staging PostgreSQL deployment
`50c57d73-0457-4bdc-8765-99fa22a6c084`, instance
`afc5f0ed-2fb6-4a17-94fb-d34129d0de1e`, and READY volume instance
`b0f2f2a1-8fe2-43ca-a992-bc83bcf2442d`. Its source system identifier was
`7527124368992473123`. The before/after Railway and database identity guards
passed. The private `0600` custom archive is 1,851,532 bytes with SHA-256
`50a2a91629429233bbaa126018f04b3d934187a9eceb3618ab7f9f7f6515417c`.
Its shared-snapshot receipt covers all 171 physical tables, eight sequences,
735 indexes, and 385 constraints. The initial guarded attempts safely published
no bundle while diagnosing PostgreSQL SQLSTATE `54023` for a variadic JSON
constructor with 171 arguments; an ordered aggregate and an actual 171-table
PostgreSQL 16 regression corrected that limit before the successful capture.

The local target used exact image ID
`sha256:76db58e52e571729aa4ab51a5c597189e6f570086345c29b68b358067a6547e8`
with Docker networking disabled, read-only root and no published ports. Its
system identifier `7687409461496528910` differed from the source. Empty-target
verification and checksum-bound dry-run passed. The one-shot restore reported
171 target tables and 171 matching row counts; a separate post-restore verify
rechecked the complete receipt. The source Backend `/ready` remained healthy
on `8dae008e424e7ad3795d401971846650def8bf77`. The runner then removed
only its owned target directory, container and volume; independent checks found
all three absent. The source bundle remains in a private temporary directory
for review; it is neither off-site nor scheduled backup storage.

This proves a staging-data logical archive and isolated same-major row/schema
restore. It does not prove application startup against the target, exact row
values, extension/role fidelity, provider behavior, PITR, or production RTO.

The guarded wrapper and target runner shipped at exact staging revision
`e7a37c2180f890e0562495a5897b3cef7decc5c2`; its CI, deployment,
browser, and bounded runtime acceptance are recorded in the
[session handoff](NEXT_SESSION_HANDOFF.md).
