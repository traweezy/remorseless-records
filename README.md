# Remorseless Records Monorepo

Brutal maximalist commerce experience for extreme music: MedusaJS v2 backend, Next.js 16 (React 19) storefront, Stripe Payment Element, Meilisearch discovery, and Resend emails—all wired for Railway deployments and polished local DX.

## Contents

- [Architecture](#architecture)
- [News Publishing: Plain-English Guide](#news-publishing-plain-english-guide)
- [Admin Access Control: Plain-English Guide](#admin-access-control-plain-english-guide)
- [Shopping Cart: Plain-English Guide](#shopping-cart-plain-english-guide)
- [Checkout and Payment: Plain-English Guide](#checkout-and-payment-plain-english-guide)
- [Refund Operations: Plain-English Guide](#refund-operations-plain-english-guide)
- [Money and Price Units](#money-and-price-units)
- [Prerequisites](#prerequisites)
- [Repository Setup](#repository-setup)
- [Release and Branch Workflow](#release-and-branch-workflow)
- [Environment Variables](#environment-variables)
- [Running the Backend Locally](#running-the-backend-locally)
- [Running the Storefront Locally](#running-the-storefront-locally)
- [Using Railway/Staging Environment Variables Locally](#using-railwaystaging-environment-variables-locally)
- [Stripe Payment Element & Webhooks](#stripe-payment-element--webhooks)
- [Search (Meilisearch)](#search-meilisearch)
- [Email (Resend)](#email-resend)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
/
├── backend/      # MedusaJS 2.x server (commerce, Stripe provider, search, email)
├── storefront/   # Next.js 16 / React 19 App Router storefront
├── node_modules/ # monorepo root dependencies (pnpm workspace)
├── pnpm-workspace.yaml
└── README.md
```

- **Backend**: Medusa core services, the official Stripe payment provider and webhook, Resend-powered notifications, retention/reconciliation jobs, and Meilisearch sync helpers.
- **Storefront**: Next 16 App Router with React Compiler enabled, semantic same-origin cart/checkout APIs, Stripe Payment Element, Meilisearch-powered search, variant selectors, and optimistic cart updates.
- **Package management**: `pnpm` 11.17.0. Node 26.5.0 is enforced through `.nvmrc`.

## News Publishing: Plain-English Guide

News is label-owned editorial content, not a product or commerce record. The
Medusa Backend is its source of truth: it stores the post, decides whether it
is public, protects every change from stale or duplicate requests, and returns
only public posts to the Storefront. The Next.js application renders that safe
public view but cannot publish a draft by itself.

### The four states

| State | What the administrator sees | What a visitor sees |
| --- | --- | --- |
| **Draft** | A private work in progress that can be edited, scheduled, or published. | Nothing. Drafts are excluded by the Store API. |
| **Scheduled** | A post with a chosen future date and time. The original scheduled state remains visible for auditing. | Nothing before that instant; the post appears automatically when the date arrives. |
| **Published** | A post intentionally made public now. | The post appears in the News feed, homepage carousel, metadata, and its stable detail URL. |
| **Archived** | A recoverable post hidden from normal editing until it is restored. | Nothing. The old public URL stops resolving through the Store API. |

```mermaid
stateDiagram-v2
  [*] --> Draft: Create privately
  Draft --> Scheduled: Choose a future time
  Draft --> Published: Publish now
  Scheduled --> PublishedView: Scheduled time arrives
  Scheduled --> Draft: Save as draft
  Scheduled --> Published: Publish now
  Published --> Draft: Save as draft
  Draft --> Archived: Archive
  Scheduled --> Archived: Archive
  Published --> Archived: Archive
  Archived --> Draft: Restore prior draft
  Archived --> Scheduled: Restore prior schedule
  Archived --> Published: Restore prior publication
  state "Public scheduled view" as PublishedView
```

`PublishedView` is a customer-facing condition rather than a database rewrite.
The Store API treats an unarchived scheduled post whose time has arrived as
published. This avoids depending on a background timer to flip a row at the
exact second while preserving the administrator's original scheduling intent.

### What the administrator does

Open **Content** in the Admin sidebar, then choose **News**. The canonical route
is `/app/content/news`; old `/app/news` bookmarks are replaced without adding a
duplicate browser-history entry. News has separate **Active** and **Archived**
views. Active posts can be searched by headline or stable URL slug, filtered by
status, sorted, and paged on the server. The browser does not download an
arbitrary batch and pretend it is the complete collection.

Creating or editing opens one full-viewport authoring surface:

- **Story** contains the headline, optional summary, formatted body, cover,
  accessible cover description, and tags.
- **Publishing** explains the recorded author, current state, optional local
  schedule time, and the effect of each action.
- **Search preview** shows the stable public path and the copy search engines
  and link previews will use.
- **Save draft**, **Schedule**, and **Publish now** are separate actions. There
  is no ambiguous status dropdown that silently changes visibility.

The author is the authenticated administrator recorded by the Backend; it is
not a free-form identity field. A post receives its URL slug when first
created. Later headline edits do not silently break links by changing that
slug.

The body editor is Lexical rather than the browser's deprecated editing
commands. It supports paragraphs, headings, emphasis, quotes, lists, and
validated `http`, `https`, or `mailto` links. It is keyboard operable, exposes
its errors to assistive technology, preserves focus while typing, and keeps the
toolbar above the editable document on desktop and mobile.

### Covers and accessible descriptions

A cover is optional. The browser accepts JPEG, PNG, WebP, or GIF input up to
12 MiB and sends it to the authenticated managed-upload route. The Backend
performs the authoritative filename, media type, size, and signature checks
before the File Module stores anything. Only `http` or `https` cover URLs can
pass either the Admin response validator or the Backend News contract.

When a cover exists, its description is required. The same description is
used on News cards, the homepage carousel, the detail page, and social/Open
Graph metadata. Older records without one retain a descriptive title-based
fallback until they are edited.

### Safe saves, retries, conflicts, and recovery

Every create, update, archive, or restore includes:

- the version the administrator actually loaded;
- a UUID idempotency key for that exact action; and
- the authenticated actor recorded in an operation ledger.

The Backend applies the change in a serializable transaction. Repeating the
same successful request returns the recorded result instead of creating a
duplicate. Reusing its key for different content is rejected. If another
administrator saved a newer version first, the stale request fails with a
conflict rather than overwriting that work.

Closing an editor with unsaved changes requires confirmation. Failed requests
leave the editor and exact retry identity intact. Archive is the normal removal
path; physical deletion is not exposed. Restoring returns the post to its prior
draft, scheduled, or published state, so the confirmation warns when an old
scheduled time has already passed and would make the post immediately visible.

### Storefront enforcement

The public list and detail endpoints return only unarchived published posts and
scheduled posts whose publication time has arrived. Store results normalize
their public status to `published`, sanitize stored rich HTML on the server,
use stable ordering, and paginate. The Storefront revalidates the News feed
every five minutes, so an administrative visibility change has a bounded cache
window without requiring a database read for every visitor.

## Admin Access Control: Plain-English Guide

The codebase uses Medusa 2.18's native roles and permissions for every custom
Admin API, including **Catalog authoring**, **Catalog taxonomy**, **Catalog
merchandising**, **Content**, **News**, **Discography**, **Tax control**, **Tax
records**, **Refund operations**, and **Media cleanup**. This is not a second
login system. Medusa still authenticates the administrator; RBAC decides what
that authenticated administrator may read or change.

The permission model is deliberately small:

- News and Discography each have read, create, update, and delete permissions.
- Archive and restore count as updates because they change a record's lifecycle.
- The hard-disabled Content delete endpoints remain permission-protected. The
  unused physical catalog-media DELETE method is removed entirely.
- News cover upload also requires Medusa's native `file:create` permission.
- Discography list and detail reads require both `discography:read` and native
  `product:read` because those responses always include Product enrichment.
- Catalog authoring has read, create, update, and delete capabilities for
  product profiles, bundles, managed media, and the composite Product workflow.
- Catalog taxonomy has read, create, update, and delete capabilities for
  artists and controlled reference values.
- Catalog merchandising has read, create, and update capabilities for shelves.
  Shelf archive is an update because it is recoverable; no merchandising
  hard-delete capability exists.
- Tax control separates read access from provider switching and metered quota
  refreshes. Both writes require `tax_control:update`.
- Tax records and Refund operations are deliberately read-only custom
  workspaces. Tax CSV export is part of `tax_records:read`.
- Refund operations links to native Orders and Refund reasons only when the
  role also has the corresponding native read permission.
- Media cleanup separates inspection from reversible quarantine/restore.
  Those lifecycle changes require `media_cleanup:update`.
- Product imports separate CSV upload/plan preparation from execution. Preparing
  requires native Product read and file-create permissions plus
  `product_import:create`; confirming requires Product read plus
  `product_import:update`.

The backend is the authority. A typed manifest covers all 64 active custom
Admin methods exactly once: 41 under `/admin/catalog/**` and 23 elsewhere. It
generates exact, case-insensitive policy matchers that accept the same optional
trailing slash as the router. When a route declares multiple custom and native
permissions, all of them are required before the handler runs. Rate limits,
body parsers, upload handling, and the other operational middleware remain
separate from this policy-only manifest.

Existing permission-aware Content and operations component boundaries avoid
protected fetches and dead-end controls. Dashboard route
`handle.permissions` is metadata, not a security or render boundary. Catalog
routes and widgets still need explicit fail-closed component boundaries before
restricted-role UI behavior can be called complete; direct requests are
already protected by the backend manifest.

The pinned Dashboard's native Product Import drawer is the current UI exception:
it does not understand the custom import permission and begins with the
intentionally disabled presigned-upload route. Backend enforcement still
rejects unauthorized imports. Approved tooling uses the validated managed
upload and plural prepare/confirm APIs until a permission-aware replacement is
implemented.

```mermaid
flowchart TD
  Login[Administrator signs in] --> Roles[Medusa resolves assigned roles]
  Roles --> Permission[Effective permissions]
  Permission --> UI[Permission-aware Admin component boundary]
  Permission --> Catalog[Catalog metadata; component boundary pending]
  UI --> API[Request reaches Medusa]
  Catalog --> API
  API --> Check{Required route policy granted?}
  Check -- Yes --> Handler[Run the operation]
  Check -- No --> Deny[Return 403 without running it]
```

RBAC is feature-flagged. Its additive database migration, real viewer/editor
journeys, session-change behavior, and flag-off rollback passed against a
disposable clone on August 2, 2026. After a fresh snapshot and explicit owner
approval, Railway staging activated RBAC on August 8, 2026. The first enabled
migration assigned the native Super Admin role to all three existing
administrators. A version-pinned Medusa patch prevents that bootstrap from
writing user emails or IDs to release logs and makes native single-Variant
updates return 404 instead of a false 200 or remapper 500 when the requested
Product/Variant pair does not exist.

The rehearsal also found a Medusa 2.18 startup-order trap: migration commands
evaluate this project's config before Medusa registers its built-in feature
flags. The Backend now declares the native RBAC module explicitly from the
strict `MEDUSA_FF_RBAC` value, so an enabled release cannot claim the flag is on
while silently skipping the RBAC schema and bootstrap. Repeating the migration
is safe and did not duplicate roles, policies, links, or its one-time ledger.

Now that staging activation and rollback rehearsal are complete, production
configuration fails closed unless `MEDUSA_FF_RBAC` resolves to enabled (for
example, `MEDUSA_FF_RBAC=true`). Disabling the flag is limited to local
rehearsal; an emergency production rollback requires an audited revert to a
previously validated release rather than silently restoring authenticated-only
Admin access.

The initial activated staging database had one Super Admin role, 241 policies,
the eight exact News and Discography policies, one wildcard policy, three
distinct administrator links, and one bootstrap ledger row. The operations
authorization release adds six code-registered policies; Medusa synchronizes
them at application start and the existing wildcard Super Admin grant covers
them without adding per-user links. Product-import authorization adds two more
task-specific policies. Its accepted staging rollout verified 249 non-deleted
policies, one wildcard, and 248 concrete Super Admin permissions. The catalog
manifest adds 11 definitions, bringing the code-registered custom total to 27.
Its release acceptance must verify 260 non-deleted policies, one wildcard, and
259 concrete Super Admin permissions before that catalog slice is considered
deployed; those figures are expectations, not completed rollout evidence.
The secured pre-activation snapshot and exact deployment evidence are recorded
in [ADR 0006](docs/adr/0006-native-admin-rbac.md).

After activation or any role change, the affected administrator must sign out
and sign back in so the signed session carries current role IDs. Medusa 2.18's
permission-summary endpoint can see a newly assigned database role before an
old signed session can use it; backend authorization still rejects the old
session, so reauthentication is both the UX and security boundary. Medusa's
public Admin extension API cannot yet hide custom top-level or nested sidebar
items by permission, so a restricted user may still see a denied custom
workspace in that shell. Permission-aware Content and operations routes show a
restricted-access page without starting their protected query. Catalog
`handle.permissions` metadata alone does not provide that boundary; explicit
catalog route and widget guards remain a follow-up. The backend independently
rejects every unauthorized direct request.

A non-production rehearsal with RBAC disabled can report the bootstrap script
as pending. Medusa checks the script's feature predicate before inserting its
migration record, so the skipped script remains available for a later enabled
run. Production refuses to start with RBAC disabled.

See [ADR 0006](docs/adr/0006-native-admin-rbac.md) for the complete permission
matrix, rehearsal, activation, session-refresh, and rollback procedure.

## Shopping Cart: Plain-English Guide

The cart looks like a drawer that slides in from the right, but several parts of
the application cooperate behind it. The browser provides immediate feedback,
the storefront server protects the cart identity and validates every request,
Medusa remains the authority for products, prices, and inventory, PostgreSQL
stores the cart, and Redis prevents separate server processes from changing or
cleaning up the same cart at the same time.

This section explains that system without assuming prior knowledge of Medusa,
Redis, cookies, background jobs, or cart expiration.

### The terms used below

| Term                       | Plain-English meaning                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Storefront**             | The website a shopper sees. It is the Next.js application in `storefront/`.                                                                                   |
| **Cart drawer**            | The side panel containing the cart. There is deliberately no separate cart experience to maintain; the legacy `/cart` URL opens the same drawer.              |
| **Storefront API / BFF**   | A small server-side layer inside the storefront. “BFF” means “backend for frontend.” The browser talks to it instead of talking directly to Medusa.           |
| **Medusa**                 | The commerce backend. It decides whether a variant exists, what it costs, how much stock is available, and whether a cart change is valid.                    |
| **PostgreSQL**             | The durable database where Medusa stores carts and line items. Closing a tab does not delete these records.                                                   |
| **Cookie**                 | A small value the browser sends back to the storefront. This cart cookie contains only a protected reference to the server-side cart, not products or prices. |
| **Redis**                  | A fast shared coordination service. It lets every running storefront/backend instance agree on retries, rate limits, and locks.                               |
| **TTL / retention window** | A time limit after which inactive data may expire. TTL means “time to live.”                                                                                  |
| **Soft delete**            | Marking a record as deleted through Medusa instead of issuing an unsafe direct database deletion.                                                             |
| **Idempotency**            | Making a retry produce the same result instead of adding the same item twice.                                                                                 |
| **Lock**                   | A short-lived “one worker at a time” claim around a specific operation or cart.                                                                               |

### How the pieces fit together

```text
Shopper clicks Add, changes quantity, or removes an item
  |
  v
React cart provider
  - shows immediate/optimistic feedback
  - keeps tabs on the same browser in sync
  |
  v
Same-origin Next.js cart API
  - validates the request
  - reads/writes the signed cart cookie
  - applies rate limits and idempotency
  |
  +----> Redis
  |      - shared retry records
  |      - shared rate limits
  |      - distributed locks
  |
  v
Medusa Store Cart API
  - authoritative product, price, and inventory checks
  |
  v
PostgreSQL
  - durable cart and line-item records
```

The browser is never trusted to set a price, claim stock, or choose a database
cart ID. It asks the storefront server to perform an action, and the server asks
Medusa for the authoritative result. That result replaces the browser's
temporary optimistic state.

### What a shopper experiences

#### Browsing without buying

Opening the website does **not** create a cart. A cart is created lazily only
after the first valid add request. This avoids filling the database with empty
carts from visitors and bots who never add anything.

#### Adding an item

1. The selected button changes to `Adding…`.
2. The storefront validates the request and sends it to Medusa.
3. Medusa rechecks the exact variant, current price, inventory, and cart state.
4. On success, the button says `Added` for about two seconds and the header
   badge updates.
5. The drawer stays closed so adding an item does not interrupt shopping.

This works for music releases, merchandise, fixed bundles, and mystery bundles.
Unavailable variants are rejected instead of creating an invalid line item.

#### Reviewing the drawer

The drawer shows the format or merchandise option that was actually selected,
bundle contents that match that selection, quantity controls, current line
totals, subtotal, and inventory status. Shipping and tax say “Calculated at
checkout” because the cart does not yet know the shopper's address or selected
shipping method.

Items in a cart are **not reserved**. Availability is checked again whenever the
cart changes and later at checkout. This prevents a forgotten cart from holding
inventory indefinitely.

#### Changing quantity or removing an item

Quantity changes and removals update immediately in the drawer. This is called
an **optimistic update**: the interface shows the expected outcome while the
server request is running. If Medusa rejects the change, the previous cart is
restored and an accessible error message explains what happened.

- Decreasing quantity `1` removes that line.
- The server enforces a maximum quantity of `100` per line.
- A removed line can be restored with `Undo` for eight seconds.
- Removing the final line clears the old browser cookie.
- Undoing that final removal creates a fresh server cart rather than reviving an
  empty stale cart.

#### Reloading, returning later, and using multiple tabs

The signed cookie allows a valid non-empty cart to be restored after a reload or
browser restart. Successful changes are also announced through a browser
`BroadcastChannel`, so another open tab refetches the authoritative cart rather
than drifting out of date.

A missing, malformed, tampered, completed, deleted, or empty cart is treated as
no cart. The stale cookie is cleared quietly and the shopper can start again.

### Cart cookie and 30-day browser lifetime

The cookie is named `rr_cart_v1`. It contains a signed, opaque Medusa cart
reference. It does not contain line items, prices, payment information, or
customer details.

The cookie is:

- `HttpOnly`, so browser JavaScript cannot read it;
- `Secure` in production, so it is sent only over HTTPS;
- `SameSite=Lax`, which limits cross-site sending without breaking normal
  navigation;
- cryptographically signed, so changing the cart ID invalidates it;
- compatible with a previous signing secret during planned secret rotation.

The cookie expires 30 days after the last **successful item mutation**. Adding,
changing, or removing an item refreshes the 30-day period when the resulting
cart still contains items. Merely viewing the cart does not keep it alive
forever.

No cart ID is stored in `localStorage`. A server-only cookie is harder for
injected browser JavaScript to steal, and it keeps cart identity handling in one
auditable place.

### The 37-day backend retention job

Cookie expiration removes the browser's pointer, but it does not itself remove
the database record. A daily Medusa job therefore soft-deletes old abandoned
anonymous carts.

The two windows intentionally differ:

```text
Day 0                    Day 30                         Day 37+
last successful change  browser cookie expires        backend cleanup eligible
|-----------------------|------------------------------|
 active cart window          7-day safety grace
```

The seven-day grace helps avoid deleting a cart at the exact boundary where a
browser cookie or delayed request may still be in flight.

The job runs daily at `04:17 UTC` (`17 4 * * *`) and is disabled unless
`ANONYMOUS_CART_RETENTION_ENABLED=true` is set. A cart is eligible only when all
of the following are true:

- it has no customer account;
- it has no email address;
- it has not been completed into an order;
- its `updated_at` timestamp is older than the configured retention cutoff.

The cleanup reads at most 250 candidates at a time, soft-deletes in batches of
100, and stops at the configured per-run cap (1,000 by default; hard maximum
10,000). Before each batch is deleted, it obtains locks and reads the records
again. That final check protects a cart that became active, gained an email, or
was claimed by a customer while cleanup was already running.

The relevant settings are:

| Variable                                 | Purpose                                                          | Safe default |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------ |
| `ANONYMOUS_CART_RETENTION_ENABLED`       | Explicitly enables the cleanup job for an environment.           | `false`      |
| `ANONYMOUS_CART_RETENTION_DAYS`          | Minimum inactive age before cleanup. Allowed range: 37–365 days. | `37`         |
| `ANONYMOUS_CART_RETENTION_MAX_DELETIONS` | Safety cap per daily run. Allowed range: 1–10,000 carts.         | `1000`       |

Staging currently uses the 37-day window and 1,000-cart cap. Before it was
enabled, a read-only count confirmed that no existing anonymous incomplete carts
were already beyond the cutoff.

### Why Redis and distributed locks matter

Railway may run more than one application process, and a process may restart at
any time. Memory inside one process cannot coordinate with another process.
Redis provides the shared state needed for the following protections:

- **Idempotent mutations:** each browser mutation sends a UUID request key. A
  matching retry returns the stored successful response instead of adding or
  updating twice. Completed results live for 10 minutes.
- **In-flight protection:** a mutation owns a 30-second processing claim. A
  duplicate waits up to eight seconds for the first result; if it is still
  running, the API returns a retryable conflict rather than guessing.
- **Shared rate limits:** cart traffic is limited across all storefront
  instances, not independently inside each process.
- **Retention locks:** only one cleanup job runs at a time, and candidate carts
  are locked while their eligibility is rechecked and deleted.
- **Medusa coordination:** the backend uses Medusa's official Redis locking
  provider when `REDIS_URL` is configured.

Production cart mutations fail safely with `503 Service Unavailable` if the
shared Redis protection is unavailable. That is preferable to silently risking
duplicate additions or inconsistent writes. Read-only cart requests can use a
small local rate-limit fallback because they do not change data.

See Medusa's
[locking module documentation](https://docs.medusajs.com/resources/infrastructure-modules/locking)
for the underlying distributed-lock concept.

### Validation, errors, and security boundaries

Every cart write is validated at the storefront boundary before it reaches
Medusa:

- request bodies have small size limits;
- product variant and line-item IDs must match the expected Medusa ID format;
- quantities must be whole numbers in the allowed range;
- unknown input fields are rejected rather than ignored;
- Medusa calls have an eight-second timeout;
- inventory conflicts and missing carts are returned as typed, safe errors;
- rate-limited requests include retry guidance;
- logs use request IDs and durations without printing cookie secrets, raw cart
  IDs, or cart contents.

The storefront maps failures to meaningful HTTP statuses such as `404` for a
cart that no longer exists, `409` for a conflicting in-flight mutation, `422`
for an invalid or unavailable item, `429` for rate limiting, and `504` for an
upstream timeout. The drawer turns those responses into useful shopper-facing
feedback and restores optimistic state when necessary.

### Where cart stops and checkout begins

The drawer owns item selection and quantity changes. Its Checkout button hands
the signed server cart to the dedicated checkout system described below.
Checkout then collects contact and delivery details, asks Medusa for shipping
and tax, prepares the official Stripe payment session, and completes the order.

### Where the implementation lives

| Area                                        | Main files                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drawer UI and line items                    | [`storefront/src/components/cart-drawer.tsx`](storefront/src/components/cart-drawer.tsx), [`storefront/src/components/cart/`](storefront/src/components/cart/) |
| Browser state, optimistic updates, tab sync | [`storefront/src/providers/cart-provider.tsx`](storefront/src/providers/cart-provider.tsx)                                                                     |
| Same-origin cart API routes                 | [`storefront/src/app/api/cart/`](storefront/src/app/api/cart/)                                                                                                 |
| Cookie, Medusa client, idempotency, errors  | [`storefront/src/lib/cart/`](storefront/src/lib/cart/)                                                                                                         |
| Shared cart rate limits                     | [`storefront/src/lib/security/cart-rate-limit.ts`](storefront/src/lib/security/cart-rate-limit.ts)                                                             |
| Retention rules and tests                   | [`backend/src/lib/cart-retention.ts`](backend/src/lib/cart-retention.ts)                                                                                       |
| Daily retention scheduler                   | [`backend/src/jobs/remove-expired-anonymous-carts.ts`](backend/src/jobs/remove-expired-anonymous-carts.ts)                                                     |

### Operating and troubleshooting the cart

1. Configure `REDIS_URL` for every deployed storefront/backend instance.
2. On backend startup, confirm the log reports a connection for the
   `locking-redis` provider.
3. Keep retention disabled in a new environment until a read-only database
   count confirms the number of eligible carts.
4. Enable retention explicitly with the three variables above.
5. Watch for `Anonymous cart retention completed` in the daily backend logs. Its
   summary includes the cutoff, number scanned, number protected by email,
   number deleted, and whether the safety cap was reached.
6. If cleanup behaves unexpectedly, set
   `ANONYMOUS_CART_RETENTION_ENABLED=false`. This prevents future cleanup runs;
   it does not hard-delete or rewrite existing records.

Common cart diagnostics:

| Symptom                        | What to check                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An item cannot be added        | Confirm the chosen Medusa variant is published, priced for the active region/currency, and has inventory.                                                                          |
| A valid cart disappears        | Check whether it is empty/completed, whether `rr_cart_v1` is present for the storefront domain, and whether the signing secret was rotated without preserving the previous secret. |
| Writes return `503`            | Check the storefront Redis connection first; mutating routes intentionally fail closed without shared idempotency/rate-limit state.                                                |
| Writes return `409` briefly    | Another request with the same idempotency key is still running. Respect `Retry-After` and retry.                                                                                   |
| Tabs appear briefly different  | Confirm `BroadcastChannel` is available, then inspect the follow-up `GET /api/cart`; the server response is authoritative.                                                         |
| Cleanup never deletes anything | Confirm the feature flag, cutoff, schedule, Redis locking provider, and that candidates truly have no customer, email, or completion timestamp.                                    |

### How the rebuilt cart was verified

The initial staging release was verified on July 24, 2026. This is a record of
the release evidence, not a substitute for running the current CI suite after
future changes.

- Storefront: 64 test files, 300 tests, and aggregate coverage of 93.16%
  statements, 85.11% branches, 94.01% functions, and 93.12% lines.
- Backend: 11 test suites and 45 tests.
- Production builds completed for both workspaces.
- Twenty-two Playwright cart journeys ran on Pixel 7 and iPhone 15 Pro device
  profiles.
- Automated accessibility checks passed with enforced pa11y and Lighthouse
  thresholds.
- Real browser screenshots were inspected at mobile sizes to confirm the drawer,
  header badge, feedback, empty state, and long-content behavior do not overflow
  the app bar.
- Manual staging smoke tests covered add/reload, repeat-add merging, music,
  merchandise, fixed bundles, mystery bundles, quantity changes, simultaneous
  tabs, remove/Undo, final-item removal, tampered cookies, sold-out/low-stock
  rejections, and a visitor who returns after leaving the store.
- The smoke test confirmed cart activity made no checkout, payment-session, or
  Stripe requests.
- Backend, storefront, and root GitHub CI passed, and the final Railway staging
  backend/storefront deployments both reported `SUCCESS`.

## Checkout and Payment: Plain-English Guide

Checkout is a four-step page—Contact, Delivery address, Delivery method, and
Payment—with a responsive order summary. The browser never supplies a cart ID,
price, tax, shipping amount, PaymentIntent ID, or order ID. It sends small
requests to same-origin Next.js endpoints, and the server resolves the signed
`rr_cart_v1` cookie before asking Medusa for authoritative data.

### Who owns what

| Component         | Authority                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Medusa            | Cart, prices, promotions, shipping, tax, inventory, payment collection, order, reservation, capture/refund lifecycle |
| Stripe            | Secure card/wallet collection and processing for Medusa's one payment session                                        |
| Storefront server | Signed cart identity, validated checkout commands, safe projections, rate limits, recovery, and receipt grants       |
| Browser           | Form input and presentation only; it cannot choose identifiers or totals                                             |

There is exactly one payment integration. Medusa's official
`@medusajs/payment-stripe` provider creates the PaymentIntent. The old custom
Stripe Checkout Session route, custom Stripe webhook, Card Element, and public
session lookup have been removed. This matters because two payment authorities
could disagree about the amount charged or whether an order exists.

### Normal paid-order flow

```text
Browser                   Storefront BFF            Medusa              Stripe
  | GET /api/checkout          |                      |                    |
  |--------------------------->| signed cart lookup   |                    |
  |                            |--------------------->| cart projection    |
  | contact/address/shipping   |                      |                    |
  |--------------------------->| validate + rate limit|                    |
  |                            |--------------------->| save/recalculate   |
  | POST payment-session       |                      |                    |
  |--------------------------->| revision preflight   |                    |
  |                            |--------------------->| official session   |
  |                            |                      |------------------->| PI
  | Payment Element receives only the client secret                       |
  |--------------------------------------------------------------------->|
  | confirmPayment             |                      |                    |
  |--------------------------------------------------------------------->|
  | POST complete              | locked total/payment validation           |
  |--------------------------->|--------------------->| complete cart/order |
  | receipt grant + confirmation                     |                    |
```

Every checkout projection includes a SHA-256 revision of the exact
customer-facing cart snapshot. Immediately before preparing payment and again
before completing the cart, the server recalculates shipping/tax and compares
that revision. If anything changed, payment is not submitted; the shopper sees
the new total and reviews it.

### Shopper editing and payment-frame behavior

The checkout summary is the cart editor. Quantity and remove controls work in
place, so the shopper does not leave checkout or lose completed contact,
delivery, and shipping steps. Rapid quantity taps are coalesced and processed
in order; the controls stay responsive while Medusa remains authoritative.
Removing the last item changes checkout to its empty-cart state.

Completed steps expose a visible outlined **Edit** button with a pencil icon.
Quick Shop never opens the cart after an add: it changes the add button to
**Added** briefly and exposes a separate **Checkout** action.

The Payment Element uses the same Inter typeface and dark/red token family as
the storefront. A same-revision focus or reconnect refresh preserves the
prepared client secret, so Stripe's hosted frame is not destroyed merely
because the shopper switches tabs or returns to the window. A real
cart/address/shipping revision keeps the existing frame visible under an
“Updating your order total…” overlay until Medusa returns the replacement
session. A failed or canceled session never reuses a stale secret.

The backend also installs a hook inside Medusa's locked complete-cart workflow.
For a positive USD total it requires exactly one official Stripe session and
checks the raw cart, payment collection, and payment session currencies and
major-unit amounts for an exact match. It separately verifies that Stripe's
PaymentIntent is the exact integer-cent amount produced by the official
provider's one-time USD rounding. This preserves legitimate sub-cent tax
precision without allowing the charged amount to drift. A zero-dollar order
bypasses Stripe entirely.

### Payment methods and card-data boundary

The Stripe Payment Method Configuration is constrained to card, Link, Apple
Pay, and Google Pay. Payment Element decides which eligible methods the current
browser can show. Card numbers, CVCs, wallet credentials, and payment-method
tokens stay inside Stripe-hosted frames; application routes and logs never
receive them.

Only `NEXT_PUBLIC_STRIPE_PK` is browser-safe. `STRIPE_API_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_LIFECYCLE_WEBHOOK_SECRET`,
`CHECKOUT_BFF_SECRET`, `CHECKOUT_RECEIPT_SECRET`, and
`PUBLIC_FORM_BFF_SECRET` are server-only. Staging must use `pk_test_` /
`sk_test_` credentials and a non-live Payment Method Configuration.

### Stripe and Medusa reference synchronization

Medusa remains the system of record; Stripe is not used as a second product,
customer, tax, fulfillment, or order database. Payment-session creation adds
only searchable, non-PII metadata (`medusa_cart_id`, item count, platform, and
storefront) plus a recognizable description. After `order.placed`, a retryable
Medusa subscriber adds the Medusa order ID/number and final description to the
PaymentIntent and its existing Charge with idempotent Stripe updates.

The Medusa order detail screen includes a **Stripe payments** widget showing
amount, status, test/live mode, and a mode-correct Dashboard deep link. This
keeps ordinary order work—capture/refund state, fulfillment, returns, and
customer communication—in Medusa while making payment investigation one click
away. Stripe metadata deliberately excludes email, address, phone, product
titles, and card data.

Checkout is guest-first and does not require an account. The storefront creates
the cart without a `customer_id`, resolves it through a signed HttpOnly cookie,
and collects an email only for the receipt and shipping updates. Stripe
Customers and saved payment methods are not created for anonymous guests.
Medusa's account-holder and saved-method support should be enabled only with a
separately designed customer account, consent, deletion, and authentication
flow.

### Why Stripe success is not yet an order

Stripe can confirm a payment before Medusa finishes inventory reservation and
order creation. The UI therefore never treats a Stripe redirect or
PaymentIntent result as confirmation. Confirmation requires an order linked to
the signed cart and a completed cart record.

Two completion paths use Medusa's idempotent complete-cart workflow, while the
official signed Stripe webhook keeps Medusa's payment state authoritative:

1. the browser calls the semantic complete endpoint after `confirmPayment`;
2. Medusa's official signed Stripe webhook processes payment events;
3. a capped two-minute reconciliation job calls the same completion workflow
   for an old incomplete cart only
   when it has exactly one authorized/captured official Stripe session and no
   linked order.

If a response is lost, a tab closes, a 3DS redirect returns, or the network
fails after confirmation begins, the UI routes to `/checkout/recover` and
polls a server-to-server HMAC-protected status endpoint. It explicitly says not
to pay again. Confirmed status issues a 30-minute signed, HttpOnly receipt
grant; `/checkout/confirmation` uses that grant to fetch a privacy-limited
receipt. Raw order and payment identifiers never enter a URL.

The return handler strips every Stripe query parameter with a `303` redirect
before rendering recovery. Legacy `/checkout/success` and `/order/confirmed`
links also redirect into the same clean recovery path.

### Checkout data lifetime

- The opaque cart cookie lasts 30 inactive days after a successful cart item
  change.
- Anonymous carts that never supplied email are eligible for the existing
  backend cleanup after 37 days.
- Guest checkouts containing email/address PII use a separate 37-day job. It
  excludes customer carts, completed/order-linked carts, and every unresolved
  or successful payment state. Only unused pending/canceled/error sessions are
  canceled through Medusa before the cart is soft-deleted.
- The receipt grant lasts 30 minutes; afterward the emailed receipt is the
  durable customer record.

Both deletion jobs are disabled by default, capped, lock-protected, and re-read
eligibility immediately before mutation. Reconciliation is also disabled by
default and never creates or confirms a Stripe payment.

### Semantic checkout endpoints

| Endpoint                             | Purpose                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `GET /api/checkout`                  | Safe active-cart projection                             |
| `PUT /api/checkout/contact`          | Validate and save receipt email                         |
| `PUT /api/checkout/delivery-address` | Validate and save US shipping/billing address           |
| `GET /api/checkout/shipping-options` | Medusa-authoritative options                            |
| `PUT /api/checkout/shipping-method`  | Recheck option and calculate final tax                  |
| `POST /api/checkout/payment-session` | Revision check and official Stripe session preparation  |
| `POST /api/checkout/complete`        | Final locked validation and idempotent order completion |
| `GET /api/checkout/status`           | Privacy-safe recovery state                             |
| `GET /api/checkout/confirmation`     | Receipt projection authorized by the receipt cookie     |
| `PATCH /api/cart/items/:itemId`      | Edit a checkout-summary quantity through the cart API   |
| `DELETE /api/cart/items/:itemId`     | Remove an item directly from the checkout summary       |

All responses are non-cacheable. Mutations enforce same-origin request headers,
small strict JSON schemas, bounded upstream timeouts, and Redis-backed rate
limits. Browser response schemas are validated again with Zod. Checkout queries
and client secrets are explicitly excluded from persisted TanStack Query data.

Implementation decisions are recorded in
[`docs/adr/0001-checkout-payment-authority.md`](docs/adr/0001-checkout-payment-authority.md).
The dual-provider tax control, Stripe Tax payment binding, and exact-total
rollout gates are recorded in
[`docs/adr/0002-stripe-tax-medusa-authority.md`](docs/adr/0002-stripe-tax-medusa-authority.md).
The full test and incident procedures are in
[`docs/QA_RUNBOOK.md`](docs/QA_RUNBOOK.md) and
[`docs/CHECKOUT_OPERATIONS.md`](docs/CHECKOUT_OPERATIONS.md). Tax-provider
switching and reconciliation operations are in
[`docs/TAX_CONTROL_OPERATIONS.md`](docs/TAX_CONTROL_OPERATIONS.md).

The Medusa Admin **Operations → Tax records** workspace builds
separate Connecticut, New York, and Pennsylvania filing workpapers from Medusa
sales, refunds, delivery destinations, and preserved provider evidence. The
required jurisdiction selector scopes totals and exports, supplies the correct
state period calendar, separates Pennsylvania local buckets, flags missing
locality or destination-state evidence, distinguishes same-period from
prior-period refund credits, and keeps currencies separate. State-specific CSV
exports fail closed if the source scan is truncated or a U.S. or
country-unknown record cannot be assigned to a state. It is filing support,
not an automated registration,
return, or payment service. Relocation handling, record retention, workpaper
fields, quality rules, official state references, and the accountant workflow
are documented in
[`docs/TAX_RECORDS_AND_FILING.md`](docs/TAX_RECORDS_AND_FILING.md).

## Refund Operations: Plain-English Guide

Refunds are issued only from the Medusa order. The Stripe Dashboard is for
investigation, not an alternative refund button. This keeps the Medusa order
transaction, Stripe movement, inventory decision, customer communication, and
tax evidence connected.

The Admin **Operations → Refunds** workspace first explains whether the operator
should cancel unfulfilled goods, create a return/claim for physical goods, or
use a payment-only adjustment. It then monitors all known refunds as **Needs
attention**, **Processing**, or **Verified**. A case that shows a direct Stripe
refund, a Medusa/Stripe amount mismatch, a failed provider refund, a dispute, or
a missing tax reversal explicitly tells the operator not to refund again.

The workspace cannot move money. Its **Open order** action returns the operator
to Medusa's native, irreversible refund flow. The order's Stripe widget carries
the same guidance.

Every `payment.refunded` event also creates an idempotent Resend notification
for the order email. Multiple legitimate partial refunds each get one message;
replayed event delivery cannot duplicate a message for the same Medusa refund
ID. Checkout compensation can notify a guest from the cart email even when
order creation failed. The message states the amount and original-payment
method behavior but does not promise when the customer's bank will post the
credit.

Immediate event handling and the existing hourly tax-evidence job reconcile
Medusa, Stripe refund statuses/amounts, and Stripe Tax reversals. TaxRate.io
refunds need no provider-side reversal because Medusa remains the tax filing
ledger. The full operator decision tree, exception runbooks, edge-case matrix,
service objectives, and test plan are in
[`docs/REFUND_OPERATIONS.md`](docs/REFUND_OPERATIONS.md).

Stripe refund and dispute events use a second, narrowly scoped endpoint at
`POST /webhooks/stripe/lifecycle`. It does not replace Medusa's official
payment webhook and cannot move money. It verifies a separate endpoint secret,
accepts only the documented refund/dispute allowlist, stores an idempotent
PII-minimized receipt, then retrieves current Stripe state before reconciling
Medusa's evidence. A five-minute bounded job recovers queue outages, stale
workers, duplicate delivery, and out-of-order events. The endpoint remains
dormant until `STRIPE_LIFECYCLE_WEBHOOK_SECRET` is configured.

### Checkout staging verification

The rebuilt checkout was verified in Stripe test mode on July 25, 2026 at
commit `d71d87f`. No production key, object, deployment, or traffic was used.
The verification included:

- Stripe test-mode keys and Payment Method Configuration, plus the official
  signed Medusa Stripe webhook;
- one successful disposable order, concurrent completion requests, cart
  clearing, a path-scoped HttpOnly receipt grant, and cent-rounded receipt
  agreement;
- server-side Stripe test PaymentMethods for 3DS, generic decline,
  insufficient funds, expired card, incorrect CVC, and processing error;
- real Payment Element inline invalid-number handling in the browser;
- music release quantity two, merchandise, fixed bundle, and mystery bundle
  catalog-to-checkout journeys, plus disabled sold-out music and bundle
  controls;
- a Chrome Pixel 7 device profile with a 412-pixel document and viewport,
  reduced motion, no page errors, and no horizontal overflow; and
- a real headed desktop browser screenshot, inspected independently of DOM and
  Playwright snapshots.

The checkout example reconciled the rows visibly: `$22.00` item subtotal +
`$5.00` pre-tax shipping + `$2.33` tax = `$29.33` total. Medusa's documented
pre-tax `item_subtotal`, `shipping_subtotal`, and `discount_subtotal` fields are
used beside the aggregate tax row so shipping tax is not displayed twice.

Stripe deliberately restricts browser automation of the hosted Payment
Element. Accordingly, UI layout/validation/recovery is tested in the browser,
while successful and failed payment outcomes are tested with Stripe's official
test PaymentMethods at the server boundary. This follows
[Stripe's automated-testing guidance](https://docs.stripe.com/automated-testing)
and avoids treating an automation-blocked client confirmation as a customer
failure. Full evidence and the repeatable matrix are recorded in the two
runbooks linked above.

## Money and Price Units

Medusa v2 uses **major currency units** throughout its commerce model. In plain
English, a 23-dollar record is stored and returned as `23`, not `2300`. This
single convention applies to product prices, cart lines, shipping, taxes,
totals, Meilisearch documents, admin inputs, storefront filters, and formatted
prices.

Stripe is the deliberate exception at the external boundary. Stripe's API
represents USD amounts in the smallest currency unit, so the same 23-dollar
amount is sent to or received from Stripe as `2300`. Conversion belongs only in
the Stripe adapter/provider. The browser must never multiply prices, and
Medusa/PostgreSQL values must never be divided merely for display.

| Boundary                         | Example for USD 23.00 | Rule                                                          |
| -------------------------------- | --------------------- | ------------------------------------------------------------- |
| Medusa, PostgreSQL, search, UI   | `23`                  | Major units are the application-wide source of truth.         |
| Stripe request/response payloads | `2300`                | Convert once at the explicitly named Stripe boundary.         |
| Source-review import artifact    | `2300` cents          | Kept as source evidence; uploader output converts to `23.00`. |

### Why a guarded migration exists

Older catalog records were imported using cents even though Medusa v2 expects
major units. The checkout migration includes a one-time, PostgreSQL-only tool
that corrects those legacy values without starting Medusa, Redis, object
storage, search, or payment code.

The tool has two modes:

1. A read-only audit inventories every in-scope amount, compares Medusa's
   numeric and raw representations, identifies records that require manual
   review, and fingerprints the exact candidate set with SHA-256.
2. Apply mode requires both the reviewed row count and fingerprint. It locks
   the relevant tables, repeats the audit inside one transaction, refuses any
   changed dataset, converts only the approved rows, marks the region as using
   major units, verifies every resulting value, and commits. Any failed check
   rolls the entire transaction back.

Existing fixed shipping-option prices that are already valid major-unit values
are preserved. Active incomplete-cart prices and calculated-shipping
configuration are converted with the catalog so a restored cart cannot mix old
and new units. The migration refuses to run when order, payment, capture,
refund, adjustment, or promotion data would need a business-specific decision.

Run the read-only audit from the monorepo root:

```bash
railway run --service Postgres --environment staging \
  pnpm --filter backend run money:audit
```

Apply only after reviewing that exact output and receiving explicit approval:

```bash
railway run --service Postgres --environment staging \
  pnpm --filter backend run money:migrate-major \
  --apply \
  --expected-count=<reviewed-count> \
  --expected-manifest-sha256=<reviewed-sha256>
```

After applying, run the audit again. A healthy result reports `mode: "major"`,
zero proposed conversions, no blockers, and no raw-value mismatches. Rebuild
Meilisearch next so indexed prices match PostgreSQL, then smoke-test catalog,
cart, shipping, tax, and payment totals. Do not reuse a staging fingerprint in
another environment. A database restore is the rollback path for an already
committed conversion.

## Prerequisites

| Tool        | Version / Notes                                              |
| ----------- | ------------------------------------------------------------ |
| Node.js     | 26.5.0 (via `.nvmrc`)                                        |
| pnpm        | 11.17.0                                                      |
| PostgreSQL  | 14+ (Railway provisioned or local)                           |
| Redis       | optional-local; Medusa will fall back to in-memory if absent |
| Stripe CLI  | optional but recommended for webhook testing                 |
| Meilisearch | optional-local; remote credentials supported                 |

> ℹ️ If you are using Railway for staging/production, the same services (Postgres, Redis, Meilisearch, MinIO) are already provisioned. See [Using Railway/Staging Environment Variables Locally](#using-railwaystaging-environment-variables-locally) for mirroring configuration.

## Repository Setup

1. **Clone and enter the repo**

   ```bash
   git clone git@github.com:traweezy/remorseless-records.git
   cd remorseless-records
   ```

2. **Match toolchain**

   ```bash
   nvm use              # respects .nvmrc
   npm install --global pnpm@11.17.0
   pnpm --version       # should report 11.17.0
   ```

3. **Install dependencies**

   ```bash
   pnpm install         # installs workspace deps for backend + storefront
   ```

   > `pnpm install` from the repo root leverages workspace hoisting. You do **not** need to run install in each package unless explicitly noted.

## Environment Variables

Both packages validate environment variables at startup (TypeScript + Zod). Missing or malformed values will throw helpful errors.

### Backend (`backend/.env`)

Copy the template and fill in secrets:

```bash
cd backend
cp .env.template .env
```

Key variables (non-empty values required for full functionality):

| Variable                                     | Notes                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`                               | PostgreSQL connection string                                                 |
| `REDIS_URL`                                  | Required when deployed; powers distributed events, workflows, and cart locks |
| `STRIPE_API_KEY`                             | Stripe secret key (_sk\_..._)                                                |
| `STRIPE_WEBHOOK_SECRET`                      | Endpoint secret for Medusa's official `/hooks/payment/stripe_stripe` webhook |
| `STRIPE_LIFECYCLE_WEBHOOK_SECRET`            | Separate secret for the refund/dispute lifecycle endpoint                    |
| `STRIPE_PAYMENT_METHOD_CONFIGURATION`        | Active Stripe `pmc_...` limited to card, Link, Apple Pay, and Google Pay     |
| `CHECKOUT_BFF_SECRET`                        | Shared 32+ character HMAC key; identical on backend and storefront           |
| `CHECKOUT_BFF_SECRET_PREVIOUS`               | Optional former BFF key accepted only during a coordinated rotation           |
| `PUBLIC_FORM_BFF_SECRET`                     | Different shared 32+ byte HMAC key for contact/privacy BFF proofs             |
| `PUBLIC_FORM_BFF_SECRET_PREVIOUS`            | Optional former public-form key accepted during a coordinated rotation        |
| `CHECKOUT_RECONCILIATION_ENABLED`            | Enables the bounded missed-completion safety net (default `false`)           |
| `CHECKOUT_RECONCILIATION_MIN_AGE_SECONDS`    | Minimum finalized-payment age before retry; default `120`, minimum `60`      |
| `CHECKOUT_RECONCILIATION_MAX_ATTEMPTS`       | Per-run completion-attempt cap; default `50`, maximum `250`                  |
| `CHECKOUT_RECONCILIATION_MAX_SCAN`           | Per-run old-cart scan cap; default `2000`, range `500–5000`                  |
| `CHECKOUT_RECONCILIATION_MAX_RUN_SECONDS`    | Stops starting attempts after this budget; default `90`, range `30–240`      |
| `TAX_RATE_LOOKUP_API_KEY`                    | TaxRate.io key; its returned quota is recorded, never estimated              |
| `TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE`        | Reviewed ZIP for deliberate one-call Admin quota refresh                     |
| `TAX_RATE_LOOKUP_CACHE_TTL_MS`               | TaxRate.io percentage cache TTL; default `300000`                            |
| `STRIPE_TAX_SHIPPING_TAX_CODE`               | Reviewed Stripe shipping tax code; required for Stripe Tax readiness         |
| `STRIPE_TAX_QUOTE_TTL_MS`                    | Stripe calculation cache ceiling; default `1800000`                          |
| `BACKEND_PUBLIC_URL`                         | External URL used in webhooks (e.g., `http://localhost:9000`)                |
| `RESEND_API_KEY`                             | Optional; required for transactional mail                                    |
| `MEILISEARCH_HOST`                           | e.g., `https://xxx.meilisearch.io` or `http://localhost:7700`                |
| `MEILISEARCH_ADMIN_KEY`                      | Corresponding admin/master key                                               |
| `JWT_SECRET`, `COOKIE_SECRET`                | Medusa auth secrets (high entropy)                                           |
| `MEDUSA_FF_RBAC`                             | Must parse as true in production (case-insensitive, no surrounding whitespace) |
| `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | Required together when deployed; official S3-compatible media provider |
| `MINIO_BUCKET`, `MINIO_REGION`, `MINIO_FILE_URL` | Optional storage overrides; bucket defaults to `medusa-media`            |
| `ANONYMOUS_CART_RETENTION_ENABLED`           | Enables daily anonymous-cart soft deletion (default `false`)                 |
| `ANONYMOUS_CART_RETENTION_DAYS`              | Inactivity retention; minimum/default `37` days                              |
| `ANONYMOUS_CART_RETENTION_MAX_DELETIONS`     | Per-run safety cap; default `1000`                                           |
| `ABANDONED_CHECKOUT_RETENTION_ENABLED`       | Enables guest-checkout PII cleanup (default `false`)                         |
| `ABANDONED_CHECKOUT_RETENTION_DAYS`          | Inactivity retention; minimum/default `37` days                              |
| `ABANDONED_CHECKOUT_RETENTION_MAX_DELETIONS` | Per-run safety cap; default `250`, maximum `2500`                            |

### Storefront (`storefront/.env.local`)

```bash
cd storefront
cp .env.local.template .env.local
```

Required values:

| Variable                                           | Description                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                             | Canonical storefront URL (e.g., `http://localhost:3000`)                  |
| `NEXT_PUBLIC_BASE_URL`                             | Local/Playwright storefront URL; keep aligned with `NEXT_PUBLIC_SITE_URL` |
| `NEXT_PUBLIC_MEDUSA_URL`                           | Public Medusa Base URL (e.g., `http://localhost:9000`)                    |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`               | Publishable API key created in Medusa (Admin > Settings > API Keys)       |
| `NEXT_PUBLIC_STRIPE_PK`                            | Stripe publishable key (_pk\_..._)                                        |
| `MEILISEARCH_HOST`                                 | Server-only Meilisearch host (match backend)                              |
| `MEILISEARCH_SEARCH_KEY`                           | Server-only search key (never use an admin key)                           |
| `NEXT_PUBLIC_MEDIA_URL` / `NEXT_PUBLIC_ASSET_HOST` | Optional CDN overrides                                                    |
| `MEDUSA_BACKEND_URL`                               | (server-only) override when the backend runs on a different domain        |
| `REDIS_URL`                                        | Server-only Redis connection used for cart retries and shared rate limits |
| `CART_COOKIE_SECRET`                               | Server-only signing secret; use at least 32 random characters             |
| `CART_COOKIE_SECRET_PREVIOUS`                      | Optional former signing secret used only during a planned rotation        |
| `CHECKOUT_BFF_SECRET`                              | Same server-only HMAC key configured on the backend                       |
| `CHECKOUT_RECEIPT_SECRET`                          | Different server-only 32+ character receipt-signing key                   |
| `CHECKOUT_RECEIPT_SECRET_PREVIOUS`                 | Optional former receipt key for the 30-minute rotation window             |
| `PUBLIC_FORM_BFF_SECRET`                           | Different shared 32+ byte contact/privacy proof key configured on Backend |

### Example local `.env`

```dotenv
# backend/.env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/remorseless
JWT_SECRET=change-me
COOKIE_SECRET=also-change-me
BACKEND_PUBLIC_URL=http://localhost:9000
STRIPE_API_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_LIFECYCLE_WEBHOOK_SECRET=whsec_...
STRIPE_PAYMENT_METHOD_CONFIGURATION=pmc_...
CHECKOUT_BFF_SECRET=replace-with-at-least-32-random-characters
CHECKOUT_BFF_SECRET_PREVIOUS=
PUBLIC_FORM_BFF_SECRET=replace-with-a-different-32-byte-secret
PUBLIC_FORM_BFF_SECRET_PREVIOUS=
CHECKOUT_RECONCILIATION_ENABLED=false
TAX_RATE_LOOKUP_API_KEY=
TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE=
STRIPE_TAX_SHIPPING_TAX_CODE=txcd_92010001
STRIPE_TAX_QUOTE_TTL_MS=1800000
ABANDONED_CHECKOUT_RETENTION_ENABLED=false
MEILISEARCH_HOST=http://127.0.0.1:7700
MEILISEARCH_ADMIN_KEY=masterKey
RESEND_API_KEY=re_a1b2c3...
```

```dotenv
# storefront/.env.local
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_medusa_public_client
NEXT_PUBLIC_STRIPE_PK=pk_test_...
MEILISEARCH_HOST=http://127.0.0.1:7700
MEILISEARCH_SEARCH_KEY=searchKey
MEDUSA_BACKEND_URL=http://localhost:9000
CHECKOUT_BFF_SECRET=replace-with-the-same-backend-secret
CHECKOUT_RECEIPT_SECRET=replace-with-a-different-32-character-secret
CHECKOUT_RECEIPT_SECRET_PREVIOUS=
PUBLIC_FORM_BFF_SECRET=replace-with-the-same-distinct-backend-form-secret
```

## Running the Backend Locally

1. **Install dependencies** (already satisfied by root `pnpm install`).
2. **Ensure DB is running** (local Postgres or tunnel to Railway).
3. **Migrate and synchronize links (first run or schema change)**
   ```bash
   cd backend
   pnpm exec medusa db:migrate
   pnpm exec medusa db:sync-links
   pnpm seed               # new local database only
   ```
4. **Start Medusa**

   ```bash
   pnpm dev                # listens on http://localhost:9000
   ```

   - Liveness: `GET http://localhost:9000/live`
   - Readiness: `GET http://localhost:9000/ready`
   - Official Stripe webhook: `POST http://localhost:9000/hooks/payment/stripe_stripe`
   - Internal checkout recovery: `POST http://localhost:9000/store/checkout/status`

5. **Production build check (optional)**
   ```bash
   pnpm build
   pnpm start
   ```

## Running the Storefront Locally

1. **Ensure backend & required services are available.**
2. **Start the Next.js dev server**
   ```bash
   cd storefront
   pnpm dev                # http://localhost:3000
   ```
3. **Useful scripts**
   - `pnpm lint` – ESLint (flat config, React Compiler-aware)
   - `pnpm typecheck` – TypeScript project references
   - `pnpm test:e2e` – Playwright smoke tests (requires `pnpm exec playwright install`)
   - `pnpm build && pnpm start` – production build preview (`next start`)

## Using Railway/Staging Environment Variables Locally

To mirror staging settings locally:

1. **Install Railway CLI**

   ```bash
   pnpm dlx @railway/cli@latest login
   railway link   # choose the project/service for backend
   ```

2. **Pull backend variables**

   ```bash
   cd backend
   railway variables --service backend > .env.railway
   # Merge into .env (review before overwriting secrets)
   ```

3. **Pull storefront variables**

   ```bash
   cd storefront
   railway variables --service storefront > .env.local.railway
   ```

4. **Recommended approach**: source the Railway file when starting services to avoid committing secrets.

   ```bash
   cd backend
   set -o allexport
   source .env.railway
   set +o allexport
   pnpm dev
   ```

5. **Using `railway run` for one-off commands**
   ```bash
   railway run pnpm dev            # runs with remote env for the linked service
   ```

> Always validate that secrets fetched from Railway do not overwrite local development-only values unintentionally (e.g., pointing to production Stripe keys).

## Stripe Payment Element & Webhooks

### Payment preparation

- The browser posts only the current checkout revision to
  `/api/checkout/payment-session`.
- The storefront server resolves the signed cart cookie, recalculates totals,
  and asks Medusa to initialize the official `pp_stripe_stripe` payment
  session.
- The browser receives the Payment Element client secret. It never receives a
  secret key, raw cart ID, PaymentIntent ID, or order ID.
- Repeated preparation reuses the one valid session; authorized or captured
  sessions are never silently replaced.

### Webhook Handling

- `POST /hooks/payment/stripe_stripe` is Medusa's official payment-state
  endpoint. It validates the raw-body signature with
  `STRIPE_WEBHOOK_SECRET` and listens only for
  `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`, and `payment_intent.partially_funded`.
- `POST /webhooks/stripe/lifecycle` is the additive refund/dispute evidence
  endpoint. It uses its own `STRIPE_LIFECYCLE_WEBHOOK_SECRET` and listens only
  for `refund.created`, `refund.updated`, `refund.failed`,
  `charge.dispute.created`, `charge.dispute.updated`,
  `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, and
  `charge.dispute.funds_reinstated`.
- Both endpoints require Stripe raw-body signature verification. Neither
  endpoint accepts browser credentials or trusts event order.
- Never point the endpoint at the removed `/api/webhooks/stripe` route.

### Local testing

```bash
stripe login
stripe listen --forward-to localhost:9000/hooks/payment/stripe_stripe

# Run in a second terminal; it prints a different endpoint secret.
stripe listen \
  --events refund.created,refund.updated,refund.failed,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,charge.dispute.funds_withdrawn,charge.dispute.funds_reinstated \
  --forward-to localhost:9000/webhooks/stripe/lifecycle
```

Set `STRIPE_WEBHOOK_SECRET` and `STRIPE_LIFECYCLE_WEBHOOK_SECRET` to the
different temporary `whsec_...` values printed by their respective listener
processes. Use only Stripe test-mode keys. See the QA and operations runbooks
for the card, 3DS, decline, response-loss, webhook, and browser-close matrices.

## Search (Meilisearch)

- Storefront uses Meilisearch with TanStack Pacer debounced client for instant filtering.
- The server-side storefront uses a version-controlled filter contract rather
  than fetching Meilisearch settings per request; release validation proves the
  live index supports that contract before the atomic swap.
- Initial catalog search uses a five-minute tagged Next data cache, while
  catalog-wide filters retain 15-minute caches and interactive searches
  continue through the validated same-origin server route.
- Medusa events keep the live `products` index current. Bulk rebuilds never
  clear that live index.
- Local Meilisearch:
  ```bash
  docker run -it --rm \
    -p 7700:7700 \
    -e MEILI_MASTER_KEY=masterKey \
    getmeili/meilisearch:v1.12
  ```
- **Bootstrap or rebuild the index** (re-run whenever products change in
  bulk):
  ```bash
  pnpm --filter backend run search:sync
  ```
- The command creates a versioned `products_build_*` index, applies and
  verifies settings, indexes all published products, and validates exact IDs,
  required fields, stock invariants, a representative title query, facets,
  and sorting. Only then does it use Meilisearch's atomic swap operation.
- After the swap, the command reconciles writes that occurred during the
  build, validates `products` again, and retains the former live index as the
  rollback target. Versioned indexes are eligible for automatic cleanup only
  after seven days based on their controlled UID timestamp.
- Completion reports are schema-constrained, non-executable JSON artifacts
  written through a canonical directory and atomic owner-only file under
  `~/.local/share/remorseless-records/search-rebuild/`; symbolic-link output
  directories are rejected.
- To perform an emergency rollback, copy the exact `rollbackIndex` from the
  completion report and deliberately confirm it:
  ```bash
  MEILISEARCH_ROLLBACK_INDEX=products_build_<version> \
  MEILISEARCH_ROLLBACK_CONFIRM=products_build_<version> \
  pnpm --filter backend run search:rollback
  ```
  The rollback command refuses the live UID, unrelated indexes, empty
  rollback indexes, and mismatched confirmation values.
- Seed the index (example):
  ```bash
  curl \
    -X POST http://127.0.0.1:7700/indexes/products/documents \
    -H 'Authorization: Bearer masterKey' \
    -H 'Content-Type: application/json' \
  -d '[{ "id": "prod_123", "title": "Demo", "handle": "demo", "price": 25, "genres": ["doom"], "format": "vinyl" }]'
  ```

## Release preparation, storage, and health

### Discography ownership and lifecycle

Discography separates store inventory from label history. Published Products
classified as `music-release` are the source of truth for purchasable releases;
the Discography module links to their stable Product IDs and resolves the
current handle only after confirming the Product is still published. Historical
releases are independent records and intentionally have no purchase link.

Open **Content** in the Admin sidebar, then choose **Discography**. Its canonical
route is `/app/content/discography`; old `/app/discography` bookmarks are
replaced without adding a duplicate browser-history entry. The page uses server
pagination, search, source and availability filters, and reversible
Active/Archived views. Product-linked rows direct the operator back to Products
instead of duplicating editable title, artist, format, or artwork fields.
Historical records use a focused create form and edit drawer. All writes require
an expected version and idempotency key, run in a serializable transaction, and
leave an operation audit record; hard deletion is disabled.

`pnpm --filter backend discography:build` performs a dry reconciliation plan.
The confirmed `--apply` form updates or creates catalog-linked rows, archives
stale links, preserves historical records, and writes a completion report under
`~/.local/share/remorseless-records/discography-rebuild/`. The Store API returns
active records only and batches Product hydration, so a deleted or unpublished
Product remains readable as label history without sending a customer to a 404.
The Storefront revalidates this read model every 60 seconds to bound lifecycle
staleness without fetching the full Discography for every visitor.

Application startup is intentionally read-only. It does not migrate or seed
the database, discover or persist secrets, change bucket policy, or rebuild
search. Railway executes the fail-closed backend release command before
traffic moves:

```bash
pnpm --filter backend run release:prepare
```

```mermaid
flowchart LR
  Build[Build immutable backend] --> Migrate[Run database migrations]
  Migrate --> Links[Synchronize module links]
  Links --> Storage[Head-check object storage]
  Storage --> Search[Build and atomically swap search index]
  Search --> Start[Start Medusa]
  Start --> Ready[Expose traffic after /ready succeeds]
```

Production media uses Medusa's official S3 provider against MinIO. It retains
the provider ID `minio` for existing database records, uses path-style
requests, and relies on infrastructure-managed bucket policy. `MINIO_ENDPOINT`
is the API origin without a path; `MINIO_FILE_URL` may override the public
bucket/CDN base. The release storage check performs `HeadBucket` only.

Backend `GET /live` reports process liveness. Backend `GET /ready` checks
PostgreSQL, Redis, Meilisearch, and object storage using bounded timeouts and
returns only dependency names, status, and duration. Storefront `GET /ready`
checks its backend and shared Redis; both Railway services route health checks
to `/ready`. Responses are non-cacheable and never include connection strings
or raw dependency errors.

The Backend/Admin applies global HSTS, CSP, MIME, frame, referrer,
permissions, and dynamic-response no-store defaults. The Storefront creates a
fresh nonce for every HTML request, forwards it to Next rendering, and returns
a matching CSP with `strict-dynamic`, `script-src-attr 'none'`, and
`base-uri 'none'`; production `script-src` does not use `unsafe-inline`.
Webpack SRI remains enabled for bootstrap assets. Because nonces cannot be
reused in static HTML, document rendering is dynamic while tagged Backend and
search data retain explicit caches. Only environment-configured application
and media origins are permitted; production requires HTTPS, and sample image
hosts are not allowlisted. Local development may still use HTTP services.

Catalog product images upload through
`POST /admin/catalog/media/uploads`. This authenticated route requires a UUID
idempotency key, limits request count and size, accepts only JPEG, PNG, WebP,
and GIF, and verifies filename/extension coherence plus file signatures before
delegating persistence to Medusa's File Module. Every stored file immediately
gets a catalog media asset row containing its digest and upload ownership. An
exact successful retry reuses the recorded result. Partial and downstream
failures attempt both database and remote cleanup; incomplete cleanup is
recorded as failed with the owned identifiers retained for reconciliation. An
editor abandoned after upload therefore leaves an auditable unlinked asset for
the orphan workflow instead of an invisible object-storage leak.

News images retain the generic `POST /admin/managed-uploads` route, which also
accepts validated UTF-8 CSV for existing import tooling. The unused
presigned-upload route remains disabled.

The Medusa Admin **Operations → Media cleanup** workspace lists the exact
paginated set of
catalog assets not linked to products, separated into **Needs review** and
**Quarantined** views. Quarantine is versioned, idempotent, actor-attributed,
and protected by the same distributed asset lock as product-media editing.
Quarantined assets cannot be linked, edited, or reused, and they remain
restorable.

Physical media deletion is deliberately unavailable. The displayed 30-day
date is only the earliest future review point; no job or route automatically
deletes the catalog row or File Module object.

The screen shows whether storage is managed by the application, when and by
whom an asset was quarantined, and the earliest review date. External orphan
URLs are shown as text but are not automatically loaded as images in the
operator's browser. Stale edits and assets that became linked after the page
loaded are rejected instead of being silently changed.

```mermaid
flowchart LR
  A[Unlinked active asset] -->|Quarantine| Q[Recoverable quarantine]
  Q -->|Restore| A
  Q -->|30 days elapsed| R[Eligible for operator review]
  R --> Q
  R -. No physical purge implemented .-> X[File Module deletion]
```

## Email (Resend)

- Backend includes Resend notification templates (`backend/src/modules/email-notifications`).
- Set `RESEND_API_KEY` and optionally `RESEND_FROM_EMAIL`.
- Emails dispatch on order placement (via subscribers). To disable temporarily, omit the API key; Medusa will no-op.

## Troubleshooting

| Symptom                                        | Resolution                                                                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run typecheck` fails with engine warning | Ensure `nvm use` applied (Node 26). The repository and staging builds use Node 26.5.0.                                                                                                  |
| Storefront shows empty cart despite items      | Check `rr_cart_v1` for the storefront domain, the cart-signing secret/previous secret, and the same-origin `/api/cart` response.                                                        |
| Payment form does not load                     | Verify test/live key mode matches, the `pmc_...` is active, Stripe origins and custom font loading are allowed, and `/api/checkout/payment-session` returns one official session.       |
| Payment form reloads after changing windows    | Confirm the checkout refetch has the same revision/provider/status and that its in-memory projection retained the prepared client secret; persisted query storage must remain disabled. |
| Stripe payment lacks an order reference        | Open the Medusa order widget, confirm the `order.placed` subscriber ran, and retry the idempotent sync only in the same Stripe mode. Never put customer PII into Stripe metadata.       |
| “Do not pay again” recovery persists           | Check official webhook delivery, backend `/store/checkout/status`, and the capped reconciliation aggregate before permitting another attempt.                                           |
| Confirmed payment has no order                 | Follow `docs/CHECKOUT_OPERATIONS.md`; leave webhook/reconciliation running and do not manually create an order or re-submit payment.                                                    |
| Search results empty                           | Confirm Meilisearch index name (`products`), API keys, and that documents exist. Backend fallback logs to console when Meili query fails.                                               |
| Webhook signature errors                       | Verify CLI tunnel URL matches `BACKEND_PUBLIC_URL` or override Stripe webhook endpoint with the CLI-provided forwarding URL.                                                            |
| React Compiler warnings                        | `next.config.ts` already enables `reactCompiler`. Ensure lint errors are fixed; the compiler is strict about invalid hooks usage.                                                       |

## CI Pipelines

We run three pipelines for `staging` and `master` pushes/pull requests (plus a
weekly schedule):

- **Backend CI**: dependency review, security (Shai-Hulud detector, Trivy FS scan, pnpm audit), secret scan, lint, typecheck, unit tests, CodeQL, build, and an enforced Admin JavaScript bundle budget.
- **Storefront CI**: dependency review, security (Shai-Hulud detector, Trivy FS scan, pnpm audit), secret scan, lint, typecheck, unit tests, and a production build. Pushes and `master` release pull requests also require non-destructive Pixel/iPhone Playwright smoke tests, pa11y, and Lighthouse; ordinary `staging` pull requests can opt into those browser gates with repository variables.
- **Root CI**: dependency review, security (Shai-Hulud detector, Trivy FS scan, pnpm audit), secret scan, and a retained CycloneDX SBOM plus production-license inventory.

Actions are hardened with `step-security/harden-runner` and pinned to immutable
commits. Trivy ignores generated `.medusa` output. Root CI retains the verified
SBOM and license inventory for 30 days. Five Medusa Admin packages omit license
metadata from their published manifests; the verifier permits only those exact
packages because the authoritative Medusa monorepo is MIT-licensed, and fails
if any other production package lacks license metadata. Dependency Review runs
when a pull request supplies a base/head diff. Keep `.env` files local (ignored
by git) and rotate any secrets that were previously committed.

## Release and Branch Workflow

`staging` is the default integration branch and the only branch that
automatically deploys to Railway staging. `master` advances only through a
reviewed pull request from an accepted `staging` commit. Production deployment
is always a separate manual action from an approved exact `master` SHA; merging
does not deploy production. See
[`docs/RELEASE_OPERATIONS.md`](docs/RELEASE_OPERATIONS.md) for the complete
promotion, acceptance, and rollback contract.

---

## QA & Accessibility Checklist

Full runbook with detailed steps lives in [`docs/QA_RUNBOOK.md`](docs/QA_RUNBOOK.md). Quick reminders:

- `pnpm exec eslint --ext .ts,.tsx src` and `pnpm run typecheck` (storefront) / `pnpm --filter backend exec tsc --noEmit` before commits.
- Monorepo check shortcut: `pnpm run qa:lint` (lint + typecheck for storefront and backend).
- Reindex search after catalog bulk changes: `pnpm --filter backend run search:sync` (use `pnpm --filter backend run search:check` to compare Medusa vs. Meilisearch counts).
- Keyboard and screen-reader sweeps on header, Quick Shop, PDP, cart, checkout,
  recovery, and confirmation. Document in the runbook checklist.
- Lighthouse (desktop + mobile) on `/`, `/catalog`, a typed detail route (`/music-release/{slug}`, `/bundle/{slug}`, or `/merch/{slug}`), and the legacy `/cart` drawer entry targeting LCP < 2.5s and A11y ≥ 95. Exercise the drawer interactions separately in Playwright.
- Stripe success, 3DS, decline, processing-error, duplicate, response-loss,
  browser-close, webhook, recovery, and receipt-TTL cases in test mode only.
- Automated bundle: `QA_BASE_URL=<deployed url> pnpm run qa:ci` (runs
  lint/typecheck, Pixel 7 and compact-phone Chrome/axe audits, pa11y axe audits,
  and Lighthouse assertions). Optional overrides:
  `QA_PRODUCT_PATH=/music-release/{slug}`, `QA_EXTRA_URLS=/custom`, and
  `QA_PATHS=/contact,/checkout`.

### Support

- Medusa docs: https://docs.medusajs.com/
- Stripe Payment Element docs: https://docs.stripe.com/payments/payment-element
- Meilisearch docs: https://www.meilisearch.com/docs
- Railway docs: https://docs.railway.app/

When in doubt, open an issue or drop a note in the project instructions. Stay brutal. \m/
