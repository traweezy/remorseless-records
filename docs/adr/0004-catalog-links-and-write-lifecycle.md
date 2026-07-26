# ADR 0004: Use stable read-only links and compensated authoring workflows

- Status: accepted
- Date: 2026-07-26
- Scope: catalog-to-commerce associations and multi-module Admin writes

## Context

Catalog, shelf, bundle, media, and discography records already store Medusa
Product or Product Variant IDs. Medusa cannot query these associations as
module relationships because link definitions do not exist. The legacy
authors also perform multi-module writes as unrelated HTTP requests.

## Decision

- Existing custom-owned `product_id` and `variant_id` fields are represented as
  Medusa read-only module links. These IDs are the association authority.
- Mutable handles, titles, SKUs, and inventory snapshots are never association
  authorities.
- Discography adds a stable Product ID and explicit source mode. Storefront
  links resolve the current Product handle from the Product ID and are omitted
  when the Product is unavailable.
- Multi-module authoring commands run in a Medusa workflow.
- A command validates the complete desired state before its first mutation.
- Every mutating step carries compensation data. Compensation restores the
  prior custom record and reverses any completed link or native-commerce
  operation.
- Commands require an idempotency key and expected aggregate version.
- Successful workflows enqueue search/media projections only after canonical
  writes succeed.
- Errors use a stable problem shape with field, domain, conflict, and
  compensation categories. Raw infrastructure errors are not returned to the
  Admin client.
- Read-only impact and drift endpoints precede destructive or high-impact
  commands.
- Old reads remain available during the parity window. Old writes are disabled
  only after the new workflows pass failure injection at every step.

Read-only links are used instead of stored pivot links because the custom
record already owns the foreign ID. This avoids two independently mutable
representations of the same relationship.

## Consequences

Medusa Query can retrieve custom and commerce data across module boundaries,
while existing rows remain compatible. `db:sync-links` becomes a release
operation and is not hidden in ordinary application startup.

Workflow compensation is not a substitute for database constraints or drift
checks. Additive constraints, reconciliation reports, and scheduled checks are
still required.

## References

- [Medusa read-only module links](https://docs.medusajs.com/learn/fundamentals/module-links/read-only)
- [Medusa workflow compensation](https://docs.medusajs.com/learn/fundamentals/workflows/compensation-function)
- [Extending the create-product flow](https://docs.medusajs.com/learn/customization/extend-features/extend-create-product)
