# Medusa Admin client guide

This guide covers the project-owned Medusa Admin workspaces used for ordinary
store operations. Medusa's native Products, Orders, inventory, pricing, and
fulfillment screens remain the source of truth for their native data.

## Before editing

- A visible save status says whether the screen is unchanged, has unsaved
  changes, is saving, is checking the server, or failed.
- Long editors include task links that jump to the exact section without
  changing the form.
- If a save is rejected, use the error summary to jump to the first field that
  needs attention. Inline text explains the correction.
- Closing or leaving a changed editor asks before discarding work.
- Product creation, News, and historical Discography retain bounded,
  seven-day browser recovery drafts. A restored draft is announced in the
  editor. A successful save or confirmed discard removes it.
- Retrying the same failed action is safe. Writes carry an idempotency key and
  edits carry the version that was loaded. When a response is lost, supported
  editors check the server before asking for another save.

## Catalog

### Add a product

Open **Products → Add product**. Choose the product kind first; later steps
show only relevant fields. Work through Kind, Basics, Offerings, Details, and
Review. For music releases, choose a common CD, cassette, vinyl, or combined
format set before entering each format's customer label, SKU, price, and stock.
For merchandise, use the one-size or apparel-size templates. A template never
copies price or inventory: new rows start with blank prices and SKUs and zero
stock so they must be reviewed deliberately.

Every offering needs a unique customer label, a unique fulfillment SKU, and a
price above `$0.00`. **Fill missing SKUs** creates editable draft SKUs from the
product and offering names. Choose existing controlled format and format-detail
values when possible so Storefront filters remain consistent. The review screen
links every problem back to its field, and a saved browser draft can be resumed
after a reload.

The guided flow creates native prices, inventory records, default shipping and
sales-channel assignments, and the customer-facing catalog presentation in one
compensated draft workflow. Later price and inventory changes remain
Medusa-native. The Product opens in Catalog details after creation, with the
native Medusa editor available for those commerce changes.

The Product-list **Catalog workspace** card shows whole-catalog classification
health and direct links to create or review Products. A green **Catalog
consistent** status means no Product is unclassified, conflicting, or waiting
for catalog review; informational migration notes do not create a false
blocker. It appears before the Product table by default so the health result
and guided create action are visible before scrolling through the catalog.

### Edit a product

Open a Product, then use **Catalog details** for the customer-facing release,
artist, classification, structured content, variant presentation, and bundle
tasks. Use **Default Medusa editor** for native price and inventory work. The
sticky save bar remains reachable on long records.

Variant catalog presentation uses its own edit drawer. Native price and stock
evidence is shown beside the customer-facing label and availability so the
operator can compare them before saving.

### Merchandise the catalog

Open **Catalog merchandising**. Choose or create a shelf, configure its
storefront settings, then add and order products. Automatic shelves require an
automation rule; manual rows cannot repeat a product; end times must follow
start times. Switching shelves or closing a changed creation dialog requires a
discard confirmation.

Archiving a shelf is reversible. A restored shelf remains inactive until the
operator deliberately activates it.

## Content

### Publish News

Open **Content → News**. Create or edit the story, optional accessible cover,
tags, and publishing decision in one editor. Choose one action:

- **Save draft** keeps the post private.
- **Schedule** requires a future local date and time.
- **Publish now** makes the post visible immediately.

The search preview shows the stable public route, title, and description.
Browser recovery protects unfinished work. Archive hides a post without
deleting its content or history; Restore returns its previous publication
state.

### Maintain Discography

Open **Content → Discography**. Store-linked releases are projections of
published Products and must be edited from Products. Use **Add historical
release** only for label history that is not currently sold. The form separates
identity, release details, and artwork, supports exact date/year/unknown date
precision, and retains a browser recovery draft.

Archive and Restore are reversible. Historical records never create a
storefront purchase link.

## Operations

### Tax control

Open **Settings → Tax control**. Choose the operating decision first:

- **Do not collect tax** records an explicit `$0.00` decision for new or
  refreshed eligible checkouts without calling a provider.
- **Collect using TaxRate.io** uses the ZIP-based provider after its readiness
  checks pass.
- **Collect using Stripe Tax** uses address-aware Stripe calculations after
  account and registration checks pass.

Every change requires a concrete audit reason. Turning collection off also
requires the exact displayed acknowledgement. Existing prepared checkouts and
completed orders keep their historical decision. See
[Tax Collection Client Guide](TAX_COLLECTION_CLIENT_GUIDE.md) for the complete
operating and reporting contract.

### Media cleanup

Open **Operations → Media cleanup**. Review the filename, preview, storage
source, and created date before acting. **Quarantine** removes an unlinked asset
from active reuse but does not delete its file. **Restore** returns it to the
media library but does not attach it to a Product. Each action requires a
confirmation and keeps the same retry identity after a failed response.

The displayed 30-day date is a future review point only. No automatic or
physical purge exists.

### Refund and tax records

These project-owned workspaces are read-only operational views. Follow their
links into Medusa Orders for authorized mutations. Tax Records distinguishes
tax collected, tax not collected and pending review, refunds, disputes, and
evidence incidents without rewriting historical decisions.

## When a save fails

1. Keep the editor open and read the inline error or summary.
2. Correct validation issues before retrying.
3. For a network or response-loss error, retry the same unchanged action; the
   existing idempotency key is retained.
4. If another administrator saved a newer version, refresh and reapply only
   the intended change. Stale data is never silently overwritten.
5. Use the relevant operations runbook when the screen reports a provider,
   payment, storage, or evidence incident.
