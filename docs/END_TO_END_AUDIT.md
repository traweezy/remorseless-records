# Storefront, Admin and Stripe end-to-end audit

### Tax binding deployed; hosted Stripe and report-date corrections — October 4, 02:12 UTC

Revision `115810960c54e47e63cb3216e94491dff8b067c7` passed Root
`37169204269`, Backend `37169204263`, Storefront `37169204270` and Runtime
Images `37169204318`, with all 23 required checks. Both image evidence bundles
passed verification. Exact Railway deployments:

- Backend `10bf2a0d-38a0-4126-8b8a-553f8ee532e4`, running instance
  `ac59a78f-50c7-48ba-b68e-55374510163a`. Its earlier rollout instance was
  removed; no CRASHED instance was observed.
- Storefront `772b4a8e-edb7-4eb7-8837-34a51fa77edb`, running instance
  `db273351-c00d-4e8a-ba9c-00666a1143ef`.
- Migrations `b6c23547-a854-4231-a5c3-dde7e47f6077`, completed and exited.
- RecoveryBackups `42e6b920-f834-4bcd-97cf-1d333da82971`, one manual execution
  `ed01b8fa-ad91-4e45-a2a5-75c94885423e`, completed and exited. The archive
  `a2178d08-0bcb-48c6-a070-70c3e6dca2dd` contains four database files and
  1,172 media objects; receipt and retention passed. The first acceptance
  read ran before completion and failed closed; the final read passed.

Actual runtime/package/role/ancestor/migration/notification/Next verification
passed. Redis kept its run and instance identity, with 17,332 seconds uptime at
02:04:41 UTC, healthy AOF/RDB and zero OOM/eviction/rejected-connection counters.
The ordinary 02:04 heartbeat matches this revision; the prior 24-hour incident
latch remains an alert and is not cleared. The all-service observer restarted
after its local process exited 143; the gap from 01:55:00.986 to 01:56:48.258 UTC
is retained and does not establish a provider outage. Deployed responsive tests
passed 90 cases, 11 documented skips, zero retries. Their log is retained; an
output-directory copy overlapped the next isolated fixture run and is marked
non-authoritative instead of being presented as deployed screenshots.

The original pending native payment session and PaymentIntent were reused.
Tax binding now reaches Stripe initialization, confirming the corrected
persistence/decoder path, but no card was entered or submitted. The real
hosted script raises `TrustedScriptURL` when it lazily loads its next chunk.
The next corrective group remains local until its full gates pass:

| Finding | Correction and evidence |
| --- | --- |
| `B6-RICH-TEXT-NAVIGATION` | The user's fatal `TrustedHTML`/`innerHTML` stack matches live navigation from the owned shirt to the music release at 02:13:47 UTC. Product descriptions and news articles both used raw HTML insertion. Direct-load tests missed the failing client transition. Render the same sanitized allowlisted content as a server-produced React tree, without an HTML Trusted Types policy. A new catalog-link regression fails against the old build with the exact exception; product/news link, back/forward and repeat-click tests are now required. |
| `B6-STRIPE-DYNAMIC-SCRIPT` | Retain the exact named bootstrap policy and enforced Trusted Types. Install a default policy only when initializing payable checkout, limited to canonical Stripe HTTPS `.js` paths at `HTMLScriptElement src`. Reject HTML, executable text, other sinks, unrelated origins, credentials, ports, queries, fragments and traversal. Unit boundary tests and a real browser fixture prove accepted chunks and rejected sinks. The original loader-only fixture never exercised Stripe's internal chunk creation. |
| `B6-PAYMENT-FONT` | Replace the blocked Google Fonts request with the seven existing licensed Inter subsets. The font verifier compares their face definitions; public font assets alone get cross-origin access. |
| `B6-PAYMENT-TAB-OPTIONS` | Remove accordion-only options from the tabs layout that Stripe correctly warns it ignores. |
| `B6-TAX-PERIOD-RECOVERY` | Native keyboard input proved end-before-start dates request an invalid report and replace all controls with an error screen. Reuse the server's calendar/range limits before requesting; announce validation beside retained controls and focus the correction field. A rendered regression checks reversed/equal/empty/oversized periods make no request and a valid correction loads the precise new workpaper. Earlier automation `fill()` calls changed the DOM without updating React; those silent-reset observations are not treated as product defects. |

Initial local browser attempts retained two test-fixture failures: the virtual
font document had no resolved network address, so Chromium blocked its request
to a loopback server (also when the virtual hostname was localhost). A real
second loopback HTTP origin now exercises cross-origin loading without bypassing
browser protections. Firefox/WebKit do not classify `object.data` as a Trusted
Types sink; assertions now check the browser's declared sink type while retaining
all six HTML/script/URL rejection checks and the CSP embedded-object denial.
The initial matrix outcomes (69/72 critical, 102 passed/3 failed/2 skipped
responsive) and pre-fix navigation trace remain private evidence. All 15 Admin
matrix cases passed; the invalid-period screenshot was visually reviewed and
shows retained workpaper controls, focused end date and inline error.
The first responsive navigation run clicked the mobile card's centered Quick
shop button rather than its title (109 passed, two failed, two skipped). The
trace showed the expected drawer with no HTML exception; the regression now
clicks the linked heading explicitly on every viewport. This is retained as a
test-targeting correction, not an application navigation failure.

The 02:20/02:21 bounded log attempts could not find the exact request in the
runtime response and remain failed observations. A fresh 02:22:15–02:22:27 UTC
probe passed both applications' exact runtime/HTTP correlation, with zero HTTP
5xx, zero unknown warning/error families and no truncation. This short window
does not clear the navigation/checkout findings or the scheduler incident.

Local correction gates: frozen install, shared lint/policy/type checks, the
strict dependency audit (the existing reviewed braces backport remains visible),
both production builds, 291 Backend suites/2,350 tests, Storefront baseline
152 files/1,071 tests and transactional 41 files/403 tests pass. All 78 desktop
Chromium/Firefox/WebKit cases pass, including script/font and real client-link
regressions. The corrected responsive navigation subset passes all six cases;
the final complete responsive run passes 111 cases with two documented skips
and zero retries. Its news/product screenshots and the Admin period-error
screenshot were reviewed. No card has yet been submitted; local fixtures do not establish live
Stripe payment acceptance.

Additional live Admin evidence on the preceding revision: refund search,
attention/tax-mode filters, clear/reset, guidance and refresh passed; no refund
has yet been issued. Media Cleanup pagination and its empty quarantine tab
passed; all 28 historical unlinked assets remain untouched. CT/NY/PA preset
periods were correct, and both NY CSV buttons triggered downloads (contents
not yet verified). Tax Control's enable-review/cancel retained disabled mode,
generation 2 and the prepared checkout. Meilisearch status refresh and owned
product search passed; no sync was triggered. Native Store edit/cancel and
Region inspection passed, but unnamed native toolbar buttons and the currency
combobox remain to repair. Numbered authored tracklist text duplicates the
presentational numbering; review authoring guidance without stripping valid
title text. The Admin browser tab crashed during one date-stepper action; its
cause is unproven, and a fresh normal HTTPS tab reused the authenticated session.

Private evidence is under `artifacts/end-to-end-audit-2026-10-03/release-1158109/`
and adjacent payment preflight/native-session receipts. Batch 6 remains open:
full control coverage, all product kinds, real sandbox cards/refunds, downstream
consistency and final observation are unfinished. **The user's stop boundary
is before Batch 7: do not create or configure the client clone.**


### Canonical presentation deployed; tax binding correction — October 4, 01:46 UTC

Revision `303248c68c18e73fb2b798a4be76a142367648bf` passed all four workflows
and 23 checks: Root `37167693789`, Backend `37167693644`, Storefront
`37167693659`, Runtime Images `37167693776`. Both runtime-image evidence
bundles passed policy verification. Exact deployments succeeded: Backend
`a987f87f-16f0-42bc-b2ba-bc85ebf0db2e`, Storefront
`ab5712aa-b241-4ce3-bd06-17c5f49fcc0c`, Migrations
`10485e83-f1c4-458c-be7c-2a3ac9505bf2`, RecoveryBackups
`dd8de5ef-8cd6-400a-adff-697fabb948c5`. The migration completed/exited with
its receipt; the backup's single requested execution
`8b441c5a-5ed2-4b84-9315-2a164ad75982` completed/exited and published archive
`d6349ecc-1842-4f91-a622-3785fb2c5ea7` at 01:33:42 UTC. It contains four
database files and 1,172 media objects, including all owned audit artwork.
Receipt SHA-256: `9df50853dd0c7343653fde2eb90fb8391aa6a30df74b7fd3fb8d0bf2beb528df`.
Retention and exact application readiness/runtime/role/ancestor credential,
migration, notification and Next checks passed. Manual backup execution does
not establish the first 04:00 calendar run.

All nine services/jobs remained successful through observation. Redis retained
its same process identity at 15,374 seconds uptime, UID 1000, healthy AOF/RDB
and zero OOM/evictions/rejected connections. The first generic diagnostic was
unverified; a fresh diagnostic with phase labels passed the same checks. The
ordinary 01:34 heartbeat completed on this SHA; the earlier scheduler incident
remains latched at 503. Preserve its full observation window and historical
failed queues. Monitoring resumed at 01:16:36 after the prior bounded watcher
ended at 01:08:05; do not describe the gap as observed.

Deployed responsive browsers passed **90 cases with 11 documented skips and
zero retries**; three skips are canonical fixture cases requiring local data.
Live bare-handle merchandise navigation, canonical description/details,
prices/sizes and disabled out-of-stock L pass. A description saved in Admin at
about 01:39 appeared on the storefront after its normal cache window. Music
artwork, artist, description, tracklist and credits now render. Square,
landscape and portrait alignment targets retain circular proportions; gallery
arrows/thumbnails work. The cart renders its canonical square artwork.

Live checkout saves shipping and creates one native $6.23 USD payment session,
but the Payment Element is blocked. One explicit Retry reproduced the failure;
no card was entered/submitted and no order/refund is claimed. The owned cart
is `cart_01M424D3P0ZHA5T404RF2JDRV9`; retain pending native PaymentIntent
`pi_3UMeJMIM4tTeFQ3W0QNUoBMl` (`requires_payment_method`) and reuse its session
for the deployed retest. Fresh actual-process preflight confirms the expected
Stripe sandbox, test key/publishable key, payment-method configuration and both
native/lifecycle webhooks. No credentials are stored in this document.

| Finding | Evidence and correction | Status |
| --- | --- | --- |
| `B6-TAX-EVIDENCE-CREATE` | Actual checkout returns Backend 500, “Tax quote evidence was not persisted exactly once.” Native create omits unspecified nullable association/order/transaction fields; the strict reader rejects it. Explicit nulls preserve the full contract. | Reproduced before repair in native integration; all three tax modes now persist, replay identically and reject conflicting amounts without duplicates. |
| `B6-TAX-LINK-MODE` | The Backend response omitted collection mode and the Storefront required a non-null provider even for disabled collection. | Return the mode and strictly discriminate collect/provider versus disabled/null; invalid combinations and extra fields still fail. |
| `B6-CART-SUBTOTAL` | Actual cart shows $6.23 subtotal, $5 shipping and $6.23 total for a $1.23 item. Native cart subtotal already includes shipping. | Display native item subtotal; preserve final Medusa total. Focused regression passes. |
| `B6-PRODUCT-OPTION-COPY` | Merchandise sizes are grouped as “Available formats”; related copy always describes vinyl. | Use “Available options” and product-appropriate related copy. |
| `B6-TRACKLIST-NUMBERING` | Numbered authored lines display an additional decorative number. | Open presentation review; preserve authored titles. |

Backend coverage passes 291 suites/2,350 tests. Storefront coverage passes
150 files/1,028 tests and 41 transactional files/403 tests. Both builds, root
lint/type/policy checks and full disposable integration pass: 72 native Medusa
cases, 44 payment cases and the complete recovery/session aggregate. An earlier
corrected aggregate passed its tests but its receipt writer collided with a
prior filename; retain that exit-1 attempt. The fresh uniquely named aggregate
exited 0 and cleaned every owned container/relay. The 66-case cross-engine
browser matrix passes before the additional subtotal display correction; the final rebuild then passed six focused cross-engine cases and five
responsive cases with no retries. Desktop/mobile rendered screenshots were
inspected, and the seven-case cart component regression passes.

Bounded supporting logs retained one PostgreSQL reset/open-transaction EOF pair
at 01:32:55.470, coinciding with rollout/backup startup; causation is unproven.
There was no observed PostgreSQL restart. Meilisearch's flagged lines are native
INFO successful index batches with zero failed tasks; startup's flagged Backend
line is the audit-role command on stderr. A Storefront cart read returned 500
`cart_unavailable` at 01:33:55 (request `23305f37-00b4-4f66-bafd-ecd198ea46ec`);
its underlying cause is unproven and needs follow-up. The 01:40–01:46 follow-up contains no further support warnings or application
errors; that bounded observation does not establish the earlier cause. Known
payment failures remain open until the correction is deployed and exercised.

Private receipts, original failures and runtime bundles are retained in
`artifacts/end-to-end-audit-2026-10-03/release-303248c/` with a checksum manifest.
Owned payment proof and preflight are adjacent private artifacts. Full route/
control coverage, all product kinds, actual sandbox cards/refunds and final
service/log acceptance remain open. **Finish Batch 6, then stop before Batch 7;
do not create or configure the client clone.**


### Inventory/gallery correction and canonical display work — October 4, 01:08 UTC

Direct staging revision `459276dbcdebf3bba30b8e98efb923775ae82ae8` contains
`73a9197` (native cart inventory) and `459276d` (gallery, privacy focus, returns
copy and font loading). Root `37165518230`, Backend `37165518236`, Storefront
`37165518249` and Runtime Images `37165518247` passed all 23 required checks.
Both current runtime-image evidence bundles verified. The Storefront artifact's
initial verification rejected download permissions; correcting only the owned
artifact directory to 0700/files to 0600 passed without changing its content.

Exact Railway application deployments succeeded: Backend
`057b1443-4c45-46dc-a88f-732ee3819df9`, Storefront
`5113d4e8-9f44-4e82-8ca6-7053bf95e8e4`. Migrations
`3d3cdf95-ea2f-41c9-b4ee-41a5938d76eb` completed/exited. RecoveryBackups
`a43c489a-eae1-4434-a859-58d3fb2d1eb3` completed its explicitly triggered
execution `ed20313e-8e9c-4b88-b1ad-e848fd5e60d1`, publishing archive
`e0d27bff-2d5f-48b3-ac82-007fef713810` (four database files and 1,172 media
objects, including all four owned uploads). This does not prove calendar cron.
Both runtime/process/role/migration/notification/Next checks pass. All nine
services/jobs are healthy at provider level. Redis retained its same process,
healthy persistence and zero OOM/evictions. The ordinary 01:02 heartbeat carries
this SHA, but the historical scheduler incident remains latched at 503; the
24-hour observation requirement is still open.

Live checkout now opens. Empty Contact focuses its email error; valid controlled
Resend test-recipient entry saves. Empty Delivery focuses the error summary,
its first-name link focuses the field, and a synthetic California address saves,
including optional address line and the state chooser. Delivery then fails:
`B6-SHIPPING-CONTRACT`. A guarded read of the owned cart proves Medusa 2.18
returns only `shipping_options`, without pagination. The Storefront decoder
incorrectly required count/limit/offset. The correction accepts that native
complete shape and still rejects partial/coercive pagination, duplicate IDs,
invalid amounts and malformed options. Real payment/refund remains not run.
Native quote requests then exposed `B6-SHIPPING-CURRENCY`: both configured
calculated rates return invalid-data because Medusa's standalone workflow omits
the currency field required by our provider. The same-version core-flows patch
adds the native query field; the USD-only provider validation remains intact.
See the dependency audit for patch provenance and the native HTTP regression.


Deployed responsive browsers: **88 passed, two failed, eight documented skips**,
zero retries. Both failures identify the owned bare-handle merchandise's legacy
product link. Retain the screenshots/traces; do not count this release as full
audit acceptance. Local pre-push browser coverage passed 96 cases/two skips and
63 cross-engine cases; those fixtures did not reveal the live catalog mismatch.

The next correction joins a bounded, publication/channel-filtered catalog
presentation to native product reads. It supplies authored artwork/alt text,
rich copy, artists, tracklist, credits and merchandise details to detail, quick
shop, catalog and cart. Native financial/inventory fields remain authoritative.
A read-only source inventory found 464 products/profiles, 463 with media links,
and zero native-only thumbnails. Existing catalog profiles own intentionally
empty media too, preventing removed/quarantined images from reviving legacy
thumbnails. Legacy display remains only when no profile or media exists.
Typed pages try prefixed then bare handles, checking product kind; creator label
input/validation now agrees with editing. These changes are local and their
deployment/live retests remain pending. Local verification passed 99 responsive
browser cases/two documented skips and 66 Chromium/Firefox/WebKit cases, all
without retries. Desktop/mobile canonical merchandise screenshots were reviewed;
pa11y reported no confirmed WCAG2AA violations and retained carousel contrast
manual-review notices. Its first launch could not find Puppeteer's default
Chrome; reusing the existing pinned Playwright Chromium with its sandbox passed.
The first native shipping fixture lacked its provider/location link; adding the
normal native link allowed the real API USD quote and EUR rejection to pass.
The earlier disposable aggregate caught the newly added route's stale inventory
count; the generated API inventory and its exact counts were updated, then the
full native/recovery/session aggregate passed. Original attempts are retained.
The corresponding private artifacts are under `local-canonical-shipping-verification/`.
Final Backend coverage passes 291 suites / 2,348 tests; Storefront coverage
passes 150 files / 1,017 tests plus 41 transactional files / 392 tests. Both
production builds, frozen installation, root lint/type/policy gates and the
70 native service cases, 44 payment cases and full recovery/session aggregate
pass. The new core-flows patch is present in the packaged Backend. After the
final cache-key/typography changes, all three focused browser engines pass
without retries; the rendered canonical merchandise screenshot was reviewed.
The all-service watch completed its bounded run at 01:08 and resumed at 01:17;
retain that observation gap instead of claiming continuous coverage.



Private receipts, original failures and coverage: `release-459276d/`,
`live-coverage-459276d.json`, `owned-cart-native-shipping-proof.json`, and
`presentation-coverage-readback.json` in the ignored audit evidence directory.
**Finish Batch 6, then pause before creating/configuring the client environment.**


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

### Native-form deployment and customer-journey blockers — October 4, 00:25 UTC

`8aaedfe5a9494d2250b396741653514f67151d8a` reached staging after all four
workflows and 23 required checks passed: Root `37163393798`, Backend
`37163393742`, Storefront `37163393811`, Runtime Images `37163393765`.
Both complete runtime evidence bundles verified against current policy.
Backend deployment `43ef2eda-07f7-42b6-9323-189d5da74e21`, Storefront
`f44d4760-06d6-44e2-a3f4-11ef1ae7592e`, and migration
`cc4ff232-a9ef-4feb-921c-e9c4a9a091f9` succeeded. Migration completed and
exited with its exact receipt. Runtime packages, database role/ancestor
isolation, restricted notification key and Next backport checks passed.

RecoveryBackups deployment `81e3045e-237c-42ac-8b7c-2eacff8e41b1` executed
as `bbf0a95f-adc2-4d53-8ab2-a301d71a2653` and exited. Archive
`c8b752d8-1b92-4ef1-aab0-185ed65504f5`, created at 00:10:25 UTC, contains
four database files and 1,171 media objects, including all three owned audit
uploads. Receipt SHA-256:
`41c60100180bb395d992faec2cdb64581ec81b412bfebe8204b78428c3dc2795`.
Retention checks passed. Redis retains its original process identity at
10,528 seconds uptime, with healthy persistence and zero OOM, eviction or
rejected connections. All nine service/job states were observed; scheduled
jobs exited normally. Evidence is under private `release-8aaedfe/`.

Live Admin retests now pass for the Ready product summary, both variant prices,
plain-content editor import, rich-text edit/save/reload, publication, and empty
native refund-reason validation. Native validation focuses Label, associates
its error, and exposes a named close button. No extra refund reason was created.
The owned product is published for the real purchase matrix; its history and
three managed assets remain retained.

| Finding | Actual reproduction | Correction/status |
| --- | --- | --- |
| `B6-GALLERY-POINTER` | At 320 px the real merchandise gallery ignored arrow clicks; keyboard and thumbnails worked. The shared button's pressed transform replaced the arrow's centering transform and moved the target away before pointer-up. | Center arrows with a positioning wrapper; retain normal pressed feedback. Mouse, keyboard and touch regressions pass locally. |
| `B6-PRIVACY-REPEAT-FOCUS` | After fixing Name/Email, another invalid privacy submission updates errors but leaves focus on Submit. | Re-run summary focus for each new validation result, retaining field editing focus. Unit and rendered regressions pass; form delivery is intercepted in tests. |
| `B6-ABOUT-RETURN-COPY` | About still said case-by-case returns and always customer-paid return shipping. | Match the existing 30-day policy and damaged/incorrect-item exception. No policy change. |
| `B6-CART-INVENTORY` | The owned CD adds correctly at $1.23, but checkout and Retry fail before contact/payment. Native Medusa 2.18 cart reads omit computed inventory even when requested. An independent native product read returns 20 units in the same channel. | Read bounded, identity-checked availability from the native product endpoint. Preserve strict quantities and native commerce authority; completed-cart recovery must not depend on current stock. Return safe problem JSON for projection errors. Local verification is underway. |
| `B6-CANONICAL-PRESENTATION` | Search renders managed artwork and artist, but detail displays Artwork unavailable, omits artist/tracklist and reads the old description. Cart shows No image. | Open. Connect customer presentation to canonical catalog/media reads without duplicating commerce authority or exposing internal diagnostics. |

No fresh payment/refund has run: checkout is blocked before payment. The broader
route/control ledger, remaining native create/media-focus retests, all product
kinds, actual card/refund matrix, controlled contact/privacy delivery and full
scheduler observation remain open. Do not clear the scheduler incident latch.
The user's latest instruction is to pause before creating or configuring the
client environment after this audit; Batch 7 must not start automatically.

A local broad browser run passed 94 cases, skipped two documented cases and
failed two discography cases because the fixture was absent during its build.
The failed evidence is retained; rebuild with the owned fixture active before
rerunning the unchanged matrix. A subsequent build also exposed a webpack
warning from looking up `map` on a named JSON export; copy the font preload
array before mapping, retaining the same four URLs and font integrity checks.

Final local verification passed 148 Storefront suites/997 tests, including the
41-suite/387-test transactional gate. The fixture-backed responsive matrix
passed 96 cases with two documented skips; the final artifact passed all 63
Chromium/Firefox/WebKit critical cases and 12 focused gallery/privacy/font
cases, without retries. Rendered desktop/mobile gallery and privacy feedback
were inspected. The font manifest now uses its default JSON export and an
explicit array copy; the final production build has no JSON-export warning.

The actual owned merchandise creation now verifies successful redirect without
a false leave prompt and repeated missing-alt-text focus. Its five sizes
include an out-of-stock L variant. One new managed square image retains its
800×800 dimensions and alt text; this post-backup upload must be included in
the next backup. Two further customer-journey findings remain open:

- `B6-TYPED-HANDLE`: the creator defaults to a bare merchandise handle. Search
  builds its typed `/merch/…` link, but that detail route looks up only a
  prefixed handle and returns 404. Verified by following the actual search link.
- `B6-MERCH-LABEL`: merchandise creation omits label selection and succeeds,
  while the subsequent editor refuses to save without a label/source. The
  owned fixture used the existing Remorseless Records label to continue.

Keep these findings within Batch 6. The successful local checks do not replace
the exact pushed CI, deployed checkout retest, real sandbox transactions or
the still-open canonical-content and full interaction audit.
