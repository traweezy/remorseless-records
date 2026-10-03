# Staging historical credential retirement

Batch 5 started October 3, 2026. This is the coordinated maintenance record;
the final exact-revision acceptance belongs in the session handoff. A planned
step below is not evidence that a credential has been revoked.

## Evidence and repeatable audit

Historical commit `29157d5f49fb5edcaeb398318f2debb038e7d10f`, file
`logs.1761315253377.json`, contains a serialized application configuration.
The separate Railpack `plan.secrets` array contains variable names only.
Do not mistake that names-only inventory for exposed values or print the
serialized configuration while investigating it.

`pnpm run data:staging:credentials:audit -- --require-retired` verifies the
existing Railway `store`/`staging` identity and all nine exact service IDs,
then compares the exposed values with rendered service variables in memory.
It recognizes scalar credentials and decoded PostgreSQL/Redis URL passwords,
including relocated values. Reports contain fixed credential-family labels,
never values, hashes, provider errors or raw variable payloads. Missing scope,
malformed evidence or unresolved references fail closed. Exit 2 means an
exposed credential remains configured; exit 1 means evidence is unavailable.
`--help` performs no provider or credential reads.

The October 3 20:38:55 UTC baseline found five active families:

| Family | Current consumers / canonical configuration |
| --- | --- |
| Redis password | Redis `REDIS_PASSWORD`, its alias and private URL; Backend and Storefront references |
| PostgreSQL administrator password | Postgres `POSTGRES_PASSWORD`, `PGPASSWORD` and administrator URLs; isolated application, migration and backup roles already use different credentials |
| Object-store root password | Bucket `MINIO_ROOT_PASSWORD`; Backend, Console and RecoveryBackups references |
| Admin JWT signing | Backend `JWT_SECRET` |
| Admin cookie signing | Backend `COOKIE_SECRET` |

The exposed Resend key no longer matches configuration; its earlier provider
revocation remains separately recorded. The object-store username/access-key
identifier is informational, not a password. Stripe and Meilisearch key names
in the Railpack inventory do not prove their values were exposed. A successful
configuration comparison alone **does not prove running-process replacement,
old-key rejection, session invalidation or provider revocation**.

Redis's unused public `REDIS_URL`, `REDISHOST` and `REDISPORT` still referenced
the removed TCP proxy. On October 3 at 20:35:57 UTC those three user-configured
fields were removed with deployments skipped, after proving no retained field
in any service referenced them and rechecking the exact eight-field source.
The five retained fields and private application references were read back
unchanged. No password or running process changed during this cleanup.

## Recovery checkpoint

Before rotation, a guarded PostgreSQL 16 snapshot and encrypted Railway archive
completed. Archive `2922fe95-e2d9-4888-ac89-b2d5312f8365` contains four database
files and 1,168 media objects (438,620,004 plaintext bytes); ciphertext readback
verification passed. The database dump SHA-256 is
`77acf4361d80785d4050c877c04917ea5d3574999872c1c97074fc339267636a`.
Private evidence starts with `/tmp/remorseless-batch5-before-rotation-`.
This is a fresh verified archive, not a new full restore or native snapshot.
Batch 2's full restore and the recorded native snapshot quota limit remain.

## Coordinated cutover and acceptance

Pre-push local checks passed: shared lint/types/policy, seven new credential
audit fixtures, Backend coverage (287 suites / 2,290 tests), Storefront coverage
and both production builds. Complete disposable integration passed on freshly
scanned exact PostgreSQL/Redis images, including all six native Medusa session
rotation checks. The host's Docker publication issue required the existing
strict private loopback Docker-exec relay; all 167 PostgreSQL and 22 Redis
connections closed, with zero relay failures and complete fixture cleanup.
Initial wrong-context and scanner-version attempts failed their guards before
service tests; the corrected run did not relax those guards.

Use the pinned CLI and existing target guards. Keep new random values in
scoped process memory and send them through stdin; do not put credentials in
arguments, logs, repository files or application-wide environment exports.
Read canonical references before every mutation, recheck identity, and retain
only redacted receipts. Preserve independent application/backup credentials,
checkout/cart/receipt secrets and archive encryption keys.

1. Complete the batch's normal local gates and one direct staging push. Wait
   for all four exact-revision workflows / 23 checks. Observe all nine
   service/job states throughout configuration maintenance.
2. Redis may temporarily accept both passwords through its native ACL while
   the canonical reference changes. Deploy consumers with the new password,
   then restart the same pinned Redis release with only the new password.
   Verify fresh new-key authentication, fresh old-key rejection, UID 1000,
   stable process identity, persistence and retained queues. Do not restore a
   historical floating image or discard writes to recover a failed cutover.
3. Change the PostgreSQL administrator password and its canonical Railway
   configuration together. Verify fresh private-network password-authenticated
   connections: new succeeds and old fails. Loopback trust authentication is
   not rejection evidence. Keep runtime, migration and backup role boundaries;
   do not redeploy a floating PostgreSQL image for a password-only change.
4. Rotate JWT and cookie signing secrets together, drain every old Backend
   instance and reject controlled pre-rotation bearer and cookie credentials.
   Verify new native session issuance and deletion. A synthetic signed token
   exercises middleware only; actual provider/account sign-in requires its
   own evidence. Follow [the native session contract](CHECKOUT_OPERATIONS.md#secret-and-webhook-rotation).
5. Rotate the Bucket root password and redeploy all referenced consumers.
   Preserve the running image by verified immutable digest; do not pull
   `latest` during this credential change. Verify new S3 access and old-key
   denial, object inventory/read parity, Console and the backup runner. A
   digest pin does not resolve the existing MinIO vulnerability carryover.
6. Re-run the strict configuration audit, process credential checks, exact-SHA
   migration receipt, normal scheduler/catalog, browser smoke and correlated
   logs. Verify backup execution with the new media credential and check every
   supporting service/job. Record any maintenance failures and their recovery;
   do not replace them with only the successful final attempt.

Do not call batch 5 accepted until live rejection and deployment evidence is
recorded. Keep dependency upstream blockers in the
[carryover register](PRODUCTION_HARDENING_PLAN.md#carryovers-between-batches).

## First submitted revision

Conventional Commit `960fe7bbc47b912770c8357c148f5bd6cb75b3f8` was pushed directly
to staging with both normal hooks. The first Storefront workflow attempt
(`37152539210`, accessibility job `111289619032`) failed during its build,
before pa11y ran: Next's Google font loader could not match a filename extension
on a downloaded font URL (`loader.js:122`). The independent build job on the
same SHA passed. Preserve the failed attempt; a later successful retry would
prove that job completed, not remove the external build-network dependency.
No credential cutover is accepted by this submission record.

## Initial storage cutover blocked — October 3, 21:01 UTC

The running Bucket uses MinIO `RELEASE.2025-09-07T16-13-09Z`, image digest
`sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`
and `/usr/bin/minio` SHA-256
`7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f`.
Fresh public-registry reads could not fetch the current digest or release.
Railway advertised the current deployment as redeployable, but an explicitly
guarded `usePreviousImageTag` probe still failed while pulling `minio/minio`.
That flag is not a guaranteed retained-artifact recovery mechanism.

Probe deployment `235c3639-c726-4232-b102-b04eb45e3ad3` failed without replacing
the original deployment `5e2bf986-15d4-48a0-9bdd-a3cfac16e041`. Its allocated
instance was removed; the original instance remained RUNNING and public live
health returned 200. The probe's nonsecret environment marker and temporary
source digest pin were removed, the original source was read back, and the
failed candidate was removed. The original password, data and service were
preserved. Private failed-attempt and cleanup receipts remain under
`/tmp/remorseless-batch5-minio-` and in the all-service history.

**At 21:01 UTC the historically exposed storage root password remained active.** Backend,
Console and RecoveryBackups retained its references. This was `B5-MEDIA`, not a
successful rotation or a scanner exception. Resolve deployable image/storage
recovery before rotating it; do not restart the sole healthy container without
a recovery artifact. Independently finish the PostgreSQL, Redis, JWT and cookie
rotations, while keeping storage retirement and maintained replacement as
explicit gates before client cloning and launch.


## Accepted credential maintenance — October 3, 21:38 UTC

Revision `960fe7bbc47b912770c8357c148f5bd6cb75b3f8` passed all four workflows and
23 checks. Storefront's failed accessibility build passed on its targeted
same-SHA rerun; the original Google-font failure remains `B5-FONTS`.

PostgreSQL's administrator password was replaced without restarting its
floating image. Fresh private-network SCRAM authentication accepted the new
password and rejected the historical one. Application, migration and backup
roles retained their separate credentials and authority. Redis temporarily
accepted both passwords while consumers deployed, then restarted the same
pinned 8.10.2 release with one new password. Explicit old-password `AUTH`
returned `WRONGPASS`; new authentication passed. An initial connection-error
classifier did not establish denial and is retained separately from that proof.

JWT and cookie signing keys changed together; old Backend instances drained.
Controlled old bearer/cookie credentials failed, while new native sessions
worked. An owned role-free user also completed real email/password provider
sign-in; an incorrect password failed, Admin products access returned 403,
and the owned user/auth identity/session were removed. The user subsequently
signed into the existing Admin account for batch 6. No maintenance account
password is stored in application configuration.

### Storage root API retirement without a container restart

The exact installed MinIO source supports a dynamic `api root_access=off`
setting. Independent native IAM users (not root-derived service accounts)
were created: `rr-app-20261003` has read/write/delete access only to
`medusa-media`; `rr-backup-20261003` has list/read access only; and
`rr-ops-20261003` has native Console administration. Each has a different
random secret. Backend, RecoveryBackups and Console no longer reference root.
Owned disposable objects proved app write/read/delete, backup read and backup
write denial; they were removed. Both users saw the unchanged 1,168-object
inventory and sample checksum.

At 21:33:47 UTC the root API was disabled dynamically, with unrelated API
settings unchanged. Old-root Admin access returned `InvalidAccessKeyId` with
the exact disabled-account message, old-root S3 access returned 403, and old-root
Console login returned 401. The first negative check expected the internal
`AccessKeyDisabled` enum rather than its wire code; its failure is retained.
The [exact release's error mapping](https://github.com/minio/minio/blob/RELEASE.2025-09-07T16-13-09Z/cmd/api-errors.go)
and fresh rejection checks resolved that verifier error.

The stored Railway root password was replaced and `MINIO_API_ROOT_ACCESS=off`
set with deployment skipped. **The running Bucket still has the historical
root secret in its process; its root API is disabled.** This is verified API
revocation and future-start configuration retirement, not proof of a replaced
process secret or a maintained image. Do not restart the sole healthy Bucket
until a deployable recovery/migration artifact exists (`B3-MINIO`, `B5-MEDIA`).

Console's real login, session, bucket listing and logout passed locally inside
the unchanged container. Its listener is IPv4-only while private DNS returns
IPv6, so Backend-to-Console access was refused. It has no public domain.
This pre-existing connectivity gap remains `B5-CONSOLE`; authentication proof
used guarded loopback, not a working browser/network access claim. The image's
`USERNAME`/`PASSWORD` configuration is unused by its installed v1.7.6 source;
login uses submitted credentials. Its floating Go/Console build was not rerun.

The strict audit passed at 21:36:12 UTC with all historically exposed values
absent from configuration. Actual Backend process credentials matched the new
values. Redis retained its post-rotation run identity through 1,111 seconds
uptime, UID 1000, healthy AOF/RDB, zero OOM/high/max events, evictions and rejected
connections. Its cgroup limit is page-rounded to 999,997,440 bytes from the
provider's 1 GB limit. `/proc` credential environment was unreadable; binary
hash evidence measured the installed executable, not `/proc/PID/exe`.
The 237 scheduled and one event terminal failures remain intact.

### Release and recovery acceptance

Exact-SHA deployments are Backend `13c79dd6-cb5a-43da-b082-4146424fecca`,
Storefront `3ed20860-1abc-4ff2-a008-ca1ba9f79227`, Migrations
`1bd03b0c-ebe2-4314-9140-9230df017216`, and RecoveryBackups
`05cb7aac-6a43-4118-85b8-091518dfa119`. The latter's execution
`53982889-b78a-47be-b760-6735d4abb6a1` exited at 21:36:55 UTC after publishing
archive `15563662-660f-4a52-ba04-b9c1b4b6a783`: four database files and 1,168
media objects, receipt SHA-256
`af8d424c1f698ce8364f9c4cd8bcf027ad1469d452b15ef386b43cd3f36daf1c`.
This proves backup operation using the restricted media user after root
revocation; it is not another full restore or the first calendar-triggered run.

Runtime packages, database authority/ancestor boundaries, migration receipt,
notification-key restriction, installed Next patch, ordinary 21:32 scheduler
heartbeat and catalog passed. All nine services/jobs were verified, including
completed Migrations and RecoveryBackups. The first browser attempt had two
cold-chunk flakes (home shelves and quick shop); both traces remain. The
unchanged repeat passed all 85 cases with eight documented skips and zero
retries/flakes; selected desktop/mobile screenshots were inspected. This is
release smoke coverage, not batch 6's exhaustive acceptance.

Correlated application logs from 21:37:15 through 21:37:39.477 UTC had zero
HTTP 5xx, stream-close errors, unknown warnings/errors or truncation. An earlier
HTTP-log correlation check had not observed its row; the replacement uses
bounded polling with the same exact correlation assertions. A local verifier
scope error is retained. Supporting logs contained one client-reset/open-
transaction EOF pair during the successful backup, consistent with the
read-only snapshot exporter's documented SIGKILL close; it is not evidence of
a database restart. Six Meilisearch HTTP-2xx INFO rows were classified from their
native level rather than Railway's stderr label.

Durable private evidence, including first failures, redacted receipts, browser
artifacts and a checksum manifest, is in
`artifacts/staging-2026-10-03/batch5-960fe7b/` (ignored, directories mode 0700,
files 0600). Closing documentation joins batch 6's substantive push.
