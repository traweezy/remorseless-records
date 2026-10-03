# Storefront, Admin and Stripe end-to-end audit

Status: **in progress; not accepted**. Requested October 3, 2026.

Batch 5 release acceptance is complete at `960fe7b`. Run
`b8517c2c-e013-46bd-9765-e4475641fd82` uses owned-fixture prefix
`RR Audit b8517c2c`. Private inventory/evidence is in
`artifacts/end-to-end-audit-2026-10-03/`. The source inventory has 44 page routes
and 493 control candidates in 187 files; it is a starting inventory, not a
coverage claim. The user has signed into Admin and the Stripe Dashboard confirms
the expected sandbox. No fresh payment/refund has run. The owned shelf creation
failed and rolled back; the product wizard currently holds a browser-only draft.

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

A further live copy finding remains open: Home/About promise worldwide shipping
and international rates. Reconcile those claims against the configured checkout
destinations and shipping policy during the continuing audit before acceptance.

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
