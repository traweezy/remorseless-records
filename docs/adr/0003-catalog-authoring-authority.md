# ADR 0003: Establish one catalog authoring authority

- Status: accepted
- Date: 2026-07-26
- Scope: Medusa Admin catalog, product, bundle, media, news, and discography

## Context

The current Admin exposes overlapping native and custom editors. A single
merchant action can update Medusa Product data, catalog profiles, variant
profiles, bundles, links, and media through sequential requests. A failure
after an early request leaves a partially updated product.

Several facts also have competing writable representations, including product
kind, format, availability, release date/year, media metadata, and
discography-to-product relationships.

## Decision

- Native Medusa Product, Product Type, Product Option, Product Variant, Price,
  Inventory, publication status, and backorder fields are the commerce
  authority.
- Catalog models own only editorial and label-domain facts that Medusa does not
  own: artists, controlled vocabulary, release precision, rich editorial copy,
  tracklists, credits, pressing notes, merchandise details, shelves, bundle
  composition, media presentation, and discography projection.
- The native product detail keeps a compact read-only catalog summary and one
  link to a dedicated product-kind-aware catalog editor.
- The standalone legacy Product Authoring page becomes a read-only redirect
  during the rollback window and is then removed.
- Product creation is one four-kind flow: Music release, Merchandise, Fixed
  bundle, or Mystery box.
- Release date is one value plus precision (`unknown`, `year`, `month`, or
  `day`). `release_year` remains a compatibility projection until the contract
  phase.
- Structured tracklist, credits, pressing notes, and merchandise documents
  remain JSON because they are not independently queried. Every document is
  validated against a versioned schema.
- Availability shown to customers is computed from native inventory,
  publication, release date, preorder, and backorder state. Custom
  availability remains compatibility input only until all consumers move to
  the computed projection.
- Internal IDs, source URLs, storage keys, file evidence, cached bundle titles,
  cached SKUs, checksums, and arbitrary metadata are read-only Diagnostics.
- High-impact records use optimistic versions. Commands reject stale expected
  versions rather than silently overwriting newer work.
- Archive/deactivate is the default reversible action. Hard deletion is
  limited to migration or explicitly confirmed cleanup.
- Custom administration writes require an authenticated Admin user. Permission
  checks remain server-side even when the UI hides an action.

No generalized Release aggregate is introduced in this phase. It will be
reconsidered only if multiple sellable products must share an independently
managed release record.

## Consequences

The merchant gets one clear place for each task and each fact gets one source
of truth. Compatibility columns and routes remain readable during an
expand/backfill/cutover window, so rollback does not require restoring the
database.

The dedicated editor and create flow must use consolidated view models and
workflow-backed commands before the legacy editors are made read-only.

## References

- [Medusa module isolation](https://docs.medusajs.com/learn/fundamentals/modules/isolation)
- [Medusa workflows](https://docs.medusajs.com/learn/customization/custom-features/workflow)
- [Medusa Admin UI routes](https://docs.medusajs.com/learn/customization/customize-admin/route)
