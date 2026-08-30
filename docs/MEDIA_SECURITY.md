# Managed media security and lifecycle

Last reviewed: 2026-08-30

## Scope and goals

This runbook covers images accepted by the Catalog creation workflow, News
editor, and Big Cartel migration. It also defines the lifecycle policy for
unlinked Catalog media. The security goal is that no client-supplied or remote
source image reaches public object storage until a bounded decoder has produced
and re-verified a new metadata-free image. CSV product-import files continue to
use the generic managed-upload endpoint, but images and CSV files must use
separate requests.

The operational objectives are:

- reject malformed, mismatched, animated, or resource-exhausting inputs;
- keep normalization within an eight-second wall-clock deadline per image;
- publish only a newly encoded WebP with an opaque storage key;
- preserve source and normalized SHA-256 evidence without logging filenames or
  raw error/provider payloads; and
- make orphan removal reversible for at least 30 days and never automatic.

## Image acceptance pipeline

1. Multer bounds the multipart request before application parsing: at most 10
   files, 12 MiB per input, 20 MiB combined, one small text field, and no disk
   buffering.
2. Boundary validation requires a path-free filename, an allow-listed
   extension/media-type pair, an allow-listed MIME type, and the expected magic
   bytes. This is a fast rejection layer, not the trust decision.
3. Each image is sent to a separate Node process. Linux `prlimit` caps virtual
   address space at 2 GiB, CPU at 10 seconds, open file descriptors at 64, and
   core dumps at zero. The parent kills the process after eight seconds and
   bounds both stdout and stderr.
4. The worker runs Node's permission model with no network, filesystem-write,
   child-process, or worker permission. It receives only the upload module and
   dependency tree as readable paths. Sharp uses the bundled libvips, disables
   caching, uses one processing thread, and enables libvips untrusted-input
   blocking.
5. Sharp fully decodes the source with `failOn: "warning"`. The worker permits
   one frame, four channels, a 12,000-pixel maximum dimension, 32 million total
   pixels, and an estimated 128 MiB maximum decoded representation.
6. The worker auto-orients, bounds the longest output edge to 3,000 pixels,
   re-encodes WebP, and applies a six-second libvips operation timeout. Sharp's
   default output path omits EXIF, ICC, IPTC, and XMP metadata.
7. A second decoder pass verifies the new bytes are a single-frame WebP within
   8 MiB and that prohibited metadata is absent. The parent independently
   checks the worker's strict response schema, decoded byte length, and SHA-256.
8. Only the verified WebP is passed to Medusa's File Module. The original is
   released from memory and is never written to application or object storage.

This is a defense-in-depth process boundary, not a claim that Node permissions
can contain a compromised native library. The native decoder is additionally
bounded by the OS process limits, libvips input policy, explicit image limits,
and parent deadline. The pipeline fails closed when Linux `prlimit`, the pinned
Sharp runtime, or the worker artifact is unavailable.

## Persistence and audit evidence

Catalog assets store the normalized size, dimensions, MIME type, SHA-256, and
opaque File Module key. Bounded metadata records the original format, size,
dimensions, channels, frame count, MIME type, and SHA-256 plus the
`sharp-webp-v1` safety-pipeline version. Original bytes and client filenames are
not included in logs.

Catalog uploads retain their UUID idempotency and authoring-operation audit
record. News and Catalog normalization emit the low-cardinality
`managed_image.normalization` event with route class, accepted/rejected result,
file count, duration, and accepted byte totals. Alert when rejection rate or
duration changes materially; do not alert on a single invalid client image.

## Big Cartel migration

The migration uses the same worker before probe reporting or staging. State
schema version 2 records normalized and source hashes, sizes, formats,
dimensions, and `sharp-webp-v1`. Version 1 state is rejected so raw staged bytes
from the pre-hardening pipeline cannot be reused. Deduplication is based on the
normalized checksum, and every new object is WebP.

Dry-run inventory remains read-only. `--probe=N` downloads and normalizes only
the bounded sample without storing it. Staging and cutover remain separate,
explicitly confirmed operations described in ADR 0005. A cutover is not
accepted until the post-write inventory reports zero Big Cartel runtime URLs.

The 2026-08-30 staging acceptance found zero Big Cartel sources across every
inventoried surface. The same read-only run found 442 current and 442 projected
discography entries with no proposed mutations, zero unpublished music
profiles, and 20 correctly excluded non-music profiles.

## Quarantine retention and purge policy

Quarantine is the only client-facing removal action. It requires an unlinked
asset, expected-version match, UUID idempotency key, authenticated actor, and
the `media_cleanup:update` capability. It records the actor and time and sets
`purge_eligible_at` to 30 days later. Restore remains available throughout the
retention window and after eligibility while the object still exists.

Physical purge is intentionally unavailable in the Admin and API. Eligibility
is a review date, not a deletion schedule. A future purge implementation must
remain disabled until all of these controls exist and have staging evidence:

- a successful off-site media backup and checksum-verified restore drill;
- a dry-run manifest listing exact asset IDs, File Module keys, checksums,
  quarantine actors/timestamps, and linkage recheck results;
- an independent review plus an explicit apply confirmation immediately before
  deletion;
- a second expected-version and unlinked-state check under the Catalog lock;
- a durable authoring-operation audit record for requester, reviewer, exact
  manifest checksum, object deletion result, and retained Catalog tombstone;
- bounded batches, provider timeouts, idempotent retry/reconciliation, and an
  abort on any ambiguous provider acknowledgement; and
- a legal/incident hold that prevents purge regardless of eligibility.

Until those prerequisites are complete, operators may quarantine, restore, or
expand storage but must not manually delete File Module objects.
The off-site checksum, version-history, restore-sampling, and full-drill
contract is defined in
[`INFRASTRUCTURE_RECOVERY.md`](INFRASTRUCTURE_RECOVERY.md#media-backup-and-restore).

## Verification

For every release that changes this boundary:

1. Run the image-normalization, route, upload-workflow, middleware, Admin query,
   and migration-helper tests.
2. Run Backend lint, strict TypeScript, the full Backend suite, and a production
   Backend/Admin build. Confirm the built server contains
   `image-sandbox-worker.js` beside `constraints.js`.
3. Exercise valid metadata-bearing input, corrupt magic-valid input, declared
   MIME mismatch, and resource-limit rejection.
4. Inspect a resulting object with an independent Sharp metadata pass and
   confirm WebP, one frame, bounded dimensions, and no EXIF/ICC/IPTC/XMP.
5. In staging, review exact-deployment logs for low-cardinality normalization
   events and run the ADR 0005 inventory/probe without apply flags.

### Staging acceptance (2026-08-30)

Commit `299107f7dde879e1386511f86cf380a52970eae0` passed GitHub Root CI run
`33330002489`, Backend CI run `33330002511`, and Storefront CI run
`33330002505`. Railway accepted these exact artifacts:

- Backend deployment `909b9ff5-d86d-4f8d-a99c-24dec7d9037c`, image digest
  `sha256:47295cb9409b537ae32342ac2988b4542b6305fc7765e9bfc3bd3d5fcd4ac113`;
- Storefront deployment `1840fd58-ad54-456b-8147-3a557c33d0e2`, image digest
  `sha256:314394c935bc993b0a039e7c91b8ccd34ac6ebac114ef48ba980577ec605f307`.

Backend `/ready` returned `status=ok`, the exact commit version, and healthy
database, Redis, search, object-storage, payment, tax, notification,
payment-lifecycle, search, object-storage, and Admin-RBAC checks. Storefront
`/live` and `/ready` returned the same exact version with healthy Backend and
Redis dependencies. Predeploy logs completed migrations, storage readiness,
and a validated 461-document zero-downtime search rebuild before the server
became ready.

An in-memory SSH smoke test used the deployed Node 26.5.0 runtime, deployed
`image-sandbox-worker.js`, and `/usr/bin/prlimit`. It decoded a 20-by-40 PNG
through `normalizeManagedImageUpload` and returned a 74-byte, one-frame
20-by-40 WebP named `staging-smoke.webp`. It made no object-storage or database
write.

## Research basis

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Sharp input constructor and safety limits](https://sharp.pixelplumbing.com/api-constructor/)
- [Sharp input metadata](https://sharp.pixelplumbing.com/api-input/)
- [Sharp output and metadata behavior](https://sharp.pixelplumbing.com/api-output/)
- [Sharp supported-version security policy](https://github.com/lovell/sharp/security)
- [Node.js permission model](https://nodejs.org/api/permissions.html)
- [Node.js child-process cancellation](https://nodejs.org/api/child_process.html)
- [Medusa File Module](https://docs.medusajs.com/resources/architectural-modules/file)
