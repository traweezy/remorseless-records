# Client Admin experience rework

## Outcome

The Medusa Admin extensions must let a non-technical store operator complete
ordinary catalog, content, merchandising, tax, media, and refund-review work
without learning internal IDs, provider terminology, database relationships,
or recovery implementation details.

This is a complete task-flow rework of project-owned Admin surfaces. It is not
a visual reskin. Medusa 2.18 supports custom routes and widgets but does not
support replacing the stock dashboard layout or arbitrary native page content.
Where a native form cannot meet the client workflow, the project will expose a
purpose-built custom route backed by the same authorized Admin APIs rather than
patching large areas of the vendor dashboard.

## Research basis

Medusa's current form guidance uses Focus Modal for creation and Drawer for
short edits, Medusa UI primitives for visual and interaction consistency, and
schema validation with explicit form state. Complex, multi-step work can remain
a dedicated route when a modal would hide navigation, recovery, or review
context.

The accessibility baseline follows WCAG 2.2: every input has an associated
label and necessary instructions, validation errors are identified in text,
the first invalid control receives focus, focus appearance remains visible,
and controls remain keyboard-operable. Error summaries complement inline
errors for long and multi-step forms.

Primary references:

- [Medusa Admin development and customization limits](https://docs.medusajs.com/learn/fundamentals/admin)
- [Medusa Admin custom UI routes](https://docs.medusajs.com/learn/fundamentals/admin/ui-routes)
- [Medusa Product creation](https://docs.medusajs.com/user-guide/products/create)
- [Medusa Product variants](https://docs.medusajs.com/user-guide/products/variants)
- [Medusa Admin form conventions](https://docs.medusajs.com/resources/admin-components/components/forms)
- [Medusa UI components](https://docs.medusajs.com/ui)
- [W3C multi-page forms](https://www.w3.org/WAI/tutorials/forms/multi-page/)
- [WCAG 2.2 labels and instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)
- [WCAG 2.2 error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)
- [WCAG 2.2 error suggestion](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html)
- [WCAG 2.2 focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)

## Baseline surface inventory

The audit covers every project-owned Admin input surface, not only files with a
literal HTML `form` element.

| Surface                             |                          Current concentration | Rework priority |
| ----------------------------------- | ---------------------------------------------: | --------------- |
| Composite catalog creation          |   1,009-line controller plus five step modules | P0              |
| Existing product authoring          |                               2,272-line route | P0              |
| Product and variant profile widgets |                      2,941-line component file | P0              |
| Tax control and provider transition |                      944-line page plus prompt | P0              |
| Catalog merchandising               | 791-line route plus four editor/picker modules | P1              |
| News creation and editing           |            803-line editor plus 694-line route | P1              |
| Discography creation and editing    |              635-line form plus 741-line route | P1              |
| Media cleanup                       |                     697-line operational route | P1              |
| Refund and tax records              |                   read-only operational routes | P1              |

The largest files currently combine server-contract parsing, form state,
mutation recovery, layout, copy, and field rendering. That makes small UX
changes risky and allows conventions to drift. The rework splits task shells,
schemas, field groups, mutation orchestration, and read-only summaries while
keeping domain validation authoritative on the server.

## Information architecture

The custom Admin is organized by client tasks:

- **Catalog**: add a product, edit a product, manage availability, manage
  collections/shelves, and review incomplete products.
- **Content**: publish news and maintain historical discography.
- **Operations**: review refunds, tax records, tax collection, and managed
  media incidents.

Each landing page answers four questions in order:

1. What needs attention now?
2. What is the most common action?
3. What changed recently?
4. Where can I recover or get help?

Technical diagnostics, raw relationship identifiers, provider payload facts,
and migration details remain behind a clearly labeled disclosure. They do not
compete with the ordinary task path.

## Shared form contract

Every reworked form uses one shared contract:

- schema-derived defaults and validation;
- visible labels, concise hints, examples, units, and optional markers;
- a top error summary linked to each invalid field plus inline errors;
- focus on the first invalid field after submit or step navigation;
- unchanged fields omitted from update commands where practical;
- one pending lock that prevents duplicate submission;
- idempotency for create and other retryable mutations;
- explicit success confirmation and a useful next action;
- safe reconciliation after response loss;
- unsaved-change protection and documented draft retention for long flows;
- Cancel/Back/Save placement consistent across all surfaces;
- permission-denied and request-failed states that never mount unauthorized
  queries or strand the operator; and
- responsive behavior, 200% zoom, reduced motion, keyboard completion, and
  screen-reader announcements.

Creation uses a Focus Modal for short resources. Long product creation remains
a dedicated, resumable step flow with a final review. Short edits use a Drawer.
Complex product authoring remains a dedicated route with anchored sections and
a persistent task summary instead of an oversized Drawer.

## Domain-specific changes

### Catalog creation and editing

- Start with the product kind and show only relevant fields.
- Replace raw IDs with searchable, labeled choices and clear empty states.
- Provide safe defaults for common physical releases and merchandise.
- Explain price units, SKU purpose, inventory behavior, release dates, media
  alternatives, and bundle mapping in client language.
- Show customer-visible availability before final save.
- Keep a plain-language final review and link every problem back to its field.
- Split product, variant, media, inventory, bundle, and diagnostics concerns
  into independently tested sections.

### Content and merchandising

- Use a single publishing-status model across news and discography.
- Make archive/restore consequences clear and recoverable.
- Preview titles, excerpts, cover alternatives, schedule, shelf copy, and
  product order before publishing.
- Keep search, filters, selected items, and save state visible when choosing
  products for a shelf.

### Tax and operations

- Present collection mode before provider details.
- Use plain-language impact summaries for disable, re-enable, and provider
  changes.
- Separate routine status from incidents requiring action.
- Keep Refund Operations and Tax Records read-only where Medusa's native order
  workflows remain the mutation authority.

## Validation strategy

Each individual objective runs focused lint, typecheck, unit/component tests,
and relevant coverage before the next objective starts. The complete Admin
section then runs Backend lint/typecheck, the full Backend suite, production
Admin build, authorization/API contract gates, and real browser acceptance.

Browser acceptance uses the actual Medusa Admin in a graphical browser and
retains real desktop screenshots for:

- empty, loading, permission-denied, validation-error, submitting, success,
  response-loss, and stale-version states;
- common laptop, narrow/mobile, and wide-screen layouts;
- keyboard-only and 200% zoom completion; and
- reduced-motion behavior and visible focus order.

## Delivery sequence

1. Shared form, task-shell, error-summary, save-state, and draft primitives.
2. Tax collection mode and Tax Control transition UX.
3. Catalog product creation.
4. Existing product and variant authoring.
5. Merchandising and controlled vocabulary choices.
6. News and discography creation/editing.
7. Media, refund, and tax operational review surfaces.
8. Client guide, support guide, browser matrix, screenshots, and acceptance.

No Admin section is pushed merely because one form looks complete. All locally
executable objectives in the section and the full local section gates must pass
first; GitHub and Railway validation follows that single section push.

## Delivery status

Tax Control and the customer-facing tax-off path are complete. The route
presents the collection decision before provider detail, offers three
plain-language choices, previews frozen decisions, requires the exact disabled
acknowledgement and an audit reason, and reconciles mode/provider/generation
after an ambiguous response. Tax Records, checkout, receipts, payment evidence,
refunds, reporting, and audit history retain the historical collection mode and
say **Tax not collected** without implying exemption. Exact-SHA GitHub and
Railway acceptance completed for commit `c8decf0a5b6b5b6739de76a89865be231902b044`.

The complete Admin rework was delivered across the inventoried input surfaces
in commit `b79d4d4c1b512086775aeab85db8b2e436faaeb2`:

- shared error-summary, task-navigation, save-state, unsaved-change,
  response-reconciliation, and validated browser-draft primitives;
- resumable composite Product creation with linked validation focus;
- TanStack Form and aggregate Zod state for existing Product authoring;
- a split, independently tested Variant profile drawer replacing the former
  2,941-line catalog widget;
- TanStack Form shelf editing and creation with duplicate-product, scheduling,
  discard, archive, and response-loss safeguards;
- News and historical Discography editors with task navigation, browser draft
  recovery, exact field focus, stable retry identity, and update
  reconciliation; and
- a confirmation-first Media Cleanup workflow that makes reversible quarantine
  distinct from physical deletion.

### Catalog-creation second-pass audit — August 30, 2026

The follow-up audit compared the actual 462-Product staging catalog, the
Storefront product and filter contracts, the native Medusa create experience,
and every custom Admin route. The catalog contains 442 music releases and 585
Variants; all Product options are **Format**, all 585 Variants have SKUs, and
none of the 584 priced Variants is free. CD, cassette, vinyl, and their common
two- and three-format combinations dominate the sellable release shapes. Those
facts make an open-ended native Product form, optional SKU, and a `$0.00`
default unsafe for this client.

The completed release is commit
`3f6e9726b18204c96c377e9d289adf5b9966d884`. Root, Backend, Storefront, and
staging-scheduler GitHub workflows passed, and Railway deployment
`fa0c97cc-7c7e-466c-82b7-dfad484bb116` reported the same SHA healthy and ready.
Database, Redis, search, and object-storage dependency checks passed, as did
payment, tax, notification, payment-lifecycle, search, object-storage, and
Admin-RBAC capability checks.
Real deployed-browser acceptance at 1600×1000 covered `/app/products/create`
and `/app/products`: neither page overflowed, no fixture request failed, and
both axe runs returned zero violations and zero incomplete checks. The Catalog
workspace rendered above the native Products table as intended.

Medusa's stock creation route is intentionally generic. Its Product-list
action still links to the stable `/products/create` path, but the pinned
Dashboard route map no longer registers the competing generic child. The
project-owned five-step workflow now owns that canonical path; the former
`/catalog/new` bookmark redirects without adding history. This stays inside
Medusa's supported custom-route model while a source-and-production-bundle
verifier detects vendor drift.

The guided workflow now adds confirmation-first CD, cassette, vinyl, and
combined release templates; controlled Format and Format Detail suggestions;
exact controlled Product Type defaults for all four kinds; generated but
editable missing SKUs; positive-price and unique customer-label/SKU gates; and
direct navigation into scoped Catalog details after draft creation. The API
contract independently requires the same SKU and positive-price invariants, so
UI bypasses cannot create an accidental free or unfulfillable Product.

The native Product list also receives a permission-aware **Catalog workspace**
summary. It makes whole-catalog health, creation, and review visible at the
operator's normal starting point instead of hiding the audit in a script or
support-only route. A pinned Dashboard compatibility correction preserves the
documented `.before`/`.after` widget intent, placing this workspace ahead of
the Product table by default without overriding a saved operator layout.
Informational native Product Type migration remains
non-blocking: controlled catalog Product Type is the current authoring
authority, and the audit does not create a second editable taxonomy merely to
silence historical cutover notes.

Research for this pass also uses Medusa's current custom-route and Product
creation documentation plus W3C multi-page-form, labels/instructions, error
identification, and error-suggestion guidance. The chosen pattern preserves a
clear step count, safe back navigation and browser recovery, field-local
instructions, linked error summaries, and a final review instead of placing a
catalog-sized task in a modal.

Rendered acceptance used the exact production Admin bundle with read-only
authenticated fixtures. The canonical offerings step was inspected at
1,600×1,000 and 760×900; the native Product list and Catalog workspace were
inspected at 1,600×1,000. The final surfaces have no horizontal document
overflow, console errors, failed responses, axe violations, or incomplete axe
checks. The first pass exposed a prohibited accessible name on the generic
availability-preview container; assigning its intended group semantics closed
the finding before acceptance. Reviewed screenshots are
`/tmp/admin-catalog-create-offerings-final.png`,
`/tmp/admin-catalog-create-offerings-narrow.png`, and
`/tmp/admin-product-list-catalog-workspace-final.png`. The corrected Product
list placement was also inspected at 760×900 in
`/tmp/admin-product-list-catalog-workspace-narrow.png`; temporary acceptance
images are not repository artifacts.

Post-deployment rendered acceptance found a shared TanStack Form lifecycle
regression: an untouched server snapshot could be replaced by the empty
initial options on a later React render. Product authoring and Merchandising
therefore showed the selected resource but blank editable values. The
corrective follow-up now keeps each form's initial option identity stable and
preserves loaded Product, shelf, and Variant snapshots across form option
updates. A direct FormApi regression test covers that transition. The same
acceptance pass found and corrected a Media Cleanup tab whose ARIA control
target was missing.

The corrective follow-up passes Backend lint, strict project typecheck, the
repository QA and security-policy gates, all 212 Backend suites and 1,261
tests, and the production Backend/Admin build. Rendered acceptance uses the
exact compiled Admin bundle in Helium with GET-only authenticated fixtures, so
no staging records are created or changed and live authentication is not
bypassed. Product authoring, Merchandising, Tax Control, Media Cleanup, News,
and Discography were inspected at 1,600×1,000 and 760×900. Every project-owned
surface has zero scoped axe violations, no console or failed-response errors,
and no horizontal document overflow. Product authoring was additionally run
in a headed graphical browser and inspected from a real desktop screenshot.

### Product-import lifecycle hardening — August 30, 2026

The supported managed-upload plus plural prepare/confirm path now protects the
operator from ambiguous retries and damaged import plans without adding more
decisions to the task. Preparation accepts only bounded UTF-8 CSV, validates
the Medusa catalog lookup and normalizer outputs, sanitizes the display
filename, and persists an exact create/update plan. Confirmation accepts only a
fresh 24-hour plan with at most 5,000 operations, serializes concurrent attempts
under a distributed lock, and gives Medusa a deterministic transaction ID so a
response-loss retry cannot create the same products twice.

The source upload is removed only after a valid plan is stored, with plan
rollback on upload-cleanup failure. The plan remains recoverable after a
workflow or acknowledgement failure and is removed only after Medusa confirms
the exact created and updated sets. Operator-visible errors remain stable;
server logs keep only phase and aggregate counts rather than filenames, file
IDs, CSV values, or provider diagnostics. The stock import drawer remains
disabled because it starts at the intentionally unavailable presigned-upload
boundary.

### Catalog mutation persistence hardening — August 30, 2026

The guided create and short Catalog edit tasks keep the same operator flow,
but their server-side prerequisites now fail closed. Product and Variant
choices, component ownership, shipping profile, default sales channel, stock
location, created Product/Variant acknowledgements, and inventory links must
return exact runtime-validated identities. Corrupt or ambiguous persistence
data is surfaced as an unavailable operation instead of being presented as a
missing choice, a partial create, or a usable default.

Fixed-bundle mapping metadata is now all-or-nothing. A malformed declared
mapping cannot silently fall back to another component inventory item, and the
bundle workflow verifies the final remote link quantities plus its owned
provenance before completing. Media Cleanup also requires a coherent count and
unique asset rows, so the Admin cannot render a false empty state from a
malformed database response. These changes add no operator fields or technical
decisions; they make existing recovery copy and retry behavior authoritative.

### Store catalog read hardening — August 30, 2026

The customer-facing bundle projection now enforces the same Catalog authority
shown in Admin. Its active profile, component order and quantities, declared
Variant mappings, visible Product relationships, and inventory availability
must all agree. A component Variant cannot be borrowed from another Product,
and a declared bundle target must exist on the requested public Product. Hidden
components remain redacted and unavailable; corrupt persistence is surfaced as
an operational incident instead of being rewritten into a plausible bundle.

This adds no Admin field or client task. It ensures that the bundle composition
and Product visibility configured through the guided Catalog workflows are the
exact state customers receive. The related-product endpoint also returns only
the small artist/album metadata allowlist used for ranking, so unrelated Admin
metadata cannot cross the Store boundary.

Discography, shelf, and News persistence now receives the same treatment. The
customer view accepts only coherent active records that satisfy the lifecycle,
schedule, identity, bounded-content, safe-URL, and relationship invariants
already enforced by the Admin workflows. Shelf and Product-profile metadata is
reduced to the public automation inputs, preventing support notes or future
internal keys from crossing the Store boundary. These checks do not add client
choices; they ensure that an impossible stored state is surfaced for recovery
instead of being silently defaulted into plausible customer content.

### Content authoring persistence hardening — August 30, 2026

News and Discography now validate the exact persistence acknowledgement behind
every Admin list, detail, create, update, archive, restore, and idempotent replay
path. The visible workflow stays simple, but a malformed row, unsafe stored
HTML or media scheme, incoherent lifecycle, mismatched Product link, wrong
version, or incomplete command audit can no longer be shown as a successful
operator action. Pending and succeeded audit rows retain an exact actor,
aggregate, command, idempotency key, request hash, completion time, and result.

News preserves and validates the complete historical response for replay.
Discography validates the recorded entry identity and version and refuses to
return a later edit as though it were the exact old response. This makes the
existing response-loss recovery copy truthful without adding a retry choice or
technical field to either client workflow.

Both authoring surfaces accept only HTTP(S) artwork. News and manual
Discography also require alternative text whenever artwork is present, with the
same accessible validation shown in the form and enforced before a write begins.
