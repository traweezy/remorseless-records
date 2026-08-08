# Admin customizations

The Medusa Admin includes project-specific workspaces for catalog authoring,
merchandising, discography, news, tax-provider control, tax records, and refund
operations.

## Shared interaction components

Custom Admin forms build on Medusa UI rather than recreating labels, errors, or
dialogs route by route:

- `components/admin-form-field.tsx` owns the label/control association,
  optional marker, hint and error IDs, `aria-describedby`, `aria-invalid`, and
  visible alert semantics. Validation errors are supplied only after the form
  decides they should be visible.
- `components/confirm-action.tsx` owns the Medusa Prompt layout, explicit
  consequence action, pending lock, disabled enforcement, live pending
  announcement, mobile-height boundary, and cancel behavior. Domain forms keep
  ownership of validation, idempotency, and mutation error handling.
- `components/admin-page.tsx` owns the single-column route rhythm plus
  responsive page and section header hierarchies for titles, descriptions,
  statuses, and actions.
- `components/admin-empty-state.tsx` owns the announced empty-state
  label/description relationship, heading depth, optional icon, and recovery
  action.
- `components/admin-retry-state.tsx` owns the announced error presentation and
  a real retry button that locks while a replacement request is pending.
- `components/admin-responsive-data-table.tsx` owns the responsive collection
  boundary: Medusa's native `DataTable` table and pagination on desktop, the
  route's purpose-built card/list presentation on mobile, and one controlled
  table instance across both surfaces. Routes still own validated server
  queries, columns, mobile content, empty-state copy, and mutation safeguards.

Tax Control is the first form/confirmation consumer. Tax Control and Tax
Records share the page, layout, and retry-state components. Media Cleanup and
Refund Operations also use the shared page and retry hierarchy; their
collection-specific empty states use the shared empty-state component. Domain
queries still own skeletons shaped like their final content and the conditions
that distinguish an initial load from a recoverable failure. New custom forms
and routes should extend these components instead of copying their
accessibility wiring.

Media Cleanup is the first responsive data-table consumer. Its page index and
page size remain controlled inputs to the server query, while the response
count drives Medusa's native previous/next availability. Switching lifecycle
views resets to page one, empty collections omit pagination, and moving the
last item off a later page returns the operator to the preceding valid page.
On mobile, changing pages returns the operator to the collection start with a
reduced-motion-safe transition instead of inheriting the prior page's bottom
scroll position. The shared wrapper is presentation-only and must not initiate
collection queries or mutations.

## Operations and refunds

`routes/operations/page.tsx` is the permission-aware overview for Tax records,
Refunds, and Media cleanup. `routes/refund-operations/page.tsx` retains the
shared read-only operator guide and reconciliation queue plus the compatibility
redirect for its old bookmark. It never issues a refund. The native Medusa
order screen remains the only mutation surface.

`widgets/order-stripe-payment.tsx` links Stripe payment investigation to an
order and directs the operator to the appropriate Medusa return, claim, or
payment action. Opening Stripe must not be used to create a refund.

The backing Admin endpoint is `GET /admin/refund-operations`. It returns
privacy-minimized projections from Medusa payment/refund records and existing
tax evidence. See
[`../../../docs/REFUND_OPERATIONS.md`](../../../docs/REFUND_OPERATIONS.md) for
the authority boundary, statuses, edge cases, and incident runbook.

## Catalog authoring cutover audit

`GET /admin/catalog/authoring-audit` is the read-only classification and
conflict source for the catalog editor cutover. It evaluates every product
against controlled catalog Product Types, bundle profiles, legacy authoring
metadata, and native Medusa Product Types. Search, kind, status, and pagination
filters are server-owned; the response always includes whole-catalog summary
counts.

Run `pnpm --filter backend run catalog:authoring:audit` as a release or
operator gate. The command exits non-zero when any product is unclassified,
needs review, or has conflicting authorities. Informational migration work,
such as adding native Product Types after a catalog classification is already
unambiguous, remains visible without creating a false blocker.

`GET /admin/catalog/products/:product_id/authoring-view` is the consolidated,
read-only editor contract. One request returns the native Product and Variant
facts, all prices, controlled catalog assignments, bundle composition, managed
media, exact inventory availability, derived customer-facing state with its
reason, classification, and relationship diagnostics. Raw technical data stays
available for a Diagnostics disclosure without becoming a second writable
authority.

The native Product detail page consumes that contract through a read-only
Catalog Summary widget. The widget reports product kind, artist/release
identity, catalog completion, customer availability, managed-media alternative
text, and bundle-mapping health without creating another write authority. Its
single action opens `/app/catalog/products/:product_id`, a hidden dynamic Admin
route for the exact product. Admin links use React Router paths without the
`/app` prefix so navigation stays inside the dashboard.

During the editor cutover, the dynamic route reuses the existing authoring
workspace but suppresses the general product picker and draft-creation action.
It fetches only the requested Product for ordinary product editing. Bundle
product choices are deferred until an existing bundle is loaded or the operator
enables bundle editing, then fetched across bounded 200-row pages so all
products remain selectable without putting that catalog-wide request on every
editor visit. Existing bundle selections remain visible while choices load;
loading, failure, and retry are explicit. The old sidebar route remains a
temporary compatibility surface until the dedicated editor has complete form
parity and the authoring audit is clean.

Run `pnpm --filter backend run catalog:authoring:view-check` to load every
product through that contract in bounded batches of eight. The gate fails if
classification drifts, inventory cannot be read, a native Variant lacks its
catalog profile, or selected catalog/media relationships are missing.

Product-profile PUTs use the stored `mutate-catalog-product-profile` workflow.
The command requires a UUID idempotency key and the profile version returned by
the read contract. It acquires a product-scoped lock, records the canonical
request hash and actor, and rejects stale or mismatched replays. If a later
workflow step fails, compensation restores the complete prior profile, artist
assignments, and reference assignments. Newly created controlled values are
deleted only when the restored catalog no longer references them.

Variant-profile PUTs follow the same contract through the stored
`mutate-catalog-variant-profile` workflow and a variant-scoped lock.
Compensation restores the complete prior variant profile and removes only
mutation-owned format values that remain unreferenced. Variant edits do not
write the legacy availability field; native inventory remains the availability
authority.

Product-media replacements use the stored `mutate-catalog-product-media`
workflow. The response exposes a media-set version backed by the authoring
ledger; writes require that version and a UUID idempotency key. The workflow
locks the product and every explicitly edited asset, restores links plus asset
metadata on compensation, and removes only newly created assets that remain
unreferenced. Reusable source files are cloned at the metadata layer so one
product cannot silently rewrite another product's alternative text or crop.

## Catalog merchandising safety contract

Shelf creation, editing, membership replacement, archive, and restore use one
serializable catalog transaction. Every write requires the shelf version shown
by the read response and a UUID idempotency key. The command ledger stores the
actor, canonical request hash, expected version, result, and completion state;
an exact retry returns the completed result, while stale edits or a reused key
with different input return a conflict. PostgreSQL serialization/deadlock
failures are translated into the same refresh-and-retry contract.

All requested Medusa Product IDs, optional catalog Product Profile ownership,
duplicate membership, bounds, and date ranges are validated before the
transaction can delete an existing membership row. Shelf metadata, its version
increment, the complete ordered membership set, and the succeeded operation
record then commit together. A failure at any point rolls the entire database
transaction back, so this boundary does not need a later compensating write and
cannot leave an empty or partially rebuilt shelf.

`DELETE /admin/catalog/shelves/:id` is intentionally recoverable: it archives
the shelf, disables customer display, retains membership, and increments the
version. `POST /admin/catalog/shelves/:id/restore` restores it as inactive so a
merchant can review it before explicitly publishing it again. The Admin asks
for confirmation before archive and makes archived fields read-only.

The shelf list remains server-paginated. Memberships for the returned page are
loaded with one bounded query and grouped by shelf ID, avoiding the prior N+1
request pattern. The operational targets for this boundary are zero partial
writes, deterministic conflict/replay behavior, and a constant two catalog
queries per list page (one shelves/count query and one membership query).

Product selection is also server-driven. The Admin does not preload a fixed
subset of the native product catalog or render one large select per shelf row.
Its Focus Modal requests 20 title-ordered Products at a time, applies Medusa's
server-side `q` search, cancels superseded requests through TanStack Query, and
keeps prior page content inert while the next response is loading. Product IDs
already assigned to the shelf are hydrated in one exact-ID batch, while a newly
chosen Product is cached locally so its title is available immediately without
saving. Search, paging, and choosing a Product never persist shelf changes;
only the explicit **Save shelf** command crosses the mutation boundary.

The route is split into typed shelf-list, settings, product-editor, creation,
and product-picker components built on Medusa UI controls. The shared Admin
Focus Modal header supplies an accessible close name and stacks its supporting
copy on narrow viewports. The layout uses zero-minimum grid columns, 24-pixel
checkbox targets, disabled fieldsets for archived shelves, and responsive
product cards so the complete route remains inside the Admin app bar at the
built-in Pixel 7 viewport.
