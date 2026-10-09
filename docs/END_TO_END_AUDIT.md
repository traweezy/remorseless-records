# Storefront, Admin and Stripe end-to-end audit

### Disposable image compiler correction — October 8 evening

The direct RBAC correction push `e5cecff` passes its normal hooks and the full
1,158-commit history scan. Backend CI stops at the disposable-image scan before
native tests: PostgreSQL gosu/Go 1.27.1 has thirteen UNKNOWN findings with fixed
Go versions reported. PostgreSQL retains three MEDIUM and no HIGH/CRITICAL;
Redis retains one MEDIUM and no UNKNOWN/HIGH/CRITICAL. Preserve the exact failed
job and digest-verified reports; no earlier-local/CI database hash match is proved.
All four original push workflows are terminal: 22 required passes, one failure.

The narrow fixture correction rebuilds the same gosu source with official
checksum-pinned Go 1.27.2 for both architectures. Standing delegated security
authority is recorded in the dependency audit. Database/base/module pins,
application policy, npm cooling and scanner thresholds remain unchanged.
The rebuilt amd64 image verifies Go 1.27.2, unchanged module hashes and real
gosu privilege drop. Fresh strict scans retain zero UNKNOWN/HIGH/CRITICAL and
three/one MEDIUM findings with unchanged database bytes across scanning.
All 112 boundary coverage tests pass. The new full-only normal fixture passes
all 233 tests, including 131 native and 44 payment cases. All 663 source hashes
remain unchanged and all 344 relay connections close with zero active clients.
Independent reads prove 343 spawned clients are reaped, both relay ports closed
and exact owned containers, network and volumes absent. Its immutable
evidence is under `isolated-http-go1272-20261009-0145/` in the October 8 audit
artifacts. The preceding 233-test local pass is retained separately. No new
release, Gallery re-save, initialized repair or mystery payment is accepted.
Continue exact corrective CI/Railway/live acceptance first; client clone stays paused.

### Native RBAC fixture correction — October 8 evening

Correction `6c3713c` clears all exact secret scans and passes Root, Storefront
and Runtime Images. Backend fails only disposable integration: 22 required
checks pass, one fails, and all four workflows are terminal. The actual native
suite passes 121/131 tests; ten initialized HTTP cases reject missing RBAC at
their prerequisites before mutation assertions. The earlier private full run
set that flag, while the normal disposable runner did not.

The runner now enables actual RBAC before child startup without changing
application policy or the fail-closed HTTP checks. Twenty-nine boundary tests
prove omitted/disabled ambient flags and a hostile installed-loader `.env`
cannot disable it. Fresh strict image scans pass; the full-only normal aggregate
with deliberately disabled parent RBAC passes all 233 tests. All 662 source
hashes remain unchanged and all 345 relay connections close. Independent reads
verify no owned containers, networks, volumes, listeners or relay children remain.
The normal boundary coverage gate passes 111 tests. Retain the original CI,
private path-selection failure and fresh cleanup evidence. No new revision
is deployed or accepted. Existing native user identity was read in Profile and
Users and its edit canceled unchanged, with no credential/session export;
refresh that evidence on the accepted deployment before the three owned gallery
re-saves and initialized repair. Client cloning remains paused.

### Corrective release scan — October 8 evening

The grouped push reached `5aba8a5`; its original four workflows completed with
15 required passes, three Gitleaks failures and five dependent skips. Runtime
Images passed, but this release is not accepted. Railway held the new candidates
and the previous accepted `b6e494f` instances continued running.

The pinned full-history scanner reproduces seven synthetic idempotency UUID
findings from two earlier test commits. Six active tests now use clearly
artificial, schema-valid UUIDs; only the seven exact historical fingerprints
are recorded. Full-history scanning with the correction and 154 affected tests
pass. All other rules, files and future findings remain enforced. Normal gates,
a scan of the committed correction, the corrective staging push and all its
exact CI/deployment/live checks remain required. Existing `5aba8a5` private
release helper copies must not be executed for the new correction. No live
repair/re-save, client clone or production action is established by these tests.

### Evening continuation — October 8

The approved scanner publication blocker is resolved without a waiver or
alternate registry. All ten actual initialized native HTTP cases pass: repair
three, managed gallery two and Variant ownership five. The unchanged full
normal disposable services pass 233 tests, including 131 native integration
and 44 payment regressions. Source hashes remain unchanged and all owned
fixtures, listeners and relay clients are cleaned up. A prior full repeat hit
the real rate limit after focused tests reused its Redis window; that failure
is retained and a fresh full fixture passes without changing limits/assertions.

Catalog details now supplies the missing managed Gallery path. It arranges
existing images, preserves the seven link fields, asset metadata and other
form drafts, and uses one durable UUID/body with cross-tab locking and native
actor verification. Exact replay returns the current gallery after a later
writer; independent operation history remains the historical receipt. The
87 focused UI / 15 API tests, shared QA, both builds and 313 Backend coverage
suites / 2,959 tests pass. All 18 compiled phone/desktop cases and 24 main-scoped
Axe scans pass on the final build with zero violations/incompletes; all frames
are inspected. Cursor, keyboard focus, contained images and recovery controls
pass. Missing alert roles exposed by four original failures were corrected;
raw failures and the bounded rounded-edge focus-oracle diagnostic are retained.
The Storefront build uses owned deterministic read-only fixture inputs and
passes the 112-client-asset secret and Trusted Types policy gate.

The original native Variant diagnostic confirmed foreign-parent and mixed
200/title mutations without reparenting. Its narrow guard now checks every
update ID before delegation. Real native cases prove same-parent create/update
success, missing/foreign 404 with no partial writes, denied-role 403 and the
existing terminal delete 409, preserving native validation and policy groups.

These are local results. The grouped staging push, four exact workflows / 23
checks, app/Migrations/RecoveryBackups identities, all-nine Railway observation
and live acceptance remain required. The three actual owned gallery re-saves,
initialized repair and exhaustive executed audit ledger remain open. Client
cloning remains paused; never repeat completed orders #8–#11.

### Continuing corrective audit — October 8

Staging `b6e494f` now passes all four exact push workflows / 23 required checks,
its exact Backend/Storefront/Migrations deployments, runtime/role/restricted
notification identity, ordinary scheduler, live/ready and fresh correlated
application logs. Authenticated RecoveryBackups completion binds 1,182 archived
objects and 19 retained snapshots; this is not a repeated full restore or PITR
proof. The restarted all-nine observer retains the deliberate 29,729.717-second
gap. The removed Backend instance's particular cause remains unverified.

The deployed corrective artwork/404 matrix passes all 13 cases without
retries/skips, all 60 card observations / 119 keyboard advances and 23 inspected
frames. Square/contained images, complete metadata, availability behavior and
keyboard access pass. Artist contrast is 7.3645:1 and complete-card/artist Axe
checks have zero violations/incompletes. These before/after-bound results close
the deployed card contrast and cold-404 findings for this exact revision.

**Release acceptance still fails on search counts.** A complete independent
native/index/public comparison matches all 464 published product IDs and all
15 format OR memberships across 85 pages, including the Relics negative case.
However, 299 public facet cells inflate counts and vary across pages; definitions
also miss one CD and one Vinyl because quantity-prefixed bundle labels are not
normalized. The pending Storefront correction counts canonical indexed products
once, preserves bounded scan work and refreshes relevant cache identities.
Retain the complete failed semantic report and original bounded transport/helper
failures; correct membership is not correct count acceptance.

**Local search correction — October 8, 09:34 UTC:** Conventional Commit
`ffd6891` corrects all 299 canonical cells across the 85-page retained full
catalog fixture and all 16 baseline/OR ID sets. Quantity bundles are included;
counts are CD 282, Vinyl 126, Cassette 130 and DVD 1. Eight focused files / 89
tests, full Storefront coverage and the actual production build pass. Desktop
keyboard/Axe and both mobile keyboard/count/closing/overflow checks pass.
The two strict mobile Axe cases retain a contrast incomplete for the exact
drawer heading. A separate manual review verifies 14.1913:1 contrast and every
unobscured heading character at 393/768 pixels. No automated result is rewritten
and no broad rule exclusion is added. New deployed search acceptance remains.

Fresh anonymous recovery also stays on `Confirming your order` after the status
API's explicit HTTP 404 / `cart_missing`. A frozen client correction converts
only that definite absence, requiring both actual HTTP and parsed problem
status 404, into the existing catalog redirect and stops
polling; uncertain responses retain payment recovery. Conventional Commit
`32ebe2b` contains this correction. The failing baseline is
retained, including the reproduced HTTP/body status mismatch. Four focused
suites / 55 tests and final guarded full coverage pass 1,130 baseline / 417
transactional tests with unchanged thresholds.
The normal production build/112-asset verifier and 12 compiled recovery cases
across desktop Chrome, Pixel and native WebKit pass. Deployed correction
acceptance remains.

Fresh deployed read-only completion covers Contact/Privacy invalid-field and
native selector behavior, empty-cart/missing-receipt navigation and phone Quick
shop closing/focus return. The corrected pinned WebKit run passes three iPhone
cases; original WebKit-to-Chrome launch failures remain retained as harness
errors. Desktop Quick shop keeps its strict contrast incomplete on the actual
description paragraph. Root manually resolves only that node: 7.69554:1
contrast, all 546 glyphs unobscured and identical complete before/after frames.
No source/rule exclusion or rewritten automated pass occurs. The settled
missing-receipt alert is separately inspected. All four profile groups complete
two-tab consent, Discography and editorial/FAQ navigation/reflow checks. Consent
telemetry is locally fulfilled and does not prove external delivery; native
WebKit keyboard scrolling and viewport reflow do not prove unsupported wheel
or native zoom actions. Original harness failures remain retained.

A hash-bound primary-source reconciliation resolves all seven complete actual
index sort orders across 464 products/56 pages, including accented titles and
the three null creation dates. Its 20 offline cases prove the oracle correction;
the original strict failure remains. Separate bounded SQL/index reads prove
those three owned Products have finite persisted dates but null indexed dates.
The transformer drops native Date values permitted by ProductDTO. Its scoped
finite-Date correction in `d60a5b1` passes 34 focused tests, 303 Backend suites
/ 2,713 tests and the normal compiled build; live projection repair remains
pending. Deployment alone does not rewrite the existing indexed nulls. No synthetic
date or index write was used.

All four catalog diagnostics also complete seven sort controls, query/history,
clear and scrolling. Strict scans reveal a phone heading hierarchy defect and
toolbar contrast incompletes. The local correction adds a hidden results h2 and
removes only the tagline's foreground alpha, preserving card headings and
header translucency. All five baseline cases fail; actual browser-composited
tagline contrast is 3.7929:1 over the modeled brightest backdrop. Corrected
build/112-asset checks and all five focused browser cases pass. Corrected
composited contrast is 5.03878:1 with all 18 glyphs unobscured; all three card
and results rectangles remain unchanged and all 15 baseline/final frames are
inspected. Eight later settled all-rule main scans have zero violations and zero
initial incompletes. Four sticky cases retain 12 strict `imgNode` contrast
incompletes. Root's separate exact-node review resolves those with inspected
frames, visible text/native placeholder paint and conservative composited bounds
of at least 4.86418:1. Native scroll is settled and Axe moves no scroll. All raw
failures remain unchanged; no full-document or deployed acceptance is claimed.
Conventional Commit `448e303` contains this bounded visual/heading correction.

Native Admin saved sign-in works. The real Product page confirms missing
control names, shrinking phone toolbar targets, missing filter-dismissal focus,
empty native table headers and absent breadcrumb landmark. A same-version
UI/Dashboard patch was verified using the complete compiled native
page, full-document closed/active-filter Axe, actual keyboard behavior and
phone/desktop light/dark frames. Native modal-menu contextual diagnostics remain
recorded; do not change RBAC or modal semantics merely to pass a scanner.
The foreign Variant-title batch hypothesis still needs isolated HTTP proof.
Reparenting is refuted by installed ProductModule source.

Predecessor shared QA and Backend coverage (303 suites / 2,699 tests) pass. The native
67-case matrix adds mobile drawer focus, real row/menu/filter interactions,
Settings and denied Role-detail controls.
Read-only Settings inspection also finds unnamed selection controls, squeezed
phone headers and nested-combobox Escape closing the Regions edit drawer.
These remain explicit audit findings until their exact compiled/live retests.
The first full run retains 60 passes and seven failures. The frozen predecessor
passes all 67 browser cases and 134 component contracts after scoped dark-text
and active-filter corrections. Short-heading geometry,
closed-popover animation and native drag click-shield timing are separately
evidenced harness findings. Actual Product Type creation additionally exposes
missing native dialog registration, missing Cancel focus return and blocked
button Enter activation. The scoped Title/Description, route-invoker fallback
and KeyboundForm corrections pass 142 component checks and the normal build.
Both new browser pilots prove native empty-submit validation without requests,
focus trapping and Cancel/Escape return. The expanded 69-case matrix completes
with 68 strict passes and the one retained automated failure below.
The phone Description's strict contrast incomplete is retained separately from
Root's exact-node manual resolution: all 46 glyphs unobscured, opaque contrast
7.72982:1 and the complete frame inspected. No scanner rule is excluded.
Latest broader Backend coverage/shared QA pass. Actual signed-in
read-only navigation reaches all 19 Settings pages at 458 pixels without
document overflow or visible alerts, bound by fresh before/after readiness.
This inventory does not close their distinct form/control workflows or prove
every asynchronous row; no key reveal or configuration/access changes occur.
Conventional Commit `30c385e` contains the seven frozen native paths. Exact
whole-lock review permits only four patch/dependent peer identities; versions,
integrities, native authorization and the reviewed React trees are unchanged.

The held orphan-repair tool has another execution boundary: full Medusa exec
initialization writes search settings/provider/default rows and can remove
Workflow Redis repeatable jobs before the scoped script runs. This review did
not execute those effects. Both private execution helpers are now explicitly
disabled before provider access, preserving their original bytes. Three
zero-provider guard checks pass. A narrow replacement must preserve the existing
owned manifest, atomic repair and replay contracts; no repair has run.
A narrow initialized Admin boundary is now in local verification, reusing that
serializable service and native policies with actual-user/expected-actor replay
binding. Six focused suites / 168 tests and Backend/integration types pass;
three actual HTTP integration cases are prepared but unrun behind the scanner
gate. Its six-path session-auth screen passes 72 focused tests, types and
response-boundary checks with independent review. Durable shared storage and
native Web Locks retain one immutable UUID/body across uncertainty and reload;
only a matched acknowledgement enables clearing after a fresh user check.
The repository wrapper blocks source/built/symlink repair launches before any
child/bootstrap; its 26 focused tests retain normal command behavior. This is
local work, not a deployed repair acceptance. The compiled native lifecycle
exposes a real initial-effect remount/read-lock race; a captured-epoch microtask
cancels only the obsolete initial read. Two focused regressions and a fresh
14-case 393/1440 run pass, with 16 main Axe scans clear. Six additional main
scans and inspected frames resolve below-viewport capture in the same four
contexts, for 22 clear scans and 22 inspected final PNGs. The framing run retains
one failure from PageDown outside the focused main; focusing an existing
control resolves the capture without source or mutation changes. Owned fixtures
close with verified identity/session exit and free ports; unrelated processes
and user tabs are preserved. Final combined Backend
coverage passes 309 suites / 2,840 tests, shared QA and the build pass. Initial
fixture binding failures and the real 10-pass/4-fail race run remain retained.
The user requests a pause at this committed local correction checkpoint; no
new staging push or provider repair is started.

The next strict integration/release gates are externally blocked: a fresh,
empty-cache download of the approved Trivy DB is expired because four upstream
publications failed on an expired Docker Hub organization token. The normal
Backend and Runtime Images/recovery freshness checks remain unchanged. Wait
for successful approved GHCR publication and fresh scans; continue independent
audit work. Primary evidence is retained in the opening handoff. No push,
mirror substitution, freshness waiver or speculative Variant guard was made.

Redis deep checks retain the same October 3 run/process identity, healthy
memory/persistence and no observed OOM, eviction, rejection or restart.
Supporting-service logs expose unmatched child warnings. Exact observed child
PIDs match a natural later RDB warning family; the old private timeout-based
reader left adopted children. Its corrected bounded read-only runner passes
17 offline cases and actual all-14-child cleanup with zero new init-child delta.
Older warning provenance and cumulative error replies remain separate facts;
no forced save, restart, failed-job retry or blanket log suppression occurred.

Orders #8/#9/#10/#11 remain completed; never repeat them. Order #11's actual
in-app Copy item SKU shows Copied, but its clipboard bridge yields empty text;
retain this live limitation without claiming an application bug. A separate
compiled native Order Summary test at 390 pixels confirms the exact SKU through
the real browser clipboard and restores its previous contents.
A separate guarded read-only inventory verifies all 464 published Products,
592 Variants and 1,147 managed links/assets without observed before/after drift.
Only three owned historical audit Products need native-thumbnail repair; all
Variant projections match. Draft/deleted Products and historical order artwork
are excluded. Use the existing audited media workflow with fresh source/version
guards after corrective acceptance; no blanket backfill is needed.
No live orphan repair, thumbnail repair or mystery payment has run.
After this current batch's corrective release is accepted, continue those owned
workflows, media/search controls, full Admin/clipboard acceptance and the final
executed ledger. Client cloning remains paused and production is untouched.
Exact evidence and current local gate state live in the opening handoff.

### Active correction — October 7, 23:52 UTC

The deployed staging baseline `d3809e5` passes all four exact CI workflows/23 checks,
exact Backend/Storefront/Migrations, runtime/role/migration/notification proof,
ordinary health and fresh correlated logs. Eight deployed cold 404/history
cases and all eight final screenshots pass. Five deployed carousel cases
verify 60 actual cards/97 keyboard advances and ten inspected canonical frames.
They expose `B6-SOLD-OUT-METADATA-CONTRAST`: the whole-card black 45% overlay
reduces the sold-out Vorum artist to 2.875:1 at 12px. This correction remains
visually unaccepted until the artwork-only overlay repair deploys and passes;
Axe incompletes were manually investigated, not ignored. Sold-out empty price
is the existing explicit contract, with its badge and disabled Quick shop.

The cohesive local batch includes compensated native Product/Variant artwork
projection, immutable shared source URLs, native ownership guards and the CSV
import-confirmation bypass repair. Real cart-to-order snapshots and payment/tax
hooks pass; historical orders remain unchanged. The final aggregate passes 223
cases: 121 native, 44 payment, 38 PostgreSQL, 11 Redis, three API and six session
cases. All 32 final frozen hashes match; owned fixtures are removed. Six focused
suites / 73 tests pass. Shared QA and Backend build pass; final Backend
coverage passes all 303 suites / 2,699 tests. Unique owners and bounded cleanup preserve
committed success; 120-second leases remain finite. The native delegation
inventory preserves installed authorization and policy grouping. Guarded API409
allows custom ownership problems and native JSON conflicts; ordinary native
errors keep their existing contract.

The rendered Catalog guidance widget passes scoped keyboard/cursor/Axe checks
at 390/1440 pixels, but the full native Product page fails for unnamed native
filter/sort buttons and shrinking phone toolbar targets. Those failures remain
open. Existing managed thumbnail drift needs inventory and guarded audited
reconciliation; deployment does not bulk backfill records. The unrelated
ordinary Variant batch foreign-parent behavior is an unverified source finding
awaiting isolated HTTP proof. Current native Admin navigation redirects to login.

Fresh guarded native/profile/index facts confirm the cassette mismatch is a
false substring match in the album title Relics. The local word-boundary fix
matches Backend precedence/aliases, with changed cache keys. Final Storefront
build and 1,097 baseline plus 403 transactional tests pass. After the overlay
and opaque-badge changes, all ten artwork/availability cases and all 114
critical cases pass without retries. All 30 final frames are inspected and all
15 full-card Axe scans have zero violations/incompletes. Artist contrast is
7.36:1; badge contrast is 7.69:1. Retain the original keyboard-focus flake,
two harness failures and the independently corrected prefix-reading error.
Creation's shared-asset rollback race was reproduced in real supported workflows.
Final native tests now prove parent/shared ownership through compensation,
inherited child lease coverage and transaction-level drift rejection. Implicit
reuse retains clone semantics and exact committed retries create no extra asset.
The 100-old/100-new gallery restores its complete bounded 200-asset snapshot
after a late failure. Retain the data-loss reproduction and all three failed
subsequent aggregates. Five negative assertions needed the SDK's exact serialized
rejection shape. The sixth failure exposed configured native lock compensation
rebinding inside a condition; moving that acquisition outside the condition
now releases its actual UUID and permits the second Product's next metadata
write without waiting for expiry. Exact replay after later catalog/native
changes remains guarded by the original persisted binding and HTTP existence
checks. No dependency patch or authorization change is involved.
The private ledger maps 30 dated evidence groups to 21 families/all 44 routes;
493 AST candidates remain candidates, not individually executed controls.

The opening handoff records exact deployments, failed provider/fixture checks,
current source gates and remaining ownership/payment/authentication work.
No live orphan repair or new mystery purchase has run. Client clone remains
paused. All-nine/Redis monitoring, completed historical order cleanup and
restricted Resend/MFA/wallet limits remain intact.

### Resumed correction — October 7, 21:51 UTC

The user resumes Batch 6; the client clone remains paused. Fresh b7014fb
readiness passes all four workflows / 23 checks, exact app deployments,
live/ready and backup freshness. All nine services are observed without faults.
The 29,725.014-second deliberate observer gap is retained. Redis remains on
the same healthy process with historic 237 + one failures untouched. Ordinary
same-SHA scheduler completion at 21:52:00.057 UTC is healthy with incident
null, proving natural recovery after its latch window without manual clearing.

| Finding | Current local correction and remaining acceptance |
| --- | --- |
| `B6-FAILED-CREATE-ORPHANS` / execution arguments | Native exec bridge retains bootstrap, role/path behavior and literal args; actual installed boundary and script/container-failure regressions pass. Fresh deployed preview, manifest/before review, guarded apply/replay and retained-assets/history proof remain. No live cleanup has run. |
| `B6-CAROUSEL-ARTWORK-CROP` | Scope the fixture's missing presentation rows, preserve square media with contain, grow cards to metadata and wrap full titles. Five-width, three-shape production screenshots pass; bounded ribbon geometry resolves eight Axe overlap incompletes without rule filtering. Exact deployed acceptance remains. |
| `B6-ERROR-FALLBACK-TRUSTED-TYPES` | Minimal 404 HTML skips the root Zod script; React recreation hits the exact inert-script HTML sink and Zod later probes Function. Synchronous pre-hydration instrumentation removes the rendered bootstrap and retains all CSP/TT controls. All eight cold missing-page/history and existing structured-data/receipt production regressions pass. Exact deployed acceptance remains. |

Final local gates pass both builds, lint/type/policy, 297 Backend suites /
2,521 tests, Storefront baseline 1,078 plus transactional 403 tests, all 33
launch cases and all 114 Chromium/Firefox/WebKit critical cases. All 41 final
launch screenshots are inspected. Ten Pixel 7/iPhone 15 Pro card-flow cases
and six independent Pixel/compact layout/accessibility checks pass with actual
phone emulation and the sandbox enabled. Two separate native-width Pixel 7/
iPhone 15 Pro artwork cases also pass with verified viewport, screen, touch,
pixel ratio and user agent; these are Chrome profiles, not physical iOS proof.
The independent layout fixture uses intentional missing-art placeholders;
the final framed native artwork captures are being completed. Earlier failed
fixture/focus/Axe and profile-harness attempts remain intact.
These checks do not establish a deployed or exhaustive audit pass.

**Additional live finding — `B6-NATIVE-ARTWORK-SNAPSHOT`:** retained native
order #11 renders a Photo placeholder with no image elements, despite its
three authored uploads rendering in the Storefront. Source review confirms
native Catalog creation/media changes never project product/variant thumbnails;
Medusa snapshots those native fields into order items and the receipt consumes
the snapshot. Add a compensated projection from authoritative managed media
before future order snapshots, including variant ownership and unlink/rollback.
Preserve existing historical orders; do not rewrite #11 or repeat its cleanup.

**Search finding — `B6-CASSETTE-FACET-PARITY`:** live search and native Medusa
have the same 464 published Product IDs. Built-in document/settings/stock
checks pass, but current public definitions advertise 131 cassette products
while the actual Storefront format OR filter returns 130. CD, Vinyl and DVD
counts agree. Compare current per-variant native/profile facts for the missing
member before choosing source correction or claiming full facet acceptance.
No search rebuild/swap or catalog mutation has occurred during these reads.

The native Copy-SKU control shows Copied, but the CUA session clipboard reports
zero items and no matching bytes. Its previous empty session clipboard is
restored. This remains unverified rather than a successful clipboard test;
OS/page/session clipboard parity has not been established. Safe screenshot
and private receipt are retained in the October 7 directory.

A new Catalog workspace request displays Access check could not complete;
its retry leaves the same state. The retained order's rendered content does
not establish fresh authentication. The existing native sign-in tab has no
filled credentials. Keep authentication intact and continue independent work;
do not repeat authorization questions or claim live media controls passed.

Music #8, mixed #9, standalone merchandise #10 and fixed bundle #11 already
have real hosted purchase/cleanup evidence. Mystery bundle is the remaining
distinct paid family. Media quarantine/restore, guarded search parity,
clipboard and individual recovery/control-ledger items remain; fixture or
basic health passes do not close them. Preserve previous failed attempts and
explicit Resend/live MFA/wallet limits. No new correction push has occurred.
The opening handoff provides fresh receipt paths and operational boundaries.


### User-requested pause — October 7, 13:36 UTC

Batch 6 is unfinished; Batch 7's client clone remains paused. Exact staging
`b7014fb4a352a162130687aca4bfbf5e2ea84cac` passes all four push workflows /
23 checks, both application deployments, Migrations, readiness/basic live/
backup freshness and exact runtime/role/Resend/Next-backport checks. The private
October 7 directory retains final service and correlated-log evidence, including
earlier unsuccessful diagnostic attempts. The fresh 13:34:50.495–13:35:01.601
UTC log window passes both correlations with zero HTTP 5xx, unknown errors or
truncation. The longer diagnostic includes two intentional acceptance guard
400s; its unchanged classifier expects only its own one. All-nine snapshot at
13:36:21.089 UTC has no failed/crashed services or instances; the temporary
watcher stops at 13:36:34.010 UTC. This does not accept the exhaustive audit.
No new implementation push follows this checkpoint.

**Order #11 cleanup is complete:** the deployed remaining-quantity default
shows one bundle after the first receipt. Successful second native receipt
leaves cumulative received two / damaged zero, Return received and CD stock
20 / reserved zero at 13:26:30.788 UTC. One native USD 12.64 refund includes
shipping. Independent Stripe/Medusa verification at 13:28:44.194 UTC agrees
on full successful refund, reconciled refunded tax evidence, processed refund
events and seven unique durable successful controlled notice acknowledgements.
Stripe's visible sandbox dashboard corroborates USD 12.64 Refunded and native
Admin shows zero remaining paid amount. The fixed bundle's final landscape
image is also inspected. Do not repeat orders #9, #10 or #11 cleanup.

| Open finding | Evidence and next action |
| --- | --- |
| `B6-FAILED-CREATE-ORPHANS` / execution arguments | The deployed guarded preview changes nothing: installed CLI yargs drops flags after the repository wrapper's separator, so required repair arguments are absent. Fix native invocation with an actual boundary regression; decode structured logger output, then obtain a valid owned manifest before guarded apply/replay. No apply or valid manifest exists. |
| `B6-CAROUSEL-ARTWORK-CROP` | Live Mystery Bundle at 574 pixels renders related image boxes 570.4 × 184.8 with cover, visibly cropping square/portrait art. Fixed carousel height shrinks nominal square media. Repair card/media sizing and containment, then inspect complete frames and metadata across five widths. |
| `B6-ERROR-FALLBACK-TRUSTED-TYPES` | The new owned carousel fixture currently returns 404 before reaching its carousel. Retained trace reproduces TrustedHTML innerHTML and TrustedScript failures and the global error UI. Resolve fixture routing, then repair/test ordinary not-found/error navigation without weakening CSP or Trusted Types. This is a fallback reproduction, not passing carousel evidence. |

The fixture modification and new five-width browser test remain uncommitted,
along with these checkpoint docs. No carousel/component/CSS or wrapper repair
has been implemented. Preserve failed runs and unknown port 3000; owned
fixtures use 3017/4027 with the browser sandbox enabled. Deep Redis acceptance
at 13:17:10.964 UTC retains the same process with healthy persistence and zero
evictions/rejected connections/OOM; historical queue failures are untouched.
Record the intentional observer pause and renew it on resume. Keep the
scheduler latch through 14:18:40.644 UTC plus fresh ordinary healthy evidence.
Paid-family coverage, media lifecycle, search parity, clipboard/MFA and the
executed-control ledger remain open; restricted Resend delivery events remain
an evidence limitation. See the opening handoff for ownership and restart steps.

The following entries are historical where their state differs.

### Current compensation and native Admin correction — October 7, 13:01 UTC

Exact staging `f910ceface6b0eca14f80eb051a57846fa832ed5` passes all four
push workflows / 23 checks, both application deployments, exact runtime/
migration-role/restricted-Resend identity and fresh correlated logs. Basic
live/readiness/backup gates pass at 12:16:03.328 UTC. All-nine observation
remains active with retained gaps; the initial Backend instance's removal
reason remains unverified. Migrations exits successfully and RecoveryBackups
is idle `CREATED`, not evidence of a new archive. This does not accept Batch 6.

**B6-FIXED-BUNDLE-CREATE — deployed retest passes:** fresh native draft
creation and publication succeed with three owned uploads. Stripe test 3DS
cancel leaves zero orders/payments/captured amount and CD stock 20 / reserved
zero at 12:45:00.859 UTC. Retry authenticates on the same PaymentIntent,
`pi_3UNuAyIM4tTeFQ3W0dfgjdXU`, creating exactly order #11
`order_01M4B6HGVMJGPPJJM43M9Z5ETG`. Independent Medusa/Stripe evidence at
12:49:09.996 UTC agrees on USD 12.64 captured, USD currency, test mode and
four CD component reservations for two bundles. Native fulfillment contains
four CDs; synthetic shipment/delivery and return request two complete.

**B6-PARTIAL-RETURN-NAVIGATION — deployed retest passes:** the first usable
bundle receipt retains received one / damaged zero and returns two components
to stock (16 → 18), zero reservations. At 12:57:39.734 UTC the native Return
is partially received and ordinary Summary still offers Receive items. Five
controlled notices have successful durable acknowledgements; the partial
receipt correctly emits no full-receipt notice. The initial read verification
mistakenly includes historical order-item versions; retain its failure and
corrected exact-current-order-version evidence. Keep the second receipt for
the next deployed remaining-quantity retest, then complete the USD 12.64 native
refund and independent Stripe/tax/notification/stock cleanup. Do not recharge.

| Finding | Current correction and evidence |
| --- | --- |
| `B6-BUNDLE-DELETE-COMPENSATION` | Restoring native inventory links with new IDs fails strict provenance and prevents profile restoration. Preserve snapshotted IDs verbatim. Real PostgreSQL late-completion compensation and successful delete/replay pass. |
| `B6-FAILED-CREATE-ORPHANS` | Guarded staging-only Medusa CLI previews a full-row-digested ownership manifest, then requires that unchanged SHA and a new UUID. Atomically soft-delete only proven dangling profiles/media links while retaining assets/history and one repair audit. Nine native cases prove cleanup/replay, completion rollback and seven ambiguous-ownership rejections. Live repair remains pending after deployment. |
| `B6-REMAINING-RECEIPT-DEFAULT` | Actual second receipts default to original requested quantity and return 400 after one unit already arrived. Use requested minus received (damaged is included), exclude completed lines, retain native mutations/RBAC. Ten installed main/lazy execution cases pass; deployed second receipt remains pending. |
| `B6-ORDERS-KEYBOARD` | Both native Orders implementations gain keyboard order links, 24-pixel targets, pointer cursors and visible focus while keeping existing outer links in the legacy table. Screenshot review exposes clipping despite the initial matrix passing; a strict ancestor-clipping assertion reproduces it, and the inset outline fixes it. |
| `B6-ORDERS-TABLE-CONTROLS` | Name the legacy Country header and actual UI column visibility trigger, prevent the trigger from shrinking below 24 pixels, preserve native handlers. Modern/legacy tables at 390/1440 pixels pass keyboard Enter navigation and strict accessibility/layout checks. |

Final frozen installation, both production builds and 88 installed native
contracts pass. Backend coverage passes 296 suites / 2,514 tests. Full
native/service integration passes 91 cases plus 44 payment cases, PostgreSQL
recovery, Redis capacity/AOF/replay/live aggregate, API/session boundaries
and cleanup. Final 50-case Admin acceptance passes with zero axe violations
or incomplete checks; mobile/desktop modern/legacy focus screenshots are
inspected. Full/prod dependency audits and the current 1,693-file candidate
source scan pass unchanged reviewed backports. Final lint/type/policy passes;
direct-push hooks and exact staging CI/rollout/retests remain. Only Dashboard/UI patch hashes
and two dependent peer identities change; registry versions/integrities and
all other lock content are unchanged. See the dependency audit for exact hashes.

Square/portrait containment is inspected; retain the initial cold landscape
load failure and finish its final visual proof. Old order #9/#10 payment and
stock cleanup is complete; do not repeat it. Restricted Resend reads remain
401, so independent provider delivery events are an explicit evidence gap.
No extra messages or wider key scope are authorized by that gap. Copy-SKU
clipboard proof, live MFA, remaining paid families, media lifecycle, search
parity and executed controls remain open. Preserve the ordinary scheduler
incident latch through October 7, 14:18:40.644 UTC plus fresh healthy ordinary
observation. The client clone remains paused; production is untouched.

The following entries are historical where their state differs.

### Current catalog correction — October 7, 11:56 UTC

Exact `7d224eb3cebf11181248fc3ae0ee7e2e77c3dc26` has all four CI workflows /
23 checks passing, both applications successfully deployed, and basic live/
readiness/backup gates passing at 11:05:36.514 UTC. This does not complete
Batch 6. Migrations succeeds; the scheduled RecoveryBackups deployment is
idle `CREATED`, not a new successful archive run. All nine services/jobs are
observed. Retain the 131.414-second observer gap and the unverified reason
for the removed initial Backend instance. Native order #9's repaired Summary
fits the live narrow viewport and JSON closes; Copy-SKU clipboard proof is
still unresolved. Do not repeat its completed stock/refund cleanup.

**B6-BUNDLE-CREATE-FK / B6-CREATE-COMPENSATION — live failure, local repair:**
the owned fixed-bundle draft fails inserting component links before their
SQL parent exists. Native rollback removes the product, while already
acknowledged child operations leave one product profile, one variant profile
and three media links. The exact private failure receipts, screenshot and
uploaded-byte/hash proofs are retained under the October 7 evidence directory.
No browser retry or orphan repair has been performed. Keep uploaded assets
active and use a guarded catalog repair for only these owned dangling rows.

The local correction flushes the parent inside the same SQL transaction,
defers child acknowledgement until one final completion transaction, and
enables fixed-bundle inventory after canonical component linkage. Real
PostgreSQL creation and replay pass for music, merchandise, mystery and fixed
bundles. The fixed kit exposes 10 units from 20 component units at quantity two.
Permanent inventory failure and late outer-completion failure remove owned
native/custom records while retaining uploaded media. An existing-bundle
rollback restores its parent in place and preserves exact inventory provenance.
Bundle-delete compensation is not covered by these create/update assertions.
The full frozen-graph aggregate passes 80 native/service and 44 payment cases
plus PostgreSQL/Redis recovery, contracts and session rotation; owned fixtures
are cleaned. Preserve earlier SQL, harness and transient-retry failures.

**B6-NATIVE-LOGIN-CONTRAST — local repair:** the existing Dashboard patch
improves Reset contrast, field names, main landmarks, 24-pixel link targets
and keyboard focus, including the MFA toggle. The actual expired-session loop
was not reproduced in the owned native fixture; authentication/RBAC is unchanged.
Backend coverage passes 295 suites / 2,498 tests, frozen installation, full
lint/type/policy gates and both production builds pass. The expanded 44-case
Admin matrix passes with zero axe violations/incomplete checks; its login
screenshots have been inspected. The final 46-case matrix below also passes.
MFA challenge live acceptance is not claimed. The lock review admits only
the Dashboard hash and two dependent peer identities, with all registry
versions/integrities unchanged.

Owned order #10 is captured at $10.18 (two M shirts $4.68 plus shipping $5.50,
no tax). Native order `order_01M4B2BHM2SZPRYHK6F7341FZD` and independent
Stripe sandbox `pi_3UNt64IM4tTeFQ3W1WTgAWxE` agree. Read-only evidence at
11:38:19.074 UTC binds its cart/session, payment, inventory and tax record;
the controlled order-placed receipt has a durable successful acknowledgement.
Native fulfillment, synthetic shipment and delivery complete. Actual native
receipts of one usable unit twice leave cumulative received quantity two,
damaged quantity zero, Return status received and M stock four (2 → 3 → 4),
with zero reservations. At 11:52:37.890 UTC native/independent Stripe evidence
confirms successful $4.68 and $5.50 refunds totaling $10.18; tax evidence is
refunded with no failed/missing tax source. Prepared/shipped/delivered,
return-requested/full-received and both controlled refund notices have durable
successful acknowledgements. The partial receipt correctly creates no notice
claiming complete receipt. Do not repeat this cleanup. The native Summary
shows $5.50 credit, zero total after discount and zero outstanding; this does
not remove the original shipping charge from the order ledger.

At 11:57:14.634 UTC, a bounded GET for these eight exact notification IDs
returns 401 with the unchanged restricted sending key. Keep native/provider
acknowledgement distinct from independently retrieved delivery events; no
credential scope is expanded and no extra email is sent. Provider delivery
inspection remains a documented evidence limitation. The exact 7d224eb
runtime audit passes package/protocol, migration-receipt/database-role and
running restricted-Resend identity checks on both applications.

**B6-PARTIAL-RETURN-NAVIGATION — live failure, local repair:** after the first
receipt, the ordinary Summary loses Receive items even though the Return is
partially received. A reload retains the failure. The second receipt succeeds
through the previously observed native receipt URL, preserving Medusa authority.
The Dashboard query now requests requested and partially received returns;
completed/canceled returns remain excluded. Two rendered cases enforce that
the API status filter admits the partial Return and the action is visible at
390/1440 pixels. The focused mobile case and all 46 final matrix cases pass
with zero axe violations/incomplete checks. Full lint/type/policy gates, frozen
installation and the final Backend build pass. Full/prod dependency audits
and the 1,690-file candidate source scan pass the unchanged reviewed backport
gates. The rejected noncanonical scan-output-path invocation stays in evidence;
the corrected canonical-path repository check passes.
Normal live navigation still needs retesting after deployment.

Continue remaining paid families, owned media lifecycle,
guarded search rebuild/parity and the executed-control ledger. Direct staging
correction/CI/rollout retests remain. The ordinary scheduler incident window
ends no earlier than October 7, 14:18:40.644 UTC plus fresh healthy observation.
The client clone remains paused and production remains untouched.

The first 44-case rendered matrix retains 40 passes and four login failures:
password reveal is 15 pixels and the dark recovery prompt has 3.66 contrast.
Reset itself passes the new target/focus checks. The final patch expands the
native reveal target and uses subtle foreground for the prompt; its source
CSS and compiled CSS agree. The final 44-case matrix passes. Preserve the
diagnostic and avoid attributing these remaining failures to the Reset link.

Earlier continuation entries below are historical where their state differs.

### Active continuation — October 7

The user resumed Batch 6. The prior pause below is historical; Batch 7's
client environment clone remains paused. New evidence is under
`artifacts/end-to-end-audit-2026-10-07/`; the original October 6 evidence stays
unchanged. Deployed staging is still `86c325a3a40679feff1a027a9a8cc1e089bef897`.
Fresh 10:14:59.375 UTC readiness passes basic/exact-revision checks and backups,
with exhaustive/scheduler acceptance still open. Renewed all-nine observation
records the intentional 36,228.518-second overnight gap. Redis at 10:31:29.605
UTC remains on the same process with 306,942 seconds uptime, healthy persistence
and unchanged failed queues; no old jobs are retried.

**B6-SPLIT-RETURN-RECEIPTS — reproduced and repaired locally:** real native
workflows receiving one unit twice leave the Return at one received unit and
`partially_received`. The reviewed core-flows 2.18.0 patch now stores cumulative
received and damaged counts. Restocking remains the new usable-unit delta.
Five installed-transform regressions cover split, damaged, mixed and shared
variant cases. The complete disposable aggregate passes (76 native/service,
44 payment cases plus all recovery/API/session gates). Real managed stock is
36 → 38 → 40; a damaged batch changes no stock and a later usable unit adds
only its required two component units. The actual Graph/event/subscriber path
verifies all four notice stages, opt-out, repeated delivery and late partial
replay. Controlled fixture delivery is stubbed; no live RMA notice is claimed.
Earlier unfulfilled-fixture, type/link and reproduced native failures remain
in private logs. Reviewed image/DB scans use Trivy 0.70.0 and exact fixture
image IDs; rejected 0.75 and context/permission diagnostics remain recorded.

**B6-NATIVE-ORDER-SUMMARY-OVERFLOW — repaired locally:** responsive rows wrap
the long SKU and keep amount controls separate at 390/573/1440 pixels.
The first expanded 40-case matrix reports 29 passes and 11 failures, including
unnamed metadata/JSON/alert controls, small copy targets and invalid loading
JSX. Local Dashboard/UI fixes retain the checks, correct those controls and
remove the guest `/customers/null` link. The return fixture now includes the
native preview total it omitted. Both final production builds and all 40 rendered Admin cases now pass, with
zero axe violations/incomplete checks and inspected responsive screenshots.

Backend coverage passes 295 suites / 2,497 tests and 72 native contracts pass.
All four email states render at both widths with eight independent clean axe
checks; screenshots have been inspected. Frozen installation preserves package
versions and unrelated dependency graph. Full lint/policy/type/build gates and the final rendered matrix pass.
Conventional commits, direct staging push, exact CI/
all-nine rollout and deployed RMA/remaining-family acceptance are still pending.

### User-requested pause — October 7, 00:11 UTC (October 6 EDT)

Batch 6 remains open. Stop here at the user's request; resume only after the
next continuation request. No new payment, external mutation or deployment is
started for this checkpoint. Batch 7's client clone remains separately paused.

**Current deployed revision:** `86c325a3a40679feff1a027a9a8cc1e089bef897`,
the three-commit direct staging push below. Root, Backend, Storefront and
Runtime Images all pass on the exact revision, attempt 1, with all 23 required
checks. Their run IDs are `37547315154`, `37547315171`, `37547315153` and
`37547315158`. The two application deployments are
`1e83c700-867f-40f5-a96c-7768e2bf59b2` and
`8d54fc8e-f165-4e51-bc30-d628ea764bec`; both succeed on this SHA, as do
Migrations `f65bb075-d8ba-4999-a3f1-74e5aabaf90a` and RecoveryBackups
`25c21f9a-a95c-4f88-a08c-7e508359006b`. Read-only readiness at 23:55:10.178
UTC passes exact CI/deployments, both live/readiness pairs and backup freshness.
Its `releaseAccepted: false` remains correct: basic readiness does not complete
the exhaustive audit or the ordinary scheduler gate.

Native receiving now confirms the unchanged quantity, named damaged controls
and notification switch on the deployed correction. Owned S return
`return_01M49T4W6CD92AWDPZ6AKVX319` is received at 23:55:49.899 UTC.
The native payment controls refund $2.34 at 23:56:29.305 and $5.50 at
23:59:12.556, following the earlier $1.23 refund. Read-only reconciliation at
00:00:25.041 UTC and the Stripe dashboard confirm the owned $9.07 charge is
fully refunded with three succeeded refunds. All three controlled refund
notifications have durable successful delivery evidence; tax evidence is
refunded with $9.07 total, no failed refund and no missing tax source.

Owned inventory is restored: CD 20, Vinyl 20, M 4, S 3, L 0, XL 2 and 2XL 1,
with zero reservations. Native Admin remains the only mutation authority;
Stripe is used for independent reads. Do not repeat the completed refunds or
returns. The inspected order-edit draft was cancelled and soft-deleted at
23:57:47.477 UTC. Its historical `pending` row is not an active pending edit;
retain the initial diagnostic/filter and UI-wait failures. Native accounting
still retains the original $5.50 shipping charge after the payment-only refund.
Do not infer zero order total/outstanding balance or a closed order from a
fully refunded payment. Claim activity copy implies an outgoing item for an
inbound-only claim; edit-form notification copy/search naming also need review.

**B6-NATIVE-ORDER-SUMMARY-OVERFLOW:** the final real Admin screenshot at its
normal 573-pixel viewport shows the owned long CD SKU overlapping the amount.
Read-only DOM evidence confirms main width 563 versus scroll width 600, and
the Summary card width 539 versus scroll width 588. This is a newly recorded
open finding; the prior native-drawer matrix does not prove the order Summary
fits. Retain `browser/admin-owned-full-refund-pause.jpg` and add a real-shaped
long-SKU Summary regression before claiming narrow native-order acceptance.

**B6-RMA-NOTIFICATION-OPTIONS — local correction, not released:** the pinned
native return request/receiving and claim/exchange confirmation routes discarded
the Admin's notification preference, and the four workflow payloads did not
carry it. Extend the existing MIT Medusa/core-flows 2.18.0 patches to validate
the native body and pass explicit opt-in through the four events. Missing
preferences default to opt-out. Keep native RBAC, confirmation, inventory and
payment authority. The new subscriber requires exact resource, order and
confirmed order-change linkage, valid persisted timestamps, an uncancelled
order and recipient, and uses a stable resource/stage notification key.
Receiving also binds the event's actual return status: partial confirmation,
including its late replay after another receipt, cannot send full-receipt copy.
Four strict email states reuse the existing brand/layout and do not promise a
refund or outbound shipment. Durable acknowledgements/retry boundaries remain.

**B6-CLAIM-LOCATION-HINT — local correction, not released:** fresh native claim
preview rows lack `variant_id`; the old guide used that stale row field instead
of the order item's canonical variant. Both claim and return guidance also
checked only the first kit component. The extended Dashboard patch reads only
selected canonical variants, checks complete paginated/count/identity evidence,
and intersects the locations of every required inventory component. Unmanaged
variants remain explicit. Pending, failed, stale or incomplete reads show
unavailable guidance rather than a false missing-level warning. This changes
operator guidance only; native inventory mutations remain unchanged.

Current local checks pass: frozen root installation; 67 installed native form,
RMA-route/event and inventory-guidance contract cases; 83 focused subscriber,
template and provider tests; both Backend TypeScript projects. The lock review
permits only the three patch hashes and their dependent peer identities,
restoring unrelated third-party-web to 0.29.2. The new actual native RMA
workflow integration case is written and typechecks, but has not run.
The current Backend build, full integration/coverage/lint/policy gates, managed
claim/return rendered matrix additions, email visual review, documentation/hash
updates, commit/push, exact CI and deployed controlled RMA acceptance remain.
The preceding 27-case matrix and builds do not cover these uncommitted changes.

Final all-nine observation at 00:10:32.732 UTC shows all deployments successful
and no sampled fault. The owned watcher is stopped intentionally at the pause;
there is no promise of continued overnight monitoring. Renew it on resume and
retain the documented observer gaps. Redis read-only diagnostics at
00:07:53.555 UTC pass on the same deployment, instance and run with 269,526
seconds uptime, healthy AOF/RDB and zero OOM, eviction or rejected connections.
The failed 237 scheduled plus one event jobs remain untouched. The initial
removed Backend instance has no verified stop reason; do not claim zero
restarts from the successful deployment label.

Private evidence is under `artifacts/end-to-end-audit-2026-10-06-resume/`:
`receipts/readiness-86c325a-initial.json`,
`receipts/redis-86c325a-rollout-diagnostic.json`,
`receipts/pause-all-nine-observation.json`,
`receipts/rma-inventory-three-patch-lock-review.json`,
`checks/order-nine-86c325a-fully-refunded.json`,
`checks/rma-inventory-native-contract-after.log` and `checks/pause-*.log`.
Browser proofs include `native-receiving-s-86c325a-damage-control.jpg`,
the two native refund dialogs and `stripe-owned-full-refund-907-86c325a.jpg`.
Earlier failures and the original October 6 evidence are retained unchanged.

Resume the local correction's remaining gates first. New prepared-notice and
fixed-bundle stock live acceptance, paid product families, owned media lifecycle,
guarded search rebuild/parity and the executed-control ledger remain open.
The scheduler incident latch stays intact until at least October 7,
14:18:40.644 UTC plus fresh healthy observation. No new Conventional Commit or
staging push is made merely to checkpoint unfinished work. Production is
untouched, and the client environment clone remains paused.


**Corrective push — October 6, 23:34 UTC:** the three logical commits are
pushed directly to staging as `86c325a3a40679feff1a027a9a8cc1e089bef897`:
`ed85c8e` native bundle stock, `4697085` prepared notification event and
`86c325a` native after-sales controls. Normal commit/pre-push lint/type/policy
and Storefront coverage gates pass. All four exact push workflows are running;
Backend, Storefront, Migrations and RecoveryBackups remain `WAITING` for CI at
the first fresh rollout observation. The previous exact pair remains active.
No candidate ref, PR, force push, gate waiver or production action is used.

The prior all-nine observer exits with code 143; renewed monitoring starts at
23:35:22.591 UTC after a recorded 210.417-second gap from its final snapshot.
Retain both histories and do not claim continuous coverage across the gap.
The new snapshot has no sampled fault. GitHub's default-branch advisory #56
is the already documented Braces stack-exhaustion issue; its exact mitigation
is retained, not a new suppression. Exact CI, rollout and live retests of this
push remain pending; Batch 6 stays open and the client clone stays paused.

### Native after-sales workflows and prepared notices — October 6, 23:32 UTC

The active Backend/Storefront pair now serves exact `3873c85`: deployment
`5a734c55-0070-4ad6-87df-e18c83298bef` and
`745c8be8-75f2-4636-b96b-f328744e55ad`. Fresh read-only readiness passes
all 23 exact push checks, both deployments, uncached basic probes and backup
freshness. This is readiness for acceptance, not final Batch 6 acceptance.
All nine services/jobs remain successful in sampled observations; persistent
services retain their previous process/deployment identities. Redis uptime is
266,145 seconds at 23:11 UTC with healthy AOF, no OOM/eviction/rejection and
unchanged 237 scheduled plus one event failed job. No queues are replayed.
A bounded 215-line rollout read records start, stop and subsequent readiness,
with no application error/crash signal in that window. The removed initial
Backend instance has no verified stop reason; retain it for investigation and
do not infer zero restarts from its successful deployment label.

Owned order #9's native M-to-S exchange is confirmed. Medusa receives and
restocks M, allocates S at HQ, then records its synthetic fulfillment, shipment
and delivery. The controlled shipped/delivered notices have durable successful
Resend evidence. The prepared notice fails because the native creation event
supplies `order_id`, while the subscriber expected `id`. Repair only that
version-matched boundary; creation IDs, order linkage, persisted timestamps,
opt-out, stable keys, durable acknowledgements and retry errors remain strict.
The disposable integration captures the actual `createOrderFulfillmentWorkflow`
event instead of constructing an assumed payload. Focused subscriber checks
pass 33 cases, full Backend coverage passes 293 suites / 2,432 tests, and all
75 native / 44 payment cases plus the recovery/session aggregate pass.
Prepared-notice live acceptance remains pending the corrective deployment.

The native CD claim is confirmed and received at HQ at 23:17:50.789 UTC;
CD stock returns from 19 to 20 with no reservation. A native $1.23 sandbox
refund succeeds at 23:19:02.681 UTC, leaving $7.84 paid and zero outstanding.
Independent Stripe test-account reads and its dashboard confirm the exact
successful refund; the registered refund notice has durable successful Resend
acknowledgement for the controlled audit recipient. The order remains partly
refunded. Return/restock of the outbound S and its $2.34 refund, followed by
shipping's $5.50 refund, remain required owned-data cleanup. Do not call this
order financially reconciled yet or issue refunds through Stripe directly.

**B6-NATIVE-AFTER-SALES-CONTROLS:** extend the existing MIT Dashboard 2.18.0
patch in source, main and lazy distributions. Allocation dialogs now retain a
name/description while loading, associate the location label with the actual
trigger, name search and quantities, show purchased variants and true zero
stock, and fit narrow layouts. Kit expansion uses a keyboard button. Return
receiving names quantities and damaged-item controls, displays the purchased
variant and gives its notification switch a 24-pixel target. An unchanged
positive action quantity no longer sends a redundant blur mutation; existing
bounds and edited/add/remove/confirm operations remain native. Refund reasons
name their actual trigger. Installed-form execution passes all 36 cases; both
builds and final full lint/type/policy gates pass. All 27 Admin matrix cases pass with zero axe violations, layout findings
or browser issues; the changed rendered screenshots are inspected. Preserve the earlier small-target/browser failures, the missing
refund fixture dates and the local Storefront fixture-secret setup failures.
No gate, browser sandbox, native authorization or inventory mutation is waived.

Two further native findings stay open: **B6-CLAIM-LOCATION-HINT** displays
"No inventory level" for the owned CD despite verified HQ stock and successful
restocking; investigate the actual native variant projection before changing
inventory. **B6-RMA-NOTIFICATION-OPTIONS** exposes return/exchange/claim options
without registered lifecycle subscribers/templates. Checked options are not
email delivery evidence. Refund and outbound fulfillment events are separate.

Bundle stock commit `ed85c8e` and the after-sales/notice corrections are local,
unpushed. Group their logical commits into one corrective staging push within
Batch 6 after final local gates. Then require exact CI, every deployment and
applicable deployed retests before the next push. Private evidence remains in
`artifacts/end-to-end-audit-2026-10-06-resume/`; earlier evidence is immutable.
The complete audit ledger, paid product families, owned media lifecycle and
guarded search rebuild/parity remain open. Preserve the scheduler incident's
24-hour latch until at least October 7, 14:18:40.644 UTC plus fresh healthy
observation. Batch 7's client clone remains paused.

### Native stock preview and exact security CI — October 6, 22:58 UTC

The security correction is pushed directly to staging at
`3873c8511e75c21388f250b757fad2f3490fc6b3`, with normal local hooks and
pre-push lint/coverage gates. Root, Backend, Storefront and Runtime Images
all pass on the exact revision: 23 required jobs, four push suites, attempt 1,
at 22:50 UTC. Both exact local runtime scans also pass. The Storefront's
packaged Next 16.3.8 / Sharp 0.35.5 boundary verifies real AVIF decoding and
encoding, malformed-image fallback, SVG rejection, private-address rejection
and DNS pinning in a bounded, isolated container. Preserve failed `1b09546`
and the initial source-copy/build/environment failures; no scan is waived.
Migrations and RecoveryBackups succeed on `3873c85`; both applications are
still building at the latest all-nine snapshot. CI is not live acceptance.

**B6-BUNDLE-CREATE-STOCK:** creating an owned fixed-bundle draft displays
"Stock unavailable" for its owned CD even though independent native inventory
shows 19 available and zero reserved. Installed Medusa 2.18.0 computes
`inventory_quantity` on `/admin/products/:id/variants`, not the product list's
`*variants` projection. Read only distinct selected component products through
that native endpoint. Paginate its variants, propagate aborts, cache bounded
reads and reject missing, duplicate or changed-count pages. Merge exact product
and variant IDs; absent/error evidence remains unknown and cannot imply
unlimited stock. Preserve native unmanaged stock explicitly and label all
nonpositive managed stock as sold out. These reads do not change native
inventory, checkout calculations, creation mutations or authorization.

The actual old compiled Admin fails the new stock-preview regression. The
corrected laptop and narrow rendered cases show 18 available components,
then nine complete bundles when component quantity changes to two, with one
selected native request and no horizontal overflow. Both screenshots are
inspected. Focused verification passes 21 cases; Backend coverage passes
293 suites / 2,430 tests. Real disposable Medusa proves the product list lacks
computed stock while its variants endpoint returns actual availability; all
75 native/44 payment cases and the recovery/session aggregate pass. Both
production builds and final full lint/type/policy gates pass. All 22 full
Admin matrix cases pass with zero axe violations or layout findings; the new
matrix screenshots are inspected. Final commit/push is pending.
Keep this repair local until the preceding application rollout succeeds.
The owned native fixed-bundle draft remains browser-saved, unsubmitted.

Native tax controls pass real controlled date input, missing/reversed range
validation with accessible errors/focus, applying CT/NY reporting periods and
PA half-year periods, search/clear and all report filters. All six native CSV
downloads pass: CT's owned $9.07 sale and destination/period totals agree;
NY/PA empty reports have correct zero totals and actual state/period sections.
All retain UTF-8 BOM, real CRLF and contact-field exclusions. Table filters do
not silently narrow the full filing export. Retain the first destination
download timeout, excluded older file and date-input harness failures.
Media cleanup paginates 25 plus three distinct historical assets, returns to
the first page and shows an empty quarantined view. No historical asset is
mutated. Eight legacy Admin links redirect to their current destinations;
this proves redirects, not all destination workflows.

Private receipts are under `artifacts/end-to-end-audit-2026-10-06-resume/`;
the original October 6 evidence directory stays unchanged. The all-nine
watcher transition records a 310.495-second gap before 22:51 UTC. No sampled
service fault is found; this is not continuous coverage across the gap.
Owned order #9 cleanup, paid product families, owned media lifecycle, guarded
search rebuild/parity and final audit-ledger reconciliation remain open.
Ordinary scheduler acceptance also remains blocked by its untouched 24-hour
incident latch until at least October 7, 14:18:40.644 UTC, then a fresh healthy
observation. Failed Redis queues remain untouched. Keep Batch 6 open and
pause before the Batch 7 client environment clone.

### Native Admin resumption and exchange tax repair — October 6, 22:07 UTC

An existing authenticated Admin tab successfully reloads owned order #9.
The earlier Login observation came from a different, expired tab; it is no
longer the access blocker. The native outbound S-shirt save fails twice with
`Tax subject fingerprint data is invalid.` Both failures compensate the new
line before creating an outbound exchange action. Read-only native/Stripe
and full owned-product inventory comparisons confirm the unchanged $9.07
capture, no refunds, unchanged stock/reservations and preserved inbound draft.
Close only the item picker and drawer; do not cancel the exchange.

**B6-NATIVE-ORDER-TAX-QUANTITY:** Medusa 2.18.0 creates an unattached
`order_line_item`, then calls its tax workflow before the exchange's `ITEM_ADD`
action exists. Quantity belongs to the later order-item link and is absent
from the bare line projection. The correction copies only partial order-tax
items onto a unit basis when quantity is absent. Explicit invalid quantities,
checkout and full-order refreshes remain strict; native quantities, inventory,
totals and provider inputs are not mutated.

The same partial workflow omits original items from its order projection.
Load the exact order's persisted item/shipping tax identity before selecting
the historical mode, provider and generation. Missing, malformed, ambiguous
or wrong-order history fails closed. Historical disabled and TaxRate.io rates
remain frozen after a store-wide switch. New taxable items on a Stripe Tax
order remain blocked by the existing payment/calculation binding rule.

The original three failing unit cases are retained. Final focused verification
passes 62 cases; Backend coverage passes 293 suites / 2,423 tests. The real
disposable Medusa workflow proves missing bare-line quantity, historical
disabled/TaxRate.io preservation and the Stripe Tax hold: 75 native service
cases plus 44 payment cases and the full recovery/session aggregate pass.
Both production builds pass; the Storefront build uses an owned read-only
loopback fixture and distinct synthetic process-only secrets. Preserve the
initial generation-assumption, strict optional-property and local build-env
failures. Fresh scans bind both exact fixture images to unchanged reviewed
vulnerability database bytes; no finding or gate was waived. The stopped
Desktop context is preserved; local verification explicitly uses the available
Linux daemon without changing global Docker settings.

Authenticated refund controls also pass search/empty, all four status choices,
all five tax-handling choices, combined filters, clear, guidance and refresh.
Order #8 shows $6.23 in both Medusa and Stripe, verified with zero attention or
processing cases. These reads do not issue another refund. The Connecticut
tax report shows owned order #9 as pending tax review, not exempt; its native
transaction export retains the full one-sale filing scope while the table's
Refunds filter is empty. Further native/paid workflow acceptance remains open.

Private evidence is under `artifacts/end-to-end-audit-2026-10-06-resume/`;
the earlier October 6 directory is retained unchanged. All-nine observation
continues with no service fault. Preserve the scheduler's existing 24-hour
incident latch, thresholds, monitor issue and failed Redis queues.

The earlier pre-push native hold cannot close this failure on `c290b7b`.
Collect this repair with the already-tested responsive, catalog/history and
push-suite readiness corrections in one corrective staging release **within
Batch 6**, then require exact CI/deployments and deployed native retests.
This does not start the next batch or accept the unresolved scheduler gate.
Keep Batch 6 open until ordinary health and the full audit pass; Batch 7's
client clone remains paused.

### Public bundles, release check identity and scheduler incident — October 6 UTC

Batch 6 remains open at deployed `c290b7b0c521cfabedf136a4881a2f9262eaf2bf`.
The responsive/native-drawer correction is local at
`283052b5ef39d2232561361cdd56166fc6388723`; the catalog/history correction is
local at `fab7d618e3271d8c43ff5b1c2e77ba38b1da94b8`. Neither is pushed.
The current Admin tab still presents native Login with blank fields. Existing
authorization does not supply a current authenticated session; keep native
order/refund and new stage-notification acceptance open without bypassing
authentication or repeating routine permission/login questions. The owned
order #9 remains captured for $9.07 with no refunds and its unchanged inbound
exchange draft; fresh read-only Medusa/Stripe reconciliation and the sandbox
payment page agree. Do not create more paid audit orders while their native
reconciliation and cleanup cannot be completed. The client clone remains paused.

**B6-CI-PUSH-SUITE:** Monday's scheduled workflows created skipped dependency
review checks on the same SHA. The readiness tool incorrectly preferred these
newer check IDs over successful staging push jobs. The local correction selects
the latest exact-SHA staging push run for each of the four workflows, reads its
complete check-suite page and binds each of the same 23 required jobs to its
owning suite. Other events cannot displace a passing push job or repair a
missing/failing one. The final snapshot also rejects a changed run, suite or
attempt. All 62 release-policy cases pass, including skipped/failing/missing
jobs, unrelated successful suites, incomplete/wrong-suite pages and concurrent
reruns. Fresh corrected read-only readiness passes all four workflows/23 jobs,
both exact application deployments, basic health and backup schedules. This
does not establish ordinary scheduler or native financial acceptance. The
original false-negative receipt is retained; no CI job was rerun or waived.

The public merchandise/bundle sweep covers 20 published products in desktop,
Pixel 7 and iPhone 15 Pro Chromium: 14 fixed bundles, one mystery bundle and
five merchandise products. The latest unique ledger passes **60/60 cases**,
with 78 option observations (57 enabled, 21 disabled), quantity clamping,
native prices, selected-component availability and **126 actual component
link/Back visits**. Fixed contents agree with fresh public Medusa projections;
the mystery bundle correctly has no fixed composition. Rendered phone bundle
screenshots were inspected. The earlier unhydrated drawer attempt is retained.
The hydrated attempt passes 48 and fails 12 phone cases because repeated cart
reads hit the existing rate limit. Only those 12 cases were rerun with cart
reads paced to approximately 55/minute; all pass without changing server
policy. These are page/control passes, not purchases or Admin acceptance.

The subsequent real fixed/mystery guest-cart audit passes **all three primary
profiles**, with 64 validated native responses. The $8 fixed bundle exposes
its three native zine components and an actual component-link/Back visit;
the $27 mystery CD line explains packing without inventing fixed contents.
Quantity changes preserve native prices/subtotals, both separate lines survive
reload with the $35 item subtotal, and actual Checkout opens an untouched
contact form. All six cart lines are removed through the UI. The bounded
read-only database comparison confirms unchanged stock/reservations for eight
inventory rows, three carts without email/completion/billing data, no active
lines, order links, reservations or payment sessions. Native Medusa creates a
US-only shipping placeholder for this single-country region; recipient and
delivery fields remain empty. Retain the initial helper's incorrect no-address
assertion and the following explicit placeholder-field verification. One
navigation-canceled GET response-body read is retained separately. These are
unpaid functional passes; the previously documented live drawer accessibility
and short-viewport fixes remain local, and paid product-family acceptance stays
open. Private browser rows are in `browser/bundle-native-cart/`, with before,
original after and explicit observed-boundary receipts under `receipts/`.

**Ordinary live acceptance currently fails:** the scheduler recorded an
attention incident at `2026-10-06T14:18:40.644Z`. Its 14:18 job started
40,604 ms late against the existing 30-second limit, then completed its work
in 39.845 ms, scanned 68 carts with zero eligible/failed/held/completed carts,
and released its lock. The preceding and following jobs completed normally.
Fresh heartbeats pass, but the normal 24-hour incident latch keeps scheduler
and operations health at 503. Keep the latch and thresholds intact. It cannot
age out before October 7 at 14:18:40.644 UTC, and a fresh healthy observation
is still required. The existing
[staging monitor issue #21](https://github.com/traweezy/remorseless-records/issues/21)
is preserved without new comments or notifications.

Bounded surrounding Backend/Redis/Postgres metrics show no measured CPU or
memory saturation; 30-second platform averages cannot establish the cause of
the 40-second delay. The fresh operations diagnostic verifies all 11
dependencies/capabilities, completed retention jobs and catalog counts before
retaining the scheduler failure. Application-log acceptance also retains its
failure. A separate bounded review identifies its sole Backend 5xx as this
audit's `GET /health/scheduler` diagnostic and finds zero Storefront 5xx; that
classification does not override the ordinary acceptance gate.

Fresh Redis inspection passes at 21:29:58 UTC on the same deployment/instance
and run identity, with **260,051 seconds uptime**, healthy AOF/RDB, zero OOM,
high/max/kill events, evictions and rejected connections. The failed 237
scheduled plus one event job remain untouched. Fresh volume schedules pass.
The latest authenticated encrypted archive is October 6's automatic
`ac0dbcad-4329-4194-8360-0e7c5871eeaa`, containing 1,176 media objects;
17 authenticated archives are present. This is not a new restore, PITR or
off-site recovery proof. Fresh all-nine-service observation starts at 21:29
UTC; preserve the gap since the preceding October 5 watcher instead of claiming
continuous monitoring.

Private evidence is in `artifacts/end-to-end-audit-2026-10-06/`: the
`public-bundle-merch-completion.json` receipt, separate original/rerun browser
ledgers, push-suite readiness/policy logs, scheduler incident/metrics reports,
ordinary-observation failures, owned-order reconciliation, Redis and archive
receipts. Keep all corrective commits local until native financial/notification
acceptance and ordinary scheduler health pass. Eventual catalog deployment
still requires the guarded versioned search rebuild and fresh parity checks.

### Catalog filters, mobile paging and Discography history — October 5 UTC

Batch 6 continues at deployed `c290b7b`. The preceding responsive/native
drawer group is committed locally at
`283052b5ef39d2232561361cdd56166fc6388723`; this next browsing correction
also stays local until the preceding release's applicable native financial
and stage-notification acceptance passes. Native Admin still shows sign-in;
do not repeat routine login/approval questions or bypass authentication. The
client environment clone remains paused.

The real Catalog control sweep records **73 completed action groups** across
desktop and two phone emulations: every available type/genre/format option,
stock, price range/error/reset, all seven sort choices, no results, clearing
and reloading. Desktop also completes all 463 products/eight search pages.
Each phone finishes 24 control groups but its final footer-jump pagination
attempt fails; these are not whole-profile passes. Six repeated format-count
findings represent two distinct missing products:

- **B6-FORMAT-FILTER-PARITY:** CD advertises 282 but returns 281; Cassette
  advertises 131 but returns 130. Independent bounded queries verify every
  page against the native 463-product presentation inventory. The missing
  CD product is a mystery bundle with a “3x CDs” option; the missing Cassette
  product uses its album name as its variant title and retains readable
  legacy format metadata. The transformer now retains authored raw labels,
  adds canonical format facets, and uses legacy metadata only when explicit
  native format assignment is absent. Native CD/Digital/Box assignments win.
  Eight new cases pass, 15 total transformer tests. A pure candidate projection
  matches all 463 products: CD 282, Vinyl 126, Cassette 131 and DVD one, with
  zero differences. This does not prove the deployed index or independently
  load Catalog facts. After the eventual exact rollout, run the guarded
  versioned candidate rebuild/atomic swap and `search:check`, then repeat the
  standalone format queries. No live index write or failed-queue replay occurred.
- **B6-MOBILE-PAGING:** a separate hydrated Pixel diagnostic reproduces both
  incremental scrolling and End-key browsing stopping at 120 of 463. The
  loading marker sits above the viewport near the tall footer. The initial
  bounding-rectangle-only correction also fails in WebKit: private geometry
  shows a marker bottom at −160 pixels after 120 fixture products. Virtual row
  measurement can move the marker across the viewport without an intersection
  threshold transition. The final correction schedules one geometry check
  per animation frame on scroll, resize, intersection and result-container
  resize. It retains fetching/error/has-next guards, once-per-result-count
  requests and complete listener/frame cleanup. The regression browses all
  eight exact windows to 461 fixture products and the final 41-item page.
  Desktop and all three engines include this test in their normal CI selection.
- **B6-DISCOGRAPHY-HISTORY:** 54 live control observations across desktop,
  Pixel and iPhone check all five availability choices, three formats, one
  tag, six sort selections, empty/search restoration and one actual View link
  per profile. Availability partitions 442 releases into 414 in print and 28
  out of print; three other choices correctly show zero. All three profiles
  reproduce Back resetting the one-release query to the entire list. Public
  browsing state now uses the existing Zustand pattern in tab memory. Query,
  availability, format, tag and sort survive a release visit; Clear filters
  still preserves query/sort. Single-release counts use consistent singular
  text in the summary, drawer action and accessible list name. It adds no
  browser-storage persistence. Actual
  sort selection/count checks do not independently prove the full sort order.

Both final production builds pass. Backend coverage passes 293 suites/2,403
tests; fresh Storefront coverage passes 1,079 baseline and 403 transactional
tests. The final catalog-only Chromium/Firefox/WebKit matrix passes 12 cases
with no retries/skips/flakes. The combined final browsing/history matrices pass
18 first-attempt cases in Chromium/Firefox/WebKit and 18 in desktop/Pixel/iPhone
Chromium, with zero skips, flakes or report errors. Rendered completion and
history screenshots were inspected. The normal commit enforces lint/type/policy
checks; its completion receipt binds this group to the local revision. These
source/fixture checks do not establish deployed acceptance.

Preserve earlier helper failures: aliases, stock/range expectations, header
selection, cached sort restoration, search term dropping, missing Origin,
SSR hydration, modal-hidden background lists and footer anchoring. The first
full-pagination fixture incorrectly returned 60 records on its final 41-item
page; its corrected bounds retain the exact final-count/page-sequence checks.
The initial single-jump test also incorrectly assumed identical scroll
anchoring in every engine. The final per-window browsing test retains real
failure geometry and does not relax the final count or request sequence.
The interrupted oversized live screenshot helper retains two complete Pixel
findings; do not claim its uncompleted iPhone diagnostics.

All nine services/jobs remain stable in observed samples. The 90-sample
01:20:30–02:14:58 UTC watcher finishes without a fault, and its successor
starts at 02:11:37 UTC with overlapping coverage. This does not erase earlier
observation gaps or replace the detailed Redis persistence/queue receipt.
The fresh 02:40:54 UTC Redis inspection passes on the same deployment,
instance and run identity, with 105,906 seconds uptime, healthy AOF/RDB and
zero OOM, high/max events, evictions or rejected connections. Historical
237 scheduled and one event failure remain untouched.
Private evidence remains in `artifacts/end-to-end-audit-2026-10-04/`, especially
`browser/public-c290b7b-catalog-final-filter-pagination/`,
`browser/public-discography-modal-controls/`, `browser/catalog-footer-geometry/`,
the format diagnostic/candidate receipts and corresponding check logs.
The final singular-count build/coverage and primary/critical reports are
`checks/catalog-history-singular-*` and `browser/catalog-history-singular-*`;
the fresh Redis receipt is `receipts/catalog-completion-redis-diagnostic.json`.

### Owned cart completion and final drawer repairs — October 5 UTC

Batch 6 remains open on deployed `c290b7b`. Its exact CI, scanned runtime
bundles and Railway deployments pass; required native order/refund and new
stage-notification acceptance remains incomplete. The existing Admin tab still
shows native sign-in. Existing authorization does not supply an authenticated
session, and no replacement credential was found in the scoped access checks.
Keep the corrective group local under the release gate; do not bypass native
authentication or repeat routine permission/login questions. The client clone
remains paused.

The real guest-cart audit completes eight action groups in each of desktop,
Pixel 7 and iPhone 15 Pro Chromium profiles. Repeated additions merge one CD
line; rapid quantity changes settle at native subtotals; the three-item shirt
limit disables increase; two tabs synchronize in both directions and survive
reload. Separate sizes remain distinct, individual removals affect only their
line, and Checkout opens the actual untouched contact step. Decreasing a line
at one removes it, and final removals restore the empty cart. All three final
profiles removed their lines through the UI, with 135 validated native cart
responses and no browser errors or blocked writes. No contact/address,
payment preparation, order, capture or refund was submitted by this sweep.

These are **functional passes with retained accessibility failures**. All
three live profiles expose **B6-DRAWER-SEMANTICS**: the shared panel is an
`aside` with a dialog role, which axe rejects. The local correction uses a
`div` with the existing Radix dialog semantics and preserves focus restoration.
The new populated-cart regression verifies actual rendered controls and axe.
A separate short-viewport diagnostic also found **B6-CART-SHORT-VIEWPORT**:
the fixed totals area leaves the line controls unusable and clips Continue
shopping at 390/450-pixel heights. One scrolling cart body now contains items
and totals, while the header and close button remain available. Tests scroll
to every line/checkout/shopping control and assert its visible, unobscured
target at the default profile viewport, landscape and a 720×450 reflow viewport.
The latter models 200% reflow, not actual browser zoom.

Earlier helper attempts are retained, including SSR hydration/consent timing,
navigation-canceled response-body reads and an incorrectly transcribed variant
ID. The final helper derives allowed IDs from the authoritative inventory and
preserves every native response. The crashed earlier guest helper lost its
in-memory signed cookie and left one anonymous cart with two CD units. The
01:05 read-only bounded cohort verifies eight carts with no contact/completion
or order links, zero reservations and unchanged stock. Only that earlier cart
has an active line; preserve it for normal anonymous-cart retention. Do not
forge its cookie or delete its rows directly. All three final profile carts
have no active lines.

The completed local primary matrix passes **51 first-attempt cases** across
desktop and the two phone profiles, including the prior tracklist, headings,
compact information and tablet navigation corrections. Both production builds
pass; the final cart change's 19 focus/cart component cases pass. The final
Chromium/Firefox/WebKit critical matrix passes **105 first-attempt cases**, with
zero skips, flakes or report errors. Fresh Storefront coverage passes 1,079
baseline and 403 transactional tests. The normal commit enforces the repository
lint/type/policy gate. These local fixtures do not establish deployed or financial
acceptance.

The initial new drawer axe run retained five contrast uncertainties. Instrumented
execution of the installed axe source shows different page elements behind
the same opaque modal on separate wrapped lines. Rendered text is unobscured
and its foreground/background contrast passes. Firefox additionally exposes an
OKLab scientific-notation parser error in the covered page, aborting the rule.
The regression retains the complete axe result, fails every violation and
unknown incomplete result, and directly verifies every visible dialog text
node when that precise parser error occurs. It otherwise verifies each flagged
text node. The browser resolves its actual colors and composites translucent
backgrounds up to the opaque modal; AA ratios, clipping and topmost text
geometry are checked. No axe rule, browser sandbox or failure is disabled.
The earlier 99-case attempt retains four Firefox failures from the initial
review helper's unsupported error shape. The following 105-case attempt retains
three Firefox failures from that helper's RGB-only conversion; native browser
color resolution replaces that restriction without changing application colors.
The final run retains ten direct-review attachments. Every reviewed text node
is unobscured and meets its AA threshold, with the smallest measured ratio
0.49 above that threshold.

Fresh native Stripe verification at 01:12 UTC confirms the owned order #9
payment page, $9.07 Succeeded heading and its latest charge. The page's read-only
WebMCP context independently identifies the expected account and sandbox
(`livemode: false`). The connection fallback text exists in the DOM but is
hidden; its text presence alone was an insufficient earlier diagnosis of a
visible connection failure. The rendered page agrees with the guarded 00:17
Medusa/Stripe read. No Dashboard financial action or receipt send occurred.

The latest detailed Redis read at 00:52 UTC retains the same instance/run,
99,423 seconds uptime, healthy AOF/RDB and zero OOM, evictions or rejected
connections. Its 237 scheduled plus one event failure remain untouched.
The all-nine-service watcher completed its bounded 23:19–01:09 window without
an observed crash; the one 23:54 unverified sample is retained. Monitoring
resumed at 01:20 after that gap. Do not claim continuous observation or a new
archive from the idle RecoveryBackups deployment.
Fresh ordinary scheduler/operations observation passes at 01:35 UTC with the
exact-revision 01:34 completed heartbeat, all eleven dependency/capability
checks and the unchanged published catalog counts. Older retention execution
revisions remain explicitly recorded; this read does not claim new retention
or backup execution.

Private evidence includes `receipts/owned-cart-functional-completion.json`,
`browser/owned-c290b7b-cart-functional/`, `browser/cart-scroll-primary/`,
`browser/cart-native-color-critical/`, the retained failed
`browser/cart-scroll-critical/` attempt, drawer/short-viewport diagnostic receipts and
screenshots, the Stripe visibility review and original per-attempt logs under
`artifacts/end-to-end-audit-2026-10-04/`. Remaining live responsive/drawer
retests, native financial/notification actions, other product-kind purchases,
Admin settings/role coverage and wallet eligibility still prevent exhaustive
acceptance and the client clone.

### Public interaction completion and held local repairs — October 5, 00:43 UTC

Batch 6 remains open. The live application pair still runs exact
`c290b7b0c521cfabedf136a4881a2f9262eaf2bf`, whose four workflows/23 checks,
scanned runtime bundles and app/job deployments pass. **Keep the next
corrective group local until this revision's required native order and
notification acceptance passes.** The existing Admin tab remains on native
sign-in; authorization is already granted, but its expired session supplies no
authenticated access. Do not repeat permission/login questions or bypass
Medusa authentication. The client clone remains paused.

The completed public link sweep clicked each of the 463 actual catalog title
links, then used browser Back and Forward. Every title/route and restored query
matched, with zero document navigations, browser errors or “A track skipped”
fallbacks. All 431 enabled Quick shop controls opened the correct loaded
product with an enabled purchase button and closed without submission; the
remaining 32 controls correctly stayed disabled. Earlier helper failures used
the wrong input role or clicked the card's nested Quick shop button rather than
its title. Those attempts and screenshots are retained separately.

Desktop, Pixel 7 and iPhone 15 Pro emulation also pass 84 distinct shared
control/profile pairs: both link forms on all six news articles, all 13 internal
footer links, all six FAQ questions, back-to-top and consent preference flows.
Editorial links retained client navigation and Back/Forward; FAQ click/Enter,
answer visibility, scroll/main focus and pointer checks passed. Consent values
match the actual local storage and Secure/SameSite=Lax cookie, including
analytics/marketing changes, rejection, acceptance and two-tab propagation.
The broad attempt passed 81 pairs and timed out on three consent pairs while
waiting for page-wide network idle. A separate rendered-state retest passes
those three pairs using DOMContentLoaded and the actual checkbox contract.
Pending telemetry requests are recorded without payloads; the original failures
are retained. These are emulated Chromium profiles, not physical-device tests.

The held correction now includes native return/claim/exchange loading titles
and descriptions, purchased product/variant labels, correct existing shipping
translations and loading/denied/empty outbound picker states. Source and main/
lazy bundles agree in the same-version MIT Dashboard patch, SHA-256
`c00ad2d4949235b796e70d57caea3b449869dcb8b7486d1950cb41ef9e843ce4`.
Frozen offline installation passes with only its five lockfile identity
references changed. Thirty-two installed form contracts and all 20 compiled
Admin fixture cases pass, with zero axe violations/incomplete results. The
pending dialog is tested before its fixture read is released. A rendered
contrast diagnostic also found the tax filing link's negative margins overlapping
neighboring punctuation. Removing those margins preserves its minimum target;
the browser now rejects overlap and retains the separate focused-validation
screenshot. No tax, payment, authentication or mutation contract changes.

The Storefront correction preserves authored track titles while displaying
sequential ordinals once, adds Home/Catalog main headings, wraps compact
information controls and moves desktop navigation to the width where it fits.
All 18 final desktop/phone fixture browser cases pass on their first attempts,
including 60 information-page/width renders with every FAQ answer expanded,
control/text containment and drawer focus return. Eight tracklist component
cases, both production builds, 1,079 baseline and 403 transactional Storefront
tests pass. Earlier pending-dialog execution stubs, tax backdrop/overlap and
combined phone-case timeout failures remain in their separate logs. The normal
commit lint/type/policy gate is required before recording this group as committed;
none of these local results count as deployed acceptance.

Fresh ordinary scheduler/operations observation passes at 00:43 UTC, including
the exact-revision 00:42 completed heartbeat, all eleven dependency/capability
checks and unchanged 463 products/442 discography records/three shelves with
25 memberships. The 00:23–00:30 application-log window passes runtime/HTTP
correlation for both exact deployments, with 109 Backend and 101 Storefront
records, zero HTTP 5xx, unknown warnings/errors or truncation. One intentional
Backend guard 400 is explicitly correlated. All nine service/job identities
retain their expected states in the 00:38 observation. Redis's latest detailed
23:46 evidence remains the same stable run with healthy persistence and
untouched 237+1 failed queues.

Read-only Medusa/Stripe reconciliation at 00:17 confirms owned order #9's
unchanged $9.07 capture, zero refunds and same pending inbound-only exchange.
No outbound action or temporary note is saved. The earlier inference from
Stripe's connection-fallback DOM text was insufficient: the 01:12 visibility
retest above confirms that fallback is hidden and the native sandbox transaction
page is healthy. The independently guarded API read agrees with its state.

| Coverage area | Current result and exact limit |
| --- | --- |
| Published detail pages | Pass: 463 products and six articles at desktop width on `c290b7b` |
| Product gallery/options | Pass: 1,144 image selections; 539 available and 52 disabled options across all products |
| Catalog client navigation/Quick shop | Pass: all 463 title links/history; 431 loaded and 32 disabled drawers; no cart submission |
| Catalog filtering/sort/pagination | 73 live control groups; two format parity and mobile paging findings retained; local correction passes both 18-case browsing matrices; index rebuild/deployed acceptance pending |
| Discography controls/history | 54 live observations; all three profiles lose search on Back; local memory-state correction passes native-link fixture regressions in all primary profiles/engines |
| Shared editorial/footer/FAQ/consent | Pass: 84 control/profile pairs across desktop and two phone emulations |
| Responsive layouts | Live failures retained in 240-row inventory; local 18-case correction passes; deployed retest pending |
| Actual cart mutations | Pass: eight native action groups in each of three profiles; three live drawer axe failures remain open until the correction deploys |
| Native RMA/refund/stage notifications | Blocked by expired Admin session; partial crash retest and read-only reconciliation pass |
| Remaining product-kind purchases | Not run: standalone merchandise, fixed/mystery bundles and remaining receipt/recovery combinations |
| Admin authoring/settings/role matrix | Partial historical owned-data coverage; remaining native screens/actions need authenticated execution |
| Wallet device path | Blocked: staging domain/device eligibility; no unsupported payment method enabled |
| Final release/clone gate | Open: held correction needs direct staging CI, exact rollout and complete applicable live acceptance; no clone started |

Durable private evidence is `artifacts/end-to-end-audit-2026-10-04/`, especially
`browser/public-c290b7b-title-links/`, `browser/public-c290b7b-editorial-consent/`,
`browser/public-c290b7b-consent-dom/`, `browser/responsive-expanded-faq/`,
`screenshots/presentation-final-admin/`, the completion/reconciliation receipts
and per-attempt check logs. Preserve original failures and the remaining native
financial gate. The quantitative public sweeps do not establish exhaustive
audit completion.

### Gallery/option completion and responsive corrections — October 4, 23:53 UTC

The exact `c290b7b` desktop gallery sweep passes all 463 products and all 1,144
authored images. Every thumbnail was clicked, each image loaded with intrinsic
dimensions and `object-fit: contain`, and Previous/Next traversal and endpoint
disabled states matched the displayed image. Named controls, pointer cursors
and page overflow checks pass. The independent option sweep passes all 463
products: 539 available options were selected by click and Enter, with enabled
purchase controls and zero/above-limit quantity clamping; 52 disabled options
retain their disabled state and unavailable cursor. Quantities were restored
to one. Neither sweep submitted a cart, reserved inventory or moved money.
The first option helper used rendered uppercase text against mixed-case native
titles; its failed rows are retained. Reading the authored DOM text fixes that
helper without changing expected product identities or application behavior.

The live responsive inventory covers 48 route/data families at five CSS
viewports: 320×740, 844×390, 768×1024, 1920×1080 and 720×450. The last viewport
models reflow at 200% of 1440×900; it is not actual browser zoom. The retained
240-row attempt records 127 passes/113 failures, including related failures
from the shared header and missing headings plus a helper's off-screen virtual
image checks. These totals are not 113 distinct application bugs. All rows
have zero actionable-cursor mismatches and zero main axe violations. Current
live failures remain open until their local corrections deploy and pass:

- **B6-COMPACT-INFORMATION:** implicit minimum grid widths let Contact, FAQ,
  Privacy and Cookies extend beyond a 320-pixel viewport. Shared page/field
  grids now use explicit shrinkable tracks and long text wraps. Contact email,
  Bandcamp and privacy-submit controls wrap within their own cards instead of
  merely fitting the document's width.
- **B6-TABLET-HEADER:** desktop navigation appeared at 768 pixels before its
  links, logo and cart fit. It now starts at 1024 pixels, with the existing
  keyboard-accessible drawer available below that width.
- **B6-MAIN-HEADINGS:** Home and Catalog had no main level-one heading. Home's
  existing label is now its heading, and Catalog has a visually hidden main
  heading. Cart's existing redirect leads to Home and inherits its correction.
  Authored numbered tracklists also retain their existing peer level-two panel
  heading and no duplicate ordinal.

The complete local correction passes 18 first-attempt browser cases across
desktop Chromium, Pixel 7 and iPhone 15 Pro emulation. These include 60 rendered
information-page/width checks, expanded FAQ answers, text/control containment,
main axe, nine drawer open/close/focus-return checks, Home/Catalog headings and
numbered tracklists. An earlier combined 20-page case exceeded its existing
30-second timeout on iPhone, including its retry. The replacement splits the
same checks into one case per width; no assertion, timeout or retry policy was
relaxed. Screenshots were inspected, and both production builds pass. The
local correction remains unpushed behind the prior live acceptance gate.

Fresh Redis inspection at 23:46 UTC verifies the same deployment/instance/run,
95,440 seconds uptime, healthy AOF/RDB, zero OOM/evictions/rejected connections
and the unchanged 237+1 failed queues. The 23:37:22–23:47:22 UTC support-log
window contains 12 ordinary Redis records, two PostgreSQL checkpoint start/
completion pairs, and 18 Meilisearch INFO/HTTP-200 records; Bucket/Console have
zero records. Exact identities remained unchanged. Railway's stderr severity
marked native LOG/INFO records as errors in the first helper; the explicit
native-message review passes with zero unknown entries or truncation. Retain
both attempts. This is a bounded observation, not an all-time crash claim.

Private gallery/option inventories, rows and screenshots are in
`browser/public-c290b7b-gallery/` and `browser/public-c290b7b-variant-text/`;
responsive evidence is in `browser/public-c290b7b-responsive-families/` and
`browser/responsive-controls-width-cases/`. Actual catalog client-link/history
coverage is still running. Native exchange/notification/refund acceptance
still requires the existing signed-in Admin session; do not count the fixture
matrix as real order acceptance or proceed to the client clone.

### Exact rollout and full public detail sweep — October 4, 23:25 UTC

Batch 6 remains open; pause before the client environment clone. Deployed
revision `c290b7b0c521cfabedf136a4881a2f9262eaf2bf` passes all four workflows/
23 strict checks and both complete current-database runtime image bundles.
Backend deployment `3e968ada-3f73-4732-a49b-5bc2d7b208b6`, Storefront
`0336922f-39b7-4ae9-89ab-715ae4e3965b`, Migrations
`bf6cfdd7-d64f-4303-8b16-a25fdf630c68` and RecoveryBackups
`a03388da-2a85-459b-9929-cd729e2fb29c` succeeded at the exact revision.
Migrations exited successfully; RecoveryBackups is scheduled idle. No new
manual archive or idle-job execution is claimed. Runtime role/ancestor,
package, notification-key binding and completed migration-receipt checks pass.
All nine services/jobs retain their expected observed states. The Backend's
build instance was removed during rollout; its new running instance is not a
post-success restart. The overlapping watcher started at 23:19 UTC.

- **Public inventory and direct-render coverage:** all 463 published products
  (443 music, 14 fixed bundles, five merchandise and one mystery bundle) and
  all six published news articles passed at 1365×900 in Chromium. Each actual
  page returned 200, rendered its expected title and one main heading, scrolled
  through its content, and showed no horizontal overflow, stretched visible
  images, browser errors or “A track skipped” fallback. Each has a private
  full-page screenshot and ledger row. This is 469 direct-page checks, not
  complete interaction, phone or financial acceptance. The feed lists 1,144
  authored product images; the separate gallery-control sweep is in progress.
  An earlier helper incorrectly counted clipped, unloaded carousel items as
  visible images. That failed attempt is retained; the corrected visibility
  check respects viewport and ancestor clipping without excluding visible
  broken media.
- **Deployed regression suites:** the primary suite passed 96 cases, with 17
  explicit local-fixture/desktop-only skips; Firefox/WebKit passed 16 cases.
  Mocked cart/payment routes in those suites are not actual Stripe purchases.
- **Bounded application logs:** fresh runtime and HTTP request correlation
  passed for both exact deployments, with zero server errors, unknown
  warnings/errors or truncation. Backend window 23:09:30–23:10:11 UTC contains
  71 rows; Storefront through 23:10:24 UTC contains 208. The first correlation
  attempt missed records that appeared in a later diagnostic; a subsequent
  helper observes advancing bounded window ends and rechecks the full window.
  An accidental future-start attempt correctly failed. Both failed attempts
  remain evidence, not passes. Ordinary scheduler/operations observation passed
  at 22:52 UTC with an exact-revision completed heartbeat.
- **Native exchange retest and actual access limit:** reopening the owned
  exchange and adding Reason/Note no longer crashed. Escape closed its reason
  popup while retaining the parent. At 22:58 UTC the native Admin session
  expired; its outbound item query returned 401 and misleadingly displayed
  “No records.” Existing native access is required to continue order actions.
  The sign-in page is ready; no new credentials or authorization bypass were
  introduced. Read-only Medusa/Stripe verification at 22:59 UTC confirms the
  same unconfirmed exchange/inbound M action, unchanged $9.07 capture, zero
  refunds and no replacement fulfillment. The temporary note was discarded
  and is not persisted. Live exchange, notification and cancellation-refund
  acceptance remain blocked on a valid native session.
- **Next local correction, held from push:** native RMA cards/quantity labels
  now preserve product and purchased variant names; claim/exchange shipping
  labels use existing translations. Three outbound pickers distinguish pending
  and denied reads from actual empty results through native loading/error
  boundaries. Six installed-component cases pass within 26 form contracts;
  all 19 compiled Admin fixture cases pass and both production builds pass.
  Authored sequential track numbers are displayed once while numeric song
  titles and mixed lists remain intact. Eight component cases and three local
  desktop/phone browser cases pass. The first browser run read cached older
  fixture data and had two retries; its evidence is retained. A separate
  numbered fixture and fresh provider/build give three first-attempt passes.
  Storefront baseline coverage passes 1,079 tests and transactional coverage
  passes 403. The responsive sweep additionally identified absent Home/Catalog
  main headings; their local semantic correction preserves existing layout.
  Final local checks and live acceptance of these changes remain open.

Private evidence stays in `artifacts/end-to-end-audit-2026-10-04/`: unique
per-attempt check logs, `browser/public-c290b7b-visible/` inventory/469 rows/
screenshots, exact runtime/migration receipts, application-log diagnostics,
`screenshots/rma-presentation/` and `browser/tracklist-fresh/`. The broad
responsive/cursor, gallery, remaining native Admin and real product-kind
checkout matrix remain open. Keep this local corrective group unpushed until
the preceding exact deployment's required live acceptance passes.

### Native order correction release — October 4, 22:35 UTC

The cohesive correction is pushed directly to `staging` at
`c290b7b0c521cfabedf136a4881a2f9262eaf2bf`, with its Conventional Commit bullet
body and normal lint/coverage hooks. All four workflows and 23 strict checks pass: Root `37240584136`, Backend
`37240584145`, Storefront `37240584154`, Runtime Images `37240584151`.
Read-only exact-SHA readiness is green. Both complete image evidence bundles
verify with the current vulnerability database. Railway observed all four
app/job deployments waiting before CI completion. The later entry above
records their successful exact rollout and the remaining live acceptance.

At 22:33:45–22:33:47 UTC the prior exact `09c3737e` scheduler and operations
probes passed after the incident naturally expired through its full 24-hour
window. Its ordinary heartbeat was 22:32:00 UTC. All eleven dependency and
capability checks passed; the catalog remains 463 products, 442 discography
records and three shelves/25 memberships. The 22:32:30–22:32:59 UTC application
log window independently passed runtime/HTTP correlation with zero server
errors, unknown warnings or truncation. No incident/failed queue was cleared.
The native exchange crash still requires the corrective deployment and live
retest; these operational passes do not close the exhaustive audit.

### Native fulfillment, exchange crash and notification corrections — October 4, 15:06–22:30 UTC

Batch 6 remains open at deployed `09c3737e`. The existing exact CI, runtime,
role, migration and application rollout checks passed; that does not accept
its newly discovered native exchange failure. Corrective releases remain
within this audit batch. The scheduler's October 3 22:33:01 UTC incident must
expire naturally after its full 24-hour window; no latch or failed queue is
cleared. Pause before the client environment clone.

- **Actual owned order #9 fulfillment/stock cycle:** partial CD fulfillment
  `ful_01M43QV8S80HZM0C90FD2KYRA0` reduced CD stock 20→19 and released only its
  reservation; native cancellation restored stock 20 and its reservation.
  The M shirt remained reserved throughout. Full fulfillment
  `ful_01M43REJQQFQFJWV01HP2FC3YZ` then reduced CD stock to 19 and M stock to 3,
  with reservations zero. One unchanged $9.07 capture and zero refunds remain.
  Native shipment registered at 15:33:48 UTC and delivery at 15:35:36 UTC.
  The saved tracking reference explicitly says NO-SHIP and uses example.com;
  this was internal manual fulfillment, with no carrier purchase or shipment.
  Unsaved tracking rows were discarded and reopening showed none before save.
- **B6-NATIVE-EXCHANGE-CRASH:** adding the delivered M shirt to an exchange's
  inbound section crashed native Admin (`TypeError: i is not a function`).
  The public deployed bundle and installed source confirm standalone
  `Form.Hint` calls an absent context setter outside `Form.Item`. Both Medusa
  Dashboard and Draft Order contain the helper. Their same-version patches
  guard standalone registration and emit only mounted label/hint/message IDs.
  Real compiled-page fixtures and three installed-module hook tests cover both
  ESM/CJS copies. No Trusted Types exception or permission change is involved.
- **Preserved native draft:** exchange `oexc_01M43S1AJA5J7BWHNPZBBBYBF6`, return
  `return_01M43S5XM1Z5ST5R0QX922P5DS` and pending order change
  `ordch_01M43S1ANR4KXYBN9C7MST1GKD` belong to owned order #9. One M-shirt
  RETURN_ITEM action is saved. The exchange is unconfirmed; no replacement
  payment/refund, incoming receipt or outgoing S-shirt fulfillment is claimed.
  Resume through native Admin after the correction deploys. Do not repair it
  with SQL, cancel unrelated drafts, or submit an unverified duplicate.
- **Native form/accessibility corrections:** refund/fulfillment/shipment/RMA
  forms use their native title/description components and explicit field names.
  Empty fulfillment and unchanged quantity/note updates stop before mutation.
  Item pickers use named buttons/checkboxes with adequate targets and contrast.
  The exchange's selector Escape behavior also closed its parent form; the
  current keyboard correction covers lazy/main Dashboard and both Draft Order
  implementations. Nineteen compiled Admin accessibility cases pass with zero
  axe violations/incomplete results, including the preserved draft, active
  picker, keyboard focus and oversized-period recovery. The picker's 20-pixel
  checkbox targets were enlarged to 24 pixels. Failed attempts exposed
  incomplete build-entry parity and are retained, not counted as passes.
- **B6-FULFILLMENT-NOTIFICATION:** actual native “Send notification” selections
  created no notice at fulfillment, shipping or delivery; only order-placed
  existed. The local subscriber now consumes the pinned native workflow events,
  honors `no_notification`, checks the persisted stage and exact native order
  link, and calls the existing durable notification verifier. Per-fulfillment/
  stage business keys and immutable minimal data preserve provider retry safety.
  Partial-shipment copy never claims the whole order shipped. No carrier or
  arbitrary tracking URL is introduced. Actual deployed controlled-recipient
  delivery and notification opt-out still require retesting after rollout.
- **Tax/native navigation:** all Connecticut quality/collection/provider and
  empty-result filters, clearing, native order links and state/period changes
  were exercised. NY/PA empty reports and jurisdiction filter resets passed.
  Both nonempty CSVs have the correct pending $9.07 sales and zero tax, with no
  contact/street fields. Destination export intentionally has separate report
  sections; naive single-table CSV decoding is not its contract. Oversized
  periods retain the last applied report. Seventeen existing Admin accessibility
  cases and both new native exchange cases pass.

A bounded application-log observation passed at 15:06:00–15:06:33 UTC for both
apps: zero HTTP 5xx, unknown warnings/errors or truncation. This predates the
exchange failure and is not final audit acceptance. The all-service watcher
ended at 17:08:24 UTC and resumed at 21:36:13 UTC after the pause; no continuous
observation is claimed across that gap. Current samples show all nine expected
healthy/completed/idle states. The fresh 22:07 Redis diagnostic retains its
same deployment, instance and run hash with 89,476 seconds uptime, healthy
AOF/RDB, zero OOM/evictions/rejected connections and the unchanged 237 scheduled
plus one event failure. Preserve those historical failures.

Local notification checks pass 65 focused cases. The full Backend suite passes
2,395 cases/293 suites. Disposable integration passes 74 native cases and 44
lifecycle/reconciliation cases plus the full recovery/session aggregate. Its
new notification case uses the real PostgreSQL fulfillment/order link and
persisted stage timestamps, with only outbound email stubbed; it proves no live
provider delivery. An initial test tried to cancel an already shipped fixture
and correctly hit the native guard; the corrected cancellation uses a separate
unshipped fulfillment. All failed attempts and owned-resource cleanup remain
recorded. Both production builds and full lint/type/form contracts pass.
The Storefront build uses the loopback Medusa fixture and distinct synthetic
CI secrets; earlier missing-secret/search configuration failures are retained.
All three mobile email previews pass axe without overflow, with one heading,
English direction metadata and a main landmark; this is offline Chromium
rendering, not live provider or email-client acceptance. The picker header now uses the installed “Select all” translation and its
rendered regression checks that name. CI, deployment and live acceptance
remain open for the cohesive corrective staging release. No package
versions, cooling exceptions or third-party-web resolution changed.

Private evidence: `artifacts/end-to-end-audit-2026-10-04/`, including unique
lifecycle receipts, CSV section verification, strict image scans, screenshots,
per-attempt logs and read-only Redis/provider diagnostics. Remaining route,
merchandise/bundle, returns/claims/exchange, content/media, wallet-device and
responsive/cursor coverage remains open. The client clone remains paused.

### Live payment/refund matrix and further corrections — October 4, 13:44–14:50 UTC

The refund-ID fix is deployed at `09c3737e41e6cd58d31bd7c31e5b07a8bef87593`.
All four workflows/23 strict checks passed (Root `37206155839`, Backend
`37206155878`, Storefront `37206155850`, Runtime Images `37206155844`).
Both image evidence bundles verified. Exact Backend deployment
`c9e8c959-f7d9-4fac-9102-7bf2843f01bd`, Storefront
`1c40292e-cb6e-42fd-812f-27f0702a9ca6`, Migrations
`beaffedb-b68b-4678-ae8a-3d42969c899b` and scheduled RecoveryBackups
`369d8e37-b914-4ed6-b79c-c2a4f55332b2` succeeded. Runtime packages, real
process/ancestor roles, completed migration receipt and notification-key
binding passed. The backup job is scheduled idle; no new exact-revision
archive was manually manufactured. Keep the verified 04:00 scheduled archive.

- **Order #8 partial refunds recovered:** a second native $4 shipping refund
  brought the recorded/provider total to $5. Both controlled-recipient notices
  succeeded, including recovery of the earlier $1 notice. Medusa business keys
  and provider external IDs verify delivery acceptance; no inbox claim is made.
- **Native cancellation:** the unfulfilled order canceled at 14:04 UTC,
  automatically refunded the remaining $1.23 and released its reservation.
  Stock remains 20, with no phantom restock. Native/Stripe totals agree at
  $6.23 across three refunds, paid/outstanding zero. Operations → Refunds
  shows Verified / Tax not collected. Search, combined status/tax filters,
  empty results, clearing and refresh were exercised on that case.
- **B6-CANCEL-REFUND-NOTICE — local correction:** the automatic cancellation
  refund has no customer notice. Pinned Medusa's bulk `refundPaymentsWorkflow`
  omits the event emitted by its individual refund workflow. The same-version
  patch emits `payment.refunded` for successfully persisted result IDs through
  Medusa's grouped event step; existing validated, idempotent subscribers own
  email and immediate evidence reconciliation. No second refund API is added.
- **B6-NATIVE-REFUND-DEFAULT / B6-NATIVE-REFUND-DIALOG — local correction:**
  native Admin reused the original $6.23 after an earlier partial refund, and
  its Create Refund drawer logged a missing Radix title. The patch queries
  native captures, defaults to captured amount less refunds, rejects invalid
  or excessive submissions before the mutation, and uses `RouteDrawer.Title`.
  Backend financial validation remains authoritative. Native bulk integration
  records $1/$4/$1.23 and verifies events after persistence; its excessive
  attempt uses $0.02 beyond Medusa's existing one-cent currency tolerance.
  Initial tolerance/serialized-error assertion failures are retained.
- **Actual hosted-card failures and authentication:** the same mixed cart
  rejected generic decline, insufficient funds, expired card, incorrect CVC
  and processing-error test cards with clear feedback. Each verified attempt
  retained the cart/session with zero orders, payments, captures or notices.
  Invalid card number was blocked by hosted-field validation and disabled
  submit. Actual 3D Secure cancellation and failure remained retryable, also
  without a native order/capture. A successful challenge then created only
  **order #9**, $9.07 USD (M shirt $2.34, CD $1.23, shipping $5.50, tax off).
  Stripe Dashboard independently shows the complete failed-attempt history,
  one successful challenge and capture. The optional Link save box was
  explicitly unchecked; no Link account or phone was submitted.
- **Order #9 independent reconciliation:** native order
  `order_01M43NH040G21HCD2CVN38N0ZX`, payment
  `pay_01M43NH0GH62C6TPX92JVZ4RHB`, one capture, completed cart and controlled
  order notification agree with Stripe `pi_3UMpmvIM4tTeFQ3W0d8dpXHW` and
  `ch_3UMpmvIM4tTeFQ3W0JxMTR6A`. The new browser receipt shows #9 and its
  current items, rather than order #8's earlier data. The later entry above supersedes its
  unfulfilled state; keep the owned delivered order and pending exchange for
  return/claim/exchange testing.
- **Nonempty Connecticut export / B6-TAX-CLASSIFICATION:** the transaction CSV
  has one order-#9 row and 36 columns, no customer contact/street fields,
  taxable/nontaxable/tax zero and $9.07 pending review. The desktop table put
  that pending amount under a “Taxable” heading despite the correct totals,
  mobile card and CSV. The local UI correction labels its sales classification
  explicitly; desktop/mobile rendered regressions are being added. A native
  keyboard period over 1,462 days is rejected while the prior report remains;
  restoring the current-quarter preset succeeds. DOM date-fill attempts did
  not update React state and are not counted as acceptance.

All nine services/jobs remain observed with no deployment faults. Redis at
14:02:45 UTC retained its run/instance identity, 60,418 seconds uptime,
healthy AOF/RDB and zero OOM/eviction/rejected counters; its 237 scheduled and
one event failure remain preserved. The ordinary 14:20 scheduler heartbeat
matches `09c3737e`; the October 3 22:33 incident still correctly makes scheduler
and operations return 503 within their 24-hour window. This release is **not
yet accepted**, and the next correction stays local until deployed acceptance
passes. The initial log review includes two intentional health 503 responses;
a subsequent read timed out and is retained. Retry correlation separately.

The refund patch group passes frozen offline installation, shared lint/type
checks, 2,352 Backend coverage cases, 16 dashboard-form cases, 15 pre-existing
Admin accessibility cases and the full disposable integration/recovery
aggregate (73 native cases plus 44 lifecycle/reconciliation cases and recovery
suites). The new tax UI correction still needs its updated build/browser
checks. Fresh fixture scans used official checksum/digest-verified Trivy
0.74.0 and the October 4 14:28 DB on both pinned local-daemon images. The
workstation's stale Desktop Docker context was preserved; a task-local wrapper
selects its existing Linux daemon. Failed argument/context/install and provider
read attempts remain in private evidence. No package version/cooling exception
changed; patch-commit's unrelated third-party-web resolution was restored.

Evidence: ignored `artifacts/end-to-end-audit-2026-10-04/`, including per-attempt
redacted receipts and verification logs. Batch 6's remaining merchandise/bundle,
fulfillment/returns, content/media, responsive/cursor and full-route controls
are still open. Continue the audit; **pause before Batch 7's client clone**.

### Resumed audit — October 4, 12:47 UTC onward

The user resumed Batch 6 and restored native Admin access. The separate stop
before the client environment remains in force. Fresh exact-revision CI and
readiness checks passed on `923aa73`; this is not exhaustive audit acceptance.

- **Actual hosted Stripe card payment:** the existing owned $6.23 USD cart
  completed through the browser using Stripe's official `4242` test card.
  Storefront confirmation displayed order **#8**, item $1.23, shipping $5,
  explicit zero tax collected, and an empty cart. Native Medusa and the
  independently signed-in Stripe sandbox both showed captured/succeeded.
  Runtime test-key/account binding was verified immediately beforehand.
  The optional Link phone field stayed empty; no Link account was created.
- Native order `order_01M43FQ2TJ9RNAS0JP54FV7307` has one captured payment,
  completed cart, linked disabled-mode generation-2 tax evidence and one
  successful Resend-backed order notification to the controlled test address.
  Provider acceptance is recorded; this is not an inbox delivery claim.
- **Actual native partial refund:** a $1 shipping credit was issued through
  the Medusa payment row with the owned sandbox reason. Native refund
  `ref_01M43FX51KH7H2ZGHNARDNCZHP` and Stripe refund
  `re_3UMeJMIM4tTeFQ3W0zMcUzSR` agree. Both signed lifecycle events processed
  once; Operations → Refunds shows **Verified / Tax not collected**. Stock
  remains 20 with one reserved unit, as expected before fulfillment or cancel.
- **B6-REFUND-NOTICE — corrective release required:** the refund subscriber
  rejects Medusa's actual `ref_…` identifier because its payload builder
  expected `refund_…`. The live bounded log confirms the validation failure
  and no refund notification was created. The installed Medusa 2.18.0 model
  confirms `ref` is its native prefix. The local fix retains strict entity
  validation and business-key idempotency. Realistic refund fixtures reproduce
  the failure before the fix; all 27 focused cases and all 2,352 Backend tests
  pass afterward. Reject non-native `refund_…` and Stripe `re_…` inputs.
  Deployed notice recovery and repeated/full refunds remain pending.
- **B6-WALLET-DOMAIN:** actual Stripe.js reports the staging domain is not
  registered for Apple Pay. Card payment succeeds. Wallet acceptance is not
  claimed; retain the domain-registration/device coverage requirement.
- **Admin report period:** live native keyboard checks reject reversed,
  equal and blank dates without replacing the prior report; restoring the
  current-quarter preset works. The Connecticut transaction CSV downloaded
  successfully and has the expected 36 columns with no customer contact or
  street-address fields. It contains no data rows because the new owned sale
  is in California. Oversized-period and nonempty CSV checks remain pending.
- **Scheduled recovery backup:** the actual October 4 04:00 UTC job ran
  04:02:09–04:03:13, execution `1bf72c1d-af7b-4240-a73a-fbfe6bff350a`.
  Verified encrypted archive `d196787a-84c0-4b28-b42c-448e2b7b051c` contains
  four database files and 1,172 media objects. Its receipt hash is
  `16d3a95075eb72b84fe546309c41aa9c3a73d9b76faa6f73d7d480579fc04cc3`.
  Schedule, exited execution, retention and latest archive agree. No extra
  manual backup was started.

Private redacted evidence and read-only helpers are under
`artifacts/end-to-end-audit-2026-10-04/`. The local service observer stopped
after 12:56:39 UTC; a fresh observer resumed at 13:24 UTC and again reported
all nine services/jobs without faults. Do not claim continuous observation
across that gap. The prior scheduler incident latch remains intact.

### Requested stopping checkpoint — October 4, 02:57 UTC

The user asked to stop at a safe checkpoint and continue later. The current
corrective staging push reached the checkpoint below; audit work is paused.
Resume only when the user asks to continue. Revision
`923aa73a4939a8bd05583eb14fb568296acf26b9` contains the application fixes in
`4730e12` plus the two CI fixture corrections described below. All four
workflows and all 23 required checks passed: Root `37171741644`, Backend
`37171741674`, Storefront `37171741653`, Runtime Images `37171741654`. Both
image evidence bundles verified. Exact Railway deployments:

- Backend `e8af8b9b-4202-4eb0-9ddf-6b930d22c7c0`, running instance
  `c28150e4-43ca-44ee-bf2c-c95b2d899d7c`. The earlier rollout instance was
  removed; no CRASHED instance was observed.
- Storefront `7c7095f7-0735-44b2-b42c-5f244ffabfe5`, running instance
  `9f5b4bf9-ef02-4ea7-b163-2dab54295901`.
- Migrations `917c010c-b23d-4868-9bb7-3acf3f5b835a`, completed and exited.
- RecoveryBackups `3302df60-fc10-4f59-9fce-7993cb88d782`, manual execution
  `67ea5123-2b84-4bfd-82f0-e77172831b2c`, completed and exited. Verified
  archive `5e879694-970a-43f3-b611-ef5c34ff577a` contains four database files
  and 1,172 media objects; receipt and retention passed. Do not rerun this
  manual execution or count it as the scheduled 04:00 UTC observation.

Full deployment/health/readiness passed after an initial unverified read during
rollout; retain that failed observation. Runtime/package/role/ancestor/Next and
notification-key binding checks passed. Redis retained its process/instance
identity at 02:47:05 UTC with 19,875 seconds uptime, healthy persistence and
zero OOM/eviction/rejected-connection counters. The ordinary 02:56 heartbeat
matches this SHA. Scheduler/operations still correctly report 503 for the prior
incident latch; the first heartbeat read still saw the previous SHA and remains
failed evidence. All catalog/dependency probes passed. Supporting-service logs
from 02:54:55 UTC showed no suspicious entries; Meilisearch's six stderr rows
were native INFO 2xx requests. The deployed responsive/browser suite passed
96 cases with 17 documented skips and zero retries. Its six spec files were
`contact`, `fonts`, `rich-text-navigation`, `storefront-smoke`, `stripe-loader`
and `ui-runtime`; the new rich-text fixture paths and existing gallery fixtures
are local-only skips, not live coverage. Screenshots/traces use a dedicated
release directory and are not overwritten by another fixture run. Final
02:57:14–02:57:27 UTC runtime/HTTP correlation passed for both applications:
zero HTTP 5xx, zero unclassified warnings/errors and no truncation. The sole
Backend warning was the exact intentional acceptance guard's 400 response.
All nine services/jobs reached expected healthy or completed/exited states.
This is a verified stopping checkpoint, not full Batch 6 acceptance; the
scheduler latch and remaining audit coverage are preserved.

Live client navigation from the owned shirt to `Cacophony of Filth`, followed
by back/forward, rendered the music description without new browser warnings
or errors. The owned-release heading moved out of the carousel's visible window
before earlier clicks; those timed-out targeting attempts are not application
navigation crashes. The exact owned-to-owned repeat and live news coverage
remain to be completed. Reloading the existing unpaid checkout now renders
Stripe's actual hosted card/expiry/CVC form, with no new console warnings/errors;
its desktop screenshot was inspected. The original $6.23 cart remains pending.
Stripe Link's save-information option is initially checked; deselect it before
test payment unless saving information is explicitly authorized. No card or
phone number was entered. Native Admin report-period live retesting is deferred.

Private release evidence is in
`artifacts/end-to-end-audit-2026-10-03/release-923aa73/`. These closing handoff
notes remain local for the next cohesive push, avoiding another deployment
cycle solely to record the user's pause. All application/test fixes are pushed.
Audit browser tabs are marked for continuation. Local CI/deployment observers
are stopped at the user's pause; no continuous overnight observation is claimed.

No card has been submitted, no paid audit order created and no refund issued.
Preserve the existing $6.23 pending sandbox cart/session and owned fixtures.
On resumption, complete these remaining audit groups without creating the
client environment:

1. Finish the exact owned-product pair and live news navigation retests, verify
   invalid Admin report-period recovery, and repeat payment preflight before
   using the now-rendering hosted Stripe form on the then-current revision.
2. Complete the real sandbox payment matrix: success, 3DS success/cancel,
   decline/retry and interrupted-checkout recovery. Independently reconcile
   native Medusa orders, Stripe state, inventory, webhooks and controlled
   notification evidence. Use Medusa as the payment/refund authority.
3. Complete partial/full/repeated/shipping refund checks and applicable
   returns, claims and exchanges; preserve their audit evidence.
4. Finish fixed/mystery bundles and mixed carts, remaining native Admin and
   catalog/content/media workflows, CSV-content checks, and documented
   accessible-name/tracklist findings.
5. Reconcile all 44 routes and 493 inventoried controls with the actual
   interaction, visual, cursor, responsive and accessibility evidence. Do not
   present the inventory or automated fixture coverage as exhaustive live QA.
6. Resolve or explicitly carry forward remaining findings, verify all nine
   services/jobs and final logs, and publish the Batch 6 completion report.

Retain the scheduler incident latch from October 3, 22:33:01.756 UTC and its
full 24-hour observation window; a healthy current heartbeat does not clear
that record. The scheduled 04:00 UTC backup has not yet been observed here.
Retain historical failed queues (237 scheduled, one event) without replay.
The existing infrastructure/security carryovers remain in the hardening plan.
Batch 7's client clone and production remain outside this paused work.

### Trusted Types correction: CI fixture matcher repair — October 4, 02:32 UTC

The correction was pushed directly to staging as
`4730e12a638dce1279a9d1fa8c3c8b3f8064f5b9`. Backend and Storefront CodeQL
both analyze the repository and rejected the same new finding, alert 65
(`js/regex/missing-regexp-anchor`), in the browser fixture's Stripe route
matcher. The production policy already anchors its URL allowlist. Add the
missing start anchor to the fixture; all nine Chromium/Firefox/WebKit loader
cases pass after the correction. No finding is suppressed or CI rule relaxed.
This revision is not
release-accepted. Preserve its failed jobs and require all four workflows on
the corrective revision before release acceptance or subsequent work.

The final workflow inventory also found two launch-suite failures: the
server-rendered JSON-LD tests still expected the earlier exact policy-name
list. Update that exact assertion for the narrowly restricted Stripe default
policy, preserving the required Trusted Types directive, nonce, JSON-LD and
SPA lifecycle checks. The responsive run itself and critical three-browser
run passed; the combined responsive/launch job and its aggregate failed.
An early progress update missed this late result and was corrected. The
task-owned corrective push was stopped during its pre-push hook before
submission so both test repairs can travel together.
The complete local launch suite now passes all 20 cases, including both
JavaScript-disabled JSON-LD checks and hydrated history/security tests.

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

**Failed-release correction — October 6, 22:32 UTC:** the grouped Batch 6
push is `1b09546974bd73713031c1f0a5f9fa3ff09d500d`. All four exact workflows
fail on eight newly reviewed/revised dependency advisories; Runtime Images
also fails its security scans. Railway holds the candidate and the active
pair remains `c290b7b`. This failure is retained and repaired within Batch 6.
The narrow local dependency correction removes vulnerable `sprintf-js` while
keeping legacy CLI APIs, installs mature fixes for the other affected families
and records only the exact Source Map 1.2.2 cooling exception under delegated
hardening authority. Frozen installation, full lint/type/policy gates, both
builds, Backend 2,423 tests, 75 native/44 payment integration cases, the full
recovery aggregate and full/prod audit plus complete source scanning pass.
See the opening dependency audit for identities, license/age review and retained
failures. Runtime-image verification and corrective push/CI remain pending;
no release acceptance is claimed. All nine services/jobs remain stable.
Native tax report filters and the transaction export pass; the destination
export passes a bounded retry with one owned $9.07 destination and matching
period totals. Preserve the first download timeout and the excluded older file.
The owned order #9 exchange, financial/notification cleanup, paid-family checks,
guarded search rebuild and ordinary scheduler acceptance remain open. Preserve
the 24-hour incident latch and pause before the client clone.

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
