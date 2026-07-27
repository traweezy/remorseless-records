# Admin customizations

The Medusa Admin includes project-specific workspaces for catalog authoring,
merchandising, discography, news, tax-provider control, tax records, and refund
operations.

## Refund operations

`routes/refund-operations/page.tsx` is a read-only operator guide and
reconciliation queue. It never issues a refund. The native Medusa order screen
remains the only mutation surface.

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
