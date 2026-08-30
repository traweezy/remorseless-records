# ADR 0005: Manage product media and rebuild discography from catalog releases

- Status: accepted
- Date: 2026-07-26
- Amended: 2026-08-30
- Scope: Big Cartel product images and storefront discography

## Context

Every current product image and thumbnail depends on Big Cartel. Big Cartel
publishes multiple renditions, and aggressive fetching risks rate limiting.
The existing 12 discography records all contain stale product handles and are
not useful historical records.

## Decision

### Media

- Inventory every Big Cartel URL and its known renditions before downloading.
- Measure every storefront and Admin use and select the smallest source
  rendition that satisfies the largest rendered size plus responsive-image
  headroom. Preserve a larger master only when a real use requires it.
- Use Big Cartel's constrained `w=2000` rendition as the managed master. The
  largest direct render is the 520px product-detail gallery; 3x displays need
  1,560px before headroom. Big Cartel does not upscale smaller originals.
  Next Image owns the smaller responsive derivatives used by cards, cart,
  checkout, thumbnails, and discography.
- Use a per-host token bucket with bounded concurrency, jitter, request
  timeouts, `Retry-After`, and exponential backoff. The migration is resumable
  and idempotent.
- Validate HTTP status, declared content type, file signature, byte limit,
  dimensions, and SHA-256, then pass the source through the same bounded Sharp
  worker as Admin images. Publish only a re-verified, metadata-free WebP.
- Deduplicate normalized bytes by checksum. State schema version 2 records both
  source and normalized evidence and rejects pre-hardening staged state.
- Store managed bytes through Medusa's file provider and retain an old URL to
  managed asset manifest for rollback.
- Cut product images and thumbnails over only after every required association
  has a verified managed asset.
- Remove Big Cartel from runtime image and CSP allow-lists only after the parity
  report reaches zero unresolved required assets.

### Discography

- Project every published catalog profile with controlled product kind
  `music-release` into exactly one `catalog_product` record keyed by stable
  Product ID.
- Keep `manual` records for historical releases that are not currently sold.
  Manual records never contain or manufacture a customer purchase link.
- Hydrate linked Products in one batch at each API boundary. Expose the current
  handle only when the Product exists and is published; report missing and
  unpublished link health explicitly.
- Reconcile instead of replacing: update linked rows, create missing rows,
  archive stale linked rows, and retain manual records. Preserve an explicit
  operator archive across later catalog reconciliations.
- Default the reconciliation command to dry-run and require the existing
  explicit apply and confirmation flags before changing rows.
- Validate the projection before writing and verify one linked row per
  projected Product ID plus zero active stale linked rows afterward.
- Make all interactive lifecycle changes optimistic-concurrency checked,
  idempotent, serializable, actor-audited, and reversible through archive and
  restore. Disable hard deletion.
- Existing discography-only covers remain outside the product-media migration;
  historical artwork is managed explicitly on the historical record.

## Operational sequence

All commands default to read-only planning. State and rollback manifests default
to `~/.local/share/remorseless-records/` and must remain outside version
control.

1. Inventory and optionally probe a bounded sample:

   ```bash
   pnpm --filter backend media:big-cartel:migrate
   pnpm --filter backend media:big-cartel:migrate -- --probe=2
   ```

   A probe downloads, deeply decodes, normalizes, and verifies the sample but
   does not store a file or change a database record. Source responses are
   capped at the smaller of `--max-bytes` and the 12 MiB managed-upload limit.

2. Stage the complete, throttled, resumable set through Medusa's File Module:

   ```bash
   pnpm --filter backend media:big-cartel:migrate -- \
     --stage \
     --confirm-stage=stage-big-cartel-managed-media
   ```

   `--max-assets=N` is permitted only for a non-cutover staging test.

3. Cut over only after the state file contains every current source:

   ```bash
   pnpm --filter backend media:big-cartel:migrate -- \
     --apply \
     --confirm-cutover=replace-big-cartel-runtime-media
   ```

4. Review the exact current-to-catalog reconciliation plan, then reconcile
   discography:

   ```bash
   pnpm --filter backend discography:build
   pnpm --filter backend discography:build -- \
     --apply \
     --confirm-replace=replace-discography-from-catalog
   ```

5. Require zero unresolved Big Cartel references and 1:1 discography Product ID
   parity before removing Big Cartel from the Storefront image/CSP allow-lists.

## Staging acceptance evidence

The read-only acceptance run on 2026-08-30 used the current staging database
and the hardened local scripts with public Railway endpoints supplied only in
process memory:

- managed-media inventory found zero Big Cartel sources across native Product
  thumbnails/images, Catalog assets, Variant profiles, artists, and News. The
  empty-source inventory fingerprint is `e3b0c44298fc`;
- discography planning found 442 current active entries and 442 projected
  music-release profiles, zero unpublished music profiles, zero creates,
  updates, or archives, and 20 intentionally excluded non-music profiles; and
- both scripts completed in dry-run mode and explicitly reported no file or
  database-record changes.

This satisfies the zero-runtime-reference and 1:1 Product-ID parity gates. A
future Catalog change can reopen either gate, so both planners remain required
before removing or changing media/search allowlists.

## Consequences

The storefront no longer depends on Big Cartel at runtime, image choices are
based on actual rendered needs, and migration traffic is deliberately polite.
Discography becomes deterministic and lifecycle-aware without sacrificing
historical releases. Store Products remain authoritative for purchasable
releases, stale Product links cannot become customer 404s, and operator changes
are recoverable and audited.

The prior database dump, JSON manifests, and media URL map must be retained
outside version control through the rollback window.

## References

- [Medusa File Module](https://docs.medusajs.com/resources/architectural-modules/file)
- [Medusa S3 file provider](https://docs.medusajs.com/resources/infrastructure-modules/file/s3)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Sharp input safety controls](https://sharp.pixelplumbing.com/api-constructor/)
- [Node.js permission model](https://nodejs.org/api/permissions.html)
- [Big Cartel API image sizing and rate guidance](https://developers.bigcartel.com/api/v1)
- [Big Cartel Theme API image constraints](https://developers.bigcartel.com/api/themes)
