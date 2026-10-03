# Storefront, Admin and Stripe end-to-end audit

Status: **in progress; not accepted**. Requested October 3, 2026.

Batch 5 release acceptance is complete at `960fe7b`. Run
`b8517c2c-e013-46bd-9765-e4475641fd82` uses owned-fixture prefix
`RR Audit b8517c2c`. Private inventory/evidence is in
`artifacts/end-to-end-audit-2026-10-03/`. The source inventory has 44 page routes
and 493 control candidates in 187 files; it is a starting inventory, not a
coverage claim. The user has signed into Admin and the Stripe Dashboard confirms
the expected sandbox. No fresh payment/refund has run. The initial shelf failure
was repaired; the owned shelf now exists and is archived. One owned product was created successfully after the second repair group;
its editor and native summary exposed further issues documented below.

## Initial repair group — deployment and live retests pending

These fixes are part of batch 6, not acceptance of the exhaustive audit. They
must reach staging before the blocked authoring/media journeys can continue.
The full route/control ledger and remaining financial scenarios stay open.

| Finding | Reproduction and correction | Current evidence |
| --- | --- | --- |
| `B6-QUICK-SHOP` / `B4-ASSETS` | A cold optional chunk left a click with no visible drawer. Keep the dismissible drawer shell immediate, lazy-load its content, and offer Retry after a failed chunk. | Failure retained; delay/reopen and failed-download/retry pass on desktop and both phone profiles, plus Firefox/WebKit. |
| `B6-FONTS` / `B5-FONTS` | Google font fetching intermittently broke builds. Vendor 18 byte-identical WOFF2 assets with pinned sources, hashes and four SIL OFL notices. Root-level theme aliases also previously missed body-scoped font variables; define them on the root so Bebas Neue/Teko headings render as intended. | Local production build, integrity verifier and three rendered font cases pass. Browser requests stay local; only four Latin subsets preload. Remaining glyph subsets and existing fallback metrics are retained. |
| `B6-ADMIN-MEDIA` | Native product thumbnails were all blocked by CSP although the media returned HTTP 200. CSP now uses the resolved storage file URL, including the existing endpoint/bucket fallback. | Exact media-origin regression passes; script/connect restrictions stay unchanged. Live image retest pending. |
| `B6-LEGACY-HTML` | Seventeen of 462 active imported profiles failed the existing strict HTML reader and prevented the catalog workspace loading. A bounded transactional migration applies the unchanged sanitizer, updating versions only for changed records. | Read-only staging preview verifies all 17 become readable with unchanged visible text; native PostgreSQL tests verify safe-row preservation and idempotence. Preserve the pre-release encrypted backup; rollback does not restore unsafe markup. |
| `B6-NATIVE-CREATE` | Native Medusa create responses omit unspecified fields; strict readers rejected shelf/profile/media creation, while mocks filled the gaps. Create complete payloads without relaxing decoders. SQL foreign keys represented as scalar model fields also need parent writes flushed before dependent links, within the same transaction. | Native tests cover shelves, stale versions, profiles, new artists/vocabulary, uploads, URL media and reuse. A dependent failure rolls back the parent, reference and audit operation. |
| `B6-FORM-FOCUS` | Empty required fields kept keyboard focus on Continue. Next, Save and Retry now navigate to the first invalid field using the existing step/focus mechanism. | Rendered Admin regression checks Title, then Artist after Title is supplied. All 13 Admin matrix cases pass; live retest pending. |
| `B6-ADMIN-ERROR-HEADING` | Full-page retry states had no semantic heading. The shared retry title is now a heading; the matrix adds the unavailable tax-report state. | The normal tax-report fixture now echoes the selected state/period instead of a hard-coded historical quarter, retaining date/time-zone parsing. Real tax calculations and filing settings are unchanged. |
| `B6-TAX-LINK-CONTRAST` | The official filing-portal link had 3.52:1 contrast on its panel. Tax-report links now use the normal foreground with a persistent underline and retained focus ring. | The initial axe failure is retained; rebuilt 13-case Admin matrix passes with zero axe violations. |

All 13 rebuilt Admin accessibility cases passed with zero axe violations; their
rendered screenshots were inspected. Initial fixture/readiness failures and the
real 3.52:1 contrast failure remain retained alongside the passing correction.

Local Storefront matrices: 90 passed / two documented skips in responsive CI,
57 passed across Chromium/Firefox/WebKit, and 20 launch/receipt/structured-data
cases passed, all with zero retries. Native integration includes 69 Medusa
cases, the payment lifecycle and complete PostgreSQL/Redis/recovery/session
aggregate. These are controlled fixtures, not real Stripe sandbox acceptance.
Backend coverage passed 288 suites / 2,300 tests; Storefront coverage passed
146 suites / 972 tests plus 39 suites / 362 tests. Both production builds and
shared lint/type/policy checks passed. The pre-migration Railway archive audit
passed for archive `15563662-660f-4a52-ba04-b9c1b4b6a783`, created October 3 at
21:36 UTC, preserving the original imported descriptions.

The Admin harness now preserves the browser sandbox, waits for rendered page
readiness and emits bounded diagnostics when a case aborts. Initial incomplete
loading screenshots/navigation failures remain retained. One subsequent matrix
overlapped a local Backend rebuild and is invalid; run builds and their browser
acceptance sequentially against a stable artifact.

The first pushed repair revision, `2e93d66`, was held by both CodeQL jobs for
two missing-anchor findings in font verification code. Exact hostname/endpoint
comparisons replace those regular expressions; 130 policy tests and all three
rendered font cases pass. No finding suppression or CI policy exception was
added. The corrected revision's CI and live results are recorded below.

### Live retests and further corrective work — October 3, 23:00 UTC

Revision `20ba1af7ed08913e3d8df7d3769a099839f90239` passed all four workflows
and 23 required checks: Root `37158889600`, Backend `37158889560`, Storefront
`37158889567`, Runtime Images `37158889597`. Both runtime-image artifact
records/SBOM/scans verified. Backend deployment
`62265a27-9848-4693-bce9-fb276c2cc1d6` and Storefront deployment
`ba7cf054-327d-4e73-85c3-8c593fe1b9fa` reached exact-revision success.
Migration `681f4e41-5dac-407c-b191-766a5103b0dd` completed before Backend
dispatch. All 462 active catalog profiles now pass their strict reader.
Runtime packages, application database role, migration receipt, restricted
notification key and Next backport checks passed. Deployed responsive browsers
passed 84 cases, with eight documented skips and zero retries.

Post-migration backup deployment `2a436c25-e334-420a-8f7b-e5b75afc9146`, execution
`9f1b2eca-a00d-4f98-bf38-8ab98545d935`, completed and published encrypted archive
`924de7ef-8273-4bc9-ad7f-89348abdc311` at 22:47 UTC: four database files and 1,168
media objects. All nine services/jobs were observed. Redis retained its process
identity at 5,899 seconds uptime, healthy persistence and zero OOM, evictions or
rejected connections. The 237 scheduled plus one event failed jobs are preserved.

**This revision is not release-accepted.** Live authoring found additional
boundary failures, and scheduler health retains a 24-hour incident from the
previous `960fe7b` worker. Its 22:32 run started 61,717 ms late, examined 60 carts,
attempted no completions, reported zero failures/held carts and released its
lock. The current worker completed normally at 22:52 with 56 ms schedule delay.
Preserve the latch and investigate; do not delete it or describe a subsequent
heartbeat as clearing the observation window. These corrections remain batch 6.

| Finding | Live evidence and correction | Retest status |
| --- | --- | --- |
| `B6-MEDIA-FILE-KEY` | S3 returns an object key containing `.webp`; the upload/replay decoder incorrectly required a database identifier. Validate bounded provider keys separately and retain the verified key for compensation before validating the returned URL. | Local boundary cases pass, including UTF-8 byte limits and invalid-URL compensation. Native persistence now uses a realistic prefixed key. Live upload retest pending. |
| `B6-CREATE-AGGREGATE` | Final product creation rejected `catalog-product-create:<UUID>` in the shared operation reader and compensated the workflow. Accept only that command's exact namespace bound to its idempotency key. | Full native product workflow creates two priced, stocked variants and replays without duplication; live draft retest pending. |
| `B6-ADMIN-204` | Archiving the owned shelf succeeded, but the pinned SDK parsed the empty 204 as JSON and falsely showed failure. Request and validate a raw 204 for shelf archive and bundle removal. | Native SDK regression passes; live archive/restore feedback retest pending. |
| `B6-CONTACT-FEEDBACK` | Empty Contact submission kept focus on Send; result feedback lacked announcement roles. Focus the first invalid field and expose status/alert feedback. | Four component cases and three rendered browser cases pass; the first test's route-announcer locator ambiguity is retained. Live corrected submission pending. |
| `B6-SHIPPING-COPY` | Home/About promised global delivery, Help promised free shipping above $50, and FAQ/Help contradicted the published 30-day return window. | Shared US-only delivery/rate copy and summaries of the existing return policy are corrected locally. No shipping fees or return policy changed. |

The failed upload left one audit-owned 18,586-byte object with no catalog asset.
Its operation, exact key, SHA-256 and lack of references were verified before
conditional deletion; authenticated HEAD confirms 404. Its compensated operation
history remains intact. The audit shelf was created/edited and then archived;
the failed archive UI must not be mistaken for a failed database mutation.
Private receipts are in the audit evidence directory, including
`owned-media-orphan-cleanup.json`. No fresh payment/refund has run yet.

The final local corrective gates pass: 288 Backend suites / 2,316 tests,
both production builds, 70 native service cases plus 44 payment cases and the
complete disposable recovery aggregate, 93 Storefront responsive browser cases
(two documented skips, zero retries), and all 13 Admin accessibility cases.
The 200-percent Admin validation screenshot also shows the heading partially
beneath the fixed header after focus movement; retain this visual finding for
live inspection. These local results do not replace staging retests, payment
execution, or the outstanding scheduler observation window.

### Corrective release and native Admin findings — October 3, 23:19 UTC

The next corrective group is pushed directly to `staging` at
`e136dc5f84ffa3a6dc966b939f883c6581ec25f5`, with Conventional Commits
`3be3624` (catalog persistence/archive feedback) and `e136dc5` (Contact/copy).
Root `37160902311`, Backend `37160902343`, Storefront `37160902320`, and
Runtime Images `37160902286` all passed, including all 23 required checks.
There were 30 successful check runs and one conditional skip overall. Both
runtime image evidence bundles verified. Railway rollout and live corrected
retests remain pending; this is not batch acceptance.

The push hooks passed lint/types and both Storefront coverage groups: 146
files / 972 tests and 39 transactional files / 362 tests. Private evidence is
under `release-e136dc5/` and `local-corrective-verification/` in the audit directory.
The local CI/service watchers exited with SIGTERM during observation; they were
restarted at 23:17 UTC. Preserve the approximately 23:14:45–23:17:07 gap rather
than claiming uninterrupted local observation. Fresh provider state showed no
service faults and the same supporting-service instances.

Native settings navigation adds 19 settings destinations to the audit ledger.
Refund-reason list/filter/empty/clear/create/edit/cancel checks ran live. The
owned reason uses the `RR Audit b8517c2c` prefix and will be retained if linked
to financial history. Empty create submissions expose `B6-NATIVE-ZOD-RESOLVER`:
no inline errors, no invalid-field state and focus left on Save, with an
uncaught ZodError. An isolated call through Dashboard 2.18.0's actual Zod 4.2.0
and resolver 3.4.2 reproduces it; the resolver expects the removed `errors`
property. Valid create/edit succeeds. Repair this shared native validation
boundary and verify nested/union errors, native focus and unrelated exceptions
before accepting the Admin audit. Do not weaken validation or change React
versions to hide it.

This is **batch 6**, after credential/dependency maintenance and before the
client environment clone in batch 7. Audit the complete shopping and operator
experience, fix findings, and prove the corrected behavior on staging before
creating the client's environment. The [hardening plan](PRODUCTION_HARDENING_PLAN.md#next-session-delivery-eight-separate-staging-batches)
owns the sequence; [release operations](RELEASE_OPERATIONS.md) owns its push,
CI and deployment gates. Production approval remains batch 8.

## Coverage contract and evidence

The user requested interaction with every single thing, including layout,
consistency, unstretched images, correct cursors, real Stripe test-card
payments, Admin/Stripe verification and refunds. This is a hands-on audit plus
repairs, not a smoke-test rerun or a report that defers all discovered fixes.

- [ ] Build the coverage ledger from current source and the rendered app:
      `storefront/src/app/`, shared components/features, Admin routes/widgets,
      native Medusa navigation and role-visible settings. Reconcile source
      routes with navigation, redirects, deep links and actual available data.
- [ ] Give every reachable page, unique control/action and supported workflow
      a ledger row. Enumerate loading, empty, success, validation, error,
      disabled and permission states where applicable. Paginated/lazy content
      must be visited, not treated as covered by the first screen.
- [ ] Record row ID, route/control, fixture/role, browser/viewport, expected and
      actual outcome, candidate/deployed SHA, time, evidence and finding ID.
      Use `not run`, `pass`, `fail`, `blocked` or `not applicable`; the last two
      require a specific reason and never count as passes.
- [ ] Cover every distinct interaction and data shape. Use a documented matrix
      for combinations of browser, width, state and product kind; do not claim
      every possible combination from representative samples. Shared controls
      need their page-specific context checked as well as component behavior.
- [ ] Keep a findings ledger with severity, reproduction, expected behavior,
      screenshots/trace, affected scope, fix commit and retest evidence. Keep
      initial failures and flakes visible after a successful rerun.
- [ ] Store credentials, payment/customer details and raw browser/provider
      artifacts outside Git with restricted access. Commit the redacted
      coverage/results summary and reproducible regression tests. Retain a
      durable private evidence location; temporary paths alone are not archival
      evidence. Do not include secrets or session grants in screenshots.

Existing 85-case deployed browser passes, fixture-only Admin checks and batch
3's comparison of seven historical payments do not satisfy this new audit.
Read [QA](QA_RUNBOOK.md), the [browser README](../storefront/e2e/README.md),
[Admin client guide](ADMIN_CLIENT_GUIDE.md) and
[Admin support guide](ADMIN_SUPPORT_GUIDE.md) before choosing execution tools.

## Execution target and owned test data

- [ ] Verify the current owner `store/staging` environment, exact deployed
      revisions and all services/jobs. Recheck current access and provider
      identity rather than relying on earlier screenshots or login state.
- [ ] Independently confirm Stripe sandbox **Remorseless Records Staging**
      (`acct_1Rkv3jIM4tTeFQ3W`, previously verified in batch 3), both application
      keys, payment configuration and both webhook destinations. Require test
      mode for every payment/refund object. Follow the checkout runbook's
      environment checks; never print credential values.
- [ ] Create a run ID and a manifest of owned test products, variants, content,
      customers/guest buyers, carts, orders and expected stock changes. Use
      controlled test recipients and addresses. Preserve existing records,
      historical payment evidence and the retained failed-job backlog.
- [ ] Inspect test configs, fixtures and seed/reset hooks before running them.
      The inherited account suite drops a database; it must never target shared
      staging. This Storefront is guest-only. Do not invent an account/login
      flow or count the template suite as application coverage.
- [ ] Exercise destructive record operations only on audit-owned fixtures.
      Record cleanup/reversal and remaining intentional test records; preserve
      order/payment/refund audit history. Do not reset shared inventory or
      delete unrelated data to simplify assertions.

The user's request explicitly authorizes sandbox purchases and refunds for
this batch. Apply the [refund runbook](REFUND_OPERATIONS.md) to those identified
test orders; do not ask again merely because it requires explicit approval.
Use native Medusa order/payment actions to issue refunds and Stripe to verify
them. The Refund Operations extension is an investigation/reconciliation
workspace, not a second refund issuer. Real-money transactions and refunds of
unrelated historical orders are outside this batch.

## Storefront interaction inventory

Expand these source-grounded groups into individual ledger rows at execution:

| Area | Required interactions and outcomes |
| --- | --- |
| Shared shell and navigation | Header, desktop/mobile menus, logo, search, cart drawer, footer, back-to-top, breadcrumbs where present, internal/external links, focus return, back/forward, refresh and direct URL entry |
| Home and catalog | Hero, shelves/carousels and arrows, search modal/results, filters, clear/reset, sort, pagination/continuous loading, URL state, no results, long labels, scroll stability and repeated open/close |
| Products | Every current music, merchandise, fixed-bundle and mystery-bundle presentation; typed detail routes and legacy `/products` links; gallery, thumbnails, variant/format/size, price, stock, quantity, bundle composition and quick shop |
| Cart | Drawer and `/cart`, empty/populated states, add/update/remove, repeated additions, quantity limits, sold-out changes, subtotal, persistence, multiple tabs, navigation to checkout and continued shopping |
| Editorial | Discography search/filter/table or cards, release links; News feed, cards/carousels and every published article; About and all current content links/embeds |
| Information and forms | Contact, submissions, FAQ, shipping/help, returns, terms, privacy, cookies and accessibility; accordions, form validation, error/success feedback, privacy requests, consent choices and preference changes |
| Checkout and receipts | Each contact/address/shipping/payment step, edit/back actions, summary mutations, confirmation, return/recovery handlers, missing/expired receipt and older success/confirmed redirects |
| Failures and navigation | Unknown/deleted URLs, invalid product/article handles, slow/missing images, service errors, offline/reconnect, cold navigation, reload, stale tabs and interrupted actions |

- [ ] Enumerate and visit all published content/detail URLs and audit media
      references across the full catalog. Check each unique interaction and
      representative product data shapes on every applicable layout.
- [ ] Confirm consent changes actually affect optional storage/embeds and
      remain consistent across navigation. Validate contact/privacy persistence
      and feedback with owned test submissions. Scope any resulting delivery
      to controlled test destinations; do not message real customers.
- [ ] Exercise `B4-ASSETS`: cold-cache quick shop and repeated navigation with
      realistic latency. Measure chunk/image loading, inspect immediate loading
      feedback, fix the cause/UX as supported by evidence and retain first-run
      failures. A warm-cache repeat alone does not close this finding.

## Visual, input and accessibility review

- [ ] Inspect real rendered screenshots of every route/layout family and its
      interactive states. Use compact mobile (including 320 px), normal phone,
      tablet, laptop and wide desktop, portrait/landscape and 200% zoom. Record
      exact viewport/browser combinations and any genuine device limitations.
- [ ] Run Chromium, Firefox and WebKit journeys plus touch/device emulation;
      inspect the built application in a headed browser. Do not describe
      emulation as physical-device testing. Follow existing QA browser/security
      requirements and retain both screenshot and trace evidence.
- [ ] Check typography, spacing, alignment, content width, colors, borders,
      button/input styles, labels and copy for consistency. Check long content,
      sticky elements, modal/drawer stacking, scroll locking and no unintended
      page overflow, overlap, clipping or layout shift.
- [ ] Compare intrinsic and rendered image dimensions/aspect ratios and
      `object-fit` behavior. Inspect artwork, merchandise, covers, thumbnails,
      galleries, carousels, news and Admin previews. No stretched/squashed
      images; intentional cropping must preserve the intended subject. Check
      loading placeholders, missing/broken assets, alt text and full-size view.
- [ ] Check actual hover cursors and click targets: links/buttons have the
      intended actionable affordance, editable text has a text cursor, inert
      decoration is not misleadingly clickable, and disabled/loading controls
      match their behavior. Check nested icons, cards, overlays and touch
      behavior; cursor styling alone does not prove interactivity.
- [ ] Exercise mouse, touch and keyboard, Tab/Shift+Tab, Enter/Space, Escape,
      focus traps/restoration and focus visibility. Check accessible names,
      error announcement, screen-reader navigation, contrast, target size,
      reduced motion and unavailable/loading states. Run the existing axe and
      visual gates; inspect output instead of relying on passing assertions.
- [ ] Inspect console errors, failed/unexpected requests, hydration, CSP/Trusted
      Types violations and performance during real interactions. Preserve
      security controls and test thresholds while repairing defects.

## Real purchases and cross-system verification

Use [checkout operations](CHECKOUT_OPERATIONS.md#staging-payment-matrix) and
[the QA payment matrix](QA_RUNBOOK.md#2-stripe-payment-element-matrix), checking
current official Stripe test instructions at execution. Use Stripe test cards
only, through the real Storefront Payment Element. Never substitute a mocked
success screen or a directly created Stripe payment for a completed purchase.

- [ ] Complete successful purchases for music, merchandise, fixed bundles,
      mystery bundles and mixed carts, with variants, multiple quantities,
      low stock and applicable shipping options. Verify displayed totals,
      shipping, discounts if configured, and tax against Medusa and Stripe's
      single provider-boundary rounding. Exercise zero-total behavior where
      supported; it must not create a Stripe payment.
- [ ] Exercise all documented test-card cases: success, 3DS success/cancel or
      failure, generic decline, insufficient funds, expired card, invalid CVC,
      processing error and invalid number. Check correction/retry guidance and
      that failed attempts do not produce a paid order.
- [ ] Exercise address/shipping changes, no shipping options, out-of-stock and
      quantity constraints, cart revision changes and summary edits. Preserve
      entered data and valid payment state according to the current contract.
- [ ] Exercise double submission, two tabs, refresh/close after confirmation,
      response loss, reconnect and return/recovery. Test duplicate/delayed
      events using owned test records and bounded fault fixtures; do not
      interrupt shared queues/webhooks for unrelated orders. Prove at most one
      intended charge and order, with no prompt to repay an uncertain result.
- [ ] Verify configured card/Link/wallet visibility and eligibility. Exercise
      supported test flows where the browser/device allows them; document
      unavailable paths as blocked, not passed. Preserve the approved payment
      method set rather than enabling other methods for coverage.
- [ ] For each actual purchase, independently open the Medusa order and Stripe
      sandbox transaction. Privately correlate cart, payment session,
      PaymentIntent, charge, order and event IDs/timestamps. Check items,
      variants, quantities, currency, shipping/tax/discount amounts, payment
      status, inventory/reservation changes and the Storefront receipt.
- [ ] Verify signed webhook delivery and durable processing/reconciliation,
      order linkage and no duplicate or stuck records. A webhook HTTP 200 or
      browser redirect is insufficient. Verify applicable tax evidence and
      controlled-recipient order notification content/idempotency.
- [ ] Test consecutive orders in one browser and receipt expiry/recovery;
      earlier order data must not appear in a later or expired receipt.

Observe the [hosted card-entry automation boundary](QA_RUNBOOK.md#24-browser-automation-boundary).
Use supported real headed interaction for the requested test-card journey.
Provider test PaymentMethods and integration fixtures supplement failure-path
coverage but must be labeled separately. If hosted card entry requires the
user's browser interaction, retain that exact step as blocked until performed;
do not weaken browser security or claim an API-only test met this requirement.

## Admin operations, refunds and downstream consistency

- [ ] Inventory every visible native and project-owned Admin navigation item,
      screen, dialog, table action and setting. Check authentication/session
      expiry and native role permissions, including read-only/denied cases.
      Cover navigation, search/filter/sort/pagination, empty/error states,
      validation, save/cancel, unsaved changes, recovered drafts, lost-response
      retries and stale concurrent edits.
- [ ] Create/edit owned catalog fixtures for each product kind; verify variants,
      SKUs, prices, stock, metadata, artist/genre/format associations, bundles
      and merchandising/shelves. Check publication and search/cache propagation
      on the Storefront, including unpublish and fixture cleanup.
- [ ] Exercise News and Discography authoring, media upload/validation,
      selection/reordering and every exposed image editor control. Inspect
      public images and Admin previews. Test Media Cleanup's supported
      quarantine/recovery workflow only on owned assets; retain the physical
      purge boundary.
- [ ] Exercise native order, customer, inventory, shipping, fulfillment,
      cancellation, return, claim and exchange workflows available to this
      store. Use audit-owned orders/fixtures and verify timeline, transaction
      balance and physical stock effects, including damaged/non-saleable returns.
- [ ] Create full, partial, repeated-partial and shipping-only test refunds
      through the appropriate native Medusa workflow. Verify refund reasons,
      notes, remaining refundable amount and rejection of over-refund/duplicate
      submissions. A payment-only refund must not silently restock goods.
- [ ] Verify each refund in native order/payment history, Operations → Refunds,
      Stripe sandbox and applicable tax records/reversals. Compare individual
      statuses, amounts, counts and remaining balances; check controlled test
      notifications and retry idempotency. Inspect the Storefront's supported
      receipt/recovery behavior without inventing a customer account feature.
- [ ] Exercise pending, failed, canceled, disputed, mismatch and missing-tax
      states through provider-supported test scenarios or isolated integration
      fixtures as appropriate. Record which were live sandbox observations and
      which were fixtures. Do not issue Dashboard refunds to manufacture ledger
      mismatches; preserve Medusa's sole refund authority.
- [ ] Check Operations overview, Tax Control, Tax Records and all exports,
      filters and detail views. Prove both supported tax paths with isolated
      fixtures where a shared policy change would affect other orders. Do not
      change tax collection policy or treat sandbox evidence as legal approval.
- [ ] Inspect Stripe's transaction, refund, relevant tax and webhook/event
      screens for the actual test journeys and reconcile all discrepancies.
      Unrelated Stripe account/Billing/Connect configuration is outside this
      store audit. Keep production provider settings unchanged.

Use [refund operations](REFUND_OPERATIONS.md), [tax control](TAX_CONTROL_OPERATIONS.md),
[tax records](TAX_RECORDS_AND_FILING.md) and the Admin guides for expected
behavior. The fixture-only Admin accessibility suite blocks writes by design;
retain that boundary and use a separate owned-data staging session for live
create/edit/order/refund checks.

## Repairs and completion gate

- [ ] Resolve all discovered functional, visual, image, cursor and accessibility
      defects in this batch, including `B4-ASSETS`, and retest affected journeys.
      Add useful regression coverage for failures and financial/persistence
      boundaries. Do not mark a failed or unexecuted requested flow complete.
- [ ] Reconcile the inventory and coverage ledger: no unexplained omission,
      failure or blocked required journey. Record justified non-applicable
      cases with evidence. If an external limitation prevents completion,
      document the exact gap and keep the audit/client-clone gate open.
- [ ] Run applicable local lint/types, builds, coverage, browser/accessibility,
      payment/refund/tax and isolated integration gates. Preserve thresholds,
      security controls and failure evidence. Review actual screenshots.
- [ ] Group repairs and evidence into one substantive direct-to-`staging`
      batch push with logical Conventional Commits. Required corrective pushes
      remain in this batch. Watch all four workflows and 23 checks on the exact
      final SHA, then exact application deployments and **every** staging
      service/job, including Redis stability and dependency health.
- [ ] On the final accepted candidate deployment, rerun the complete applicable
      browser matrix and affected manual coverage, with fresh actual purchases,
      Admin verification and refunds. Verify correlated logs, payment/queue
      health and no new service crashes. Bind evidence to the final SHA.
- [ ] Publish a redacted audit report: inventory/coverage totals, browser and
      viewport matrix, findings/fixes/retests, real transaction/refund outcomes,
      private evidence references, cleanup and precise limitations. Update the
      handoff and carryover register without erasing earlier evidence gaps.
- [ ] Mark the audit release accepted only after these gates pass. **Do not
      create the client environment before acceptance.** The subsequent clone
      still needs independent acceptance with the client's provider keys.

### Second repair deployment and authoring audit — October 3, 23:40 UTC

`e136dc5f84ffa3a6dc966b939f883c6581ec25f5` passed all four workflows and 23
required checks (Root `37160902311`, Backend `37160902343`, Storefront
`37160902320`, Runtime Images `37160902286`). Exact Backend deployment
`bade75f0-e787-4b9c-94b6-e462f00336bc` and Storefront deployment
`74f2a58d-d961-48ed-bead-845309aafcae` succeeded. Runtime/image/migration and
release readiness checks passed. Deployed responsive browsers passed 87 cases,
with eight documented skips and zero retries. These do not establish payment
acceptance. All nine Railway services/jobs reached expected states; the local
watcher has a documented 23:14:45–23:17:07 observation gap.

Recovery execution `7c43aa89-044b-413d-9fbb-2cc56c33ce51` published encrypted
archive `922ce02b-9f5e-4bd9-ae1e-ec18388e3b6a` at 23:23 UTC (four database files
and 1,168 media objects), before the three new owned audit uploads. Redis retained
its process identity at 7,584 seconds uptime. A 23:30 ordinary scheduler heartbeat
completed with 291 ms schedule delay and no attempted/failed completions; the
previous incident latch and full 24-hour observation requirement remain open.

Actual media upload, ordering and three aspect ratios now work. Native creation
saved exactly one draft `prod_01M421F4YN6SE1TFFXMPXYSPF5` through succeeded operation
`catop_01M421F4X5SPA5BN2W3DTEZERG`. Native Admin confirms both variants have 20
units. The draft remains unpublished pending repair and verification. Three
media objects belong to this run; do not treat the pre-upload archive as their
backup. A controlled native refund reason was created and edited successfully;
no refund or new sandbox purchase has happened yet.

The actual Backend test key, Storefront test publishable key, independent Stripe
sandbox account, payment-method configuration and native/lifecycle webhook
identities were checked again. Contact invalid-submit focus passes live for
Name, Email and Message. All six FAQ accordions pass mouse/keyboard controls,
including Home, and their US-only delivery/processing/return copy is consistent.

| Finding | Reproduction and correction in progress | Acceptance still required |
| --- | --- | --- |
| `B6-NATIVE-ZOD-RESOLVER` | Blank native refund-reason submission throws ZodError instead of showing inline feedback. The pinned 3.4.2 resolver expects Zod 3 `.errors`; native Dashboard uses Zod 4 `.issues`. A bounded compatibility patch retains RHF/React versions and checks all five distributed resolver entry points. | Rebuilt native invalid/valid forms, deployed readback and complete Admin coverage. |
| `B6-CREATE-SUCCESS-NAV` | Successful draft creation navigates before the state update disables its own dirty guard, showing false product-not-created copy. Make the guard decision synchronous. | Actual successful creation redirects without a leave prompt; dirty cancel still warns. |
| `B6-MEDIA-ALT-FOCUS` | Blank image descriptions block progress, but focus remains on Continue. Apply the focus request after the error summary/panel commits. | Actual upload and repeated invalid submissions focus the first missing description. |
| `B6-RICHTEXT-PLAIN-IMPORT` | A newly created plain-text description produces root-level Lexical text nodes and crashes the whole editor (error 282). Preserve inline runs inside paragraphs, existing block order and formatting. | Rebuilt and deployed plain/inline/block editor journeys and saves. |
| `B6-VARIANT-PROFILE-LIST` | The saved owned profile is valid. The authoring reader rejects nonempty variant-profile lists by comparing each ID against an omitted single-ID argument. Keep list membership/uniqueness and single-ID checks while fixing the optional comparison. | Native workflow creation followed by the real authoring reader; deployed summary and storefront. |

Private evidence retains both initial failures and corrected diagnostics. This
remains Batch 6 corrective work, not a new batch or acceptance. The exhaustive
route/control ledger, actual sandbox checkout/3DS/declines/refunds, cleanup,
scheduler observation and final nine-service acceptance are still incomplete.

The native invalid-form regression additionally exposed `B6-NATIVE-FORM-A11Y`:
unnamed FocusModal/Drawer close controls and descriptions pointing at absent
hint elements. The correction covers both Dashboard and the draft-order
plugin's bundled forms. The initial failed axe reports are retained. Shelf
restore/cancel/archive now passes live on `e136dc5`; read-only persistence
confirms owned shelf version 5, inactive and archived. Three owned media assets
retain the original 800×800, 1200×600 and 600×1000 dimensions, intended order
and alt text.

The first local aggregate passed all 70 native Medusa cases, 44 payment cases,
38 PostgreSQL cases and eight Redis capacity cases before Docker Desktop
rejected host `/tmp` bind mounts for AOF recovery. A workspace temporary path
was correctly rejected by the backup ancestor-permission guard. The native
Docker daemon cannot expose its published test ports here; that attempt was
cancelled and owned fixtures removed. The unmodified two-case AOF suite passes
against the native daemon with its normal isolated bind/socket paths. These
are distinct observations, not a claim that one full local aggregate passed;
the exact-revision CI service-container aggregate remains required.

Focused follow-up checks passed all six native session-rotation cases against
the guarded Desktop Redis fixture, and the queue aggregate's eleven replay
modes against the verified native image. Every owned container/network from
those runs was removed. The final Admin unit run passed 65 suites/249 cases;
the preceding full Backend coverage run passed 289 suites/2,320 cases. The
new resolver contract passed 15 cases spanning all five distributed formats.

Final local rendered verification passed all 14 Admin matrix cases with zero
axe violations/incomplete checks and no other findings. A separate compiled
browser assertion verifies the plain description is actually present in a
contenteditable editor. Native validation, wide authoring, and 200%-equivalent
validation screenshots were inspected; the latter now keeps the heading and
focused Artist control visible. Shared lint/type/policy checks, frozen install
and Backend production build pass. Candidate corrections still require their
own exact-SHA CI, deployed retests and service acceptance before closure.
