# ADR 0005: Manage product media and rebuild discography from catalog releases

- Status: accepted
- Date: 2026-07-26
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
- Use a per-host token bucket with bounded concurrency, jitter, request
  timeouts, `Retry-After`, and exponential backoff. The migration is resumable
  and idempotent.
- Validate HTTP status, declared content type, file signature, byte limit,
  dimensions, and SHA-256 before upload.
- Deduplicate identical bytes by checksum.
- Store managed bytes through Medusa's file provider and retain an old URL to
  managed asset manifest for rollback.
- Cut product images and thumbnails over only after every required association
  has a verified managed asset.
- Remove Big Cartel from runtime image and CSP allow-lists only after the parity
  report reaches zero unresolved required assets.

### Discography

- Export the current records for rollback, then replace all active
  discography records.
- The new discography is a projection of every active catalog product profile
  whose controlled product kind is `music-release` and whose Medusa Product
  exists.
- Produce exactly one active discography record per Product ID.
- Set source mode to `catalog_product`; resolve storefront URLs from the
  current Product handle at read time.
- The replacement command defaults to dry-run and requires explicit apply and
  replacement confirmation flags.
- The command validates all projected rows before changing any current row and
  emits removed, created, skipped, and conflict manifests.

## Consequences

The storefront no longer depends on Big Cartel at runtime, image choices are
based on actual rendered needs, and migration traffic is deliberately polite.
Discography becomes deterministic and update/delete-aware instead of an
append-only manual copy.

The prior database dump, JSON manifests, and media URL map must be retained
outside version control through the rollback window.

## References

- [Medusa File Module](https://docs.medusajs.com/resources/architectural-modules/file)
- [Medusa S3 file provider](https://docs.medusajs.com/resources/infrastructure-modules/file/s3)
