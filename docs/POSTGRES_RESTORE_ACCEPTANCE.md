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
package findings, including findings without listed fixes. The reduced image
still needs a durable isolated target configured for live restore and
source/target identity proof before a real-data drill. The local PostgreSQL
16.15 integration fixture is not a live-source restore.
