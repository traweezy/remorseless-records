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
- [Medusa Admin form conventions](https://docs.medusajs.com/resources/admin-components/components/forms)
- [Medusa UI components](https://docs.medusajs.com/ui)
- [WCAG 2.2 labels and instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)
- [WCAG 2.2 error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)
- [WCAG 2.2 focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)

## Current surface inventory

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
