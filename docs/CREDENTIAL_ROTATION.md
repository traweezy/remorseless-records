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
