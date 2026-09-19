# PostgreSQL logical restore acceptance

Use this workflow for a trusted custom-format archive and an owned, empty,
disposable PostgreSQL database on the **same server major** as its source.
The archive source must be quiesced before `pg_dump` starts and remain quiesced
until the receipt has been captured. Otherwise the post-export row counts may
describe a different state from the archive. The receipt cannot retroactively
establish consistency for an earlier export. Keep the source and target isolated
from application workers, providers, and other writers throughout the drill.

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
