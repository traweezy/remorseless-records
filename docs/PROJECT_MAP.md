# Project map and continuation guide

Last indexed: October 2, 2026 (UTC). The inventory covered 1,589 project files
and 98 documentation/reference files, excluding unrelated `Default/` and
generated/dependency outputs. Current security work and release acceptance
are recorded in the handoff linked below.

## October 11 continuation boundary

The cohesive staging push `74e87db` passes normal local gates but both service
secret scans flag one synthetic News route UUID. A pinned history scan
reproduces only that finding. The active fixture and exact historical
fingerprint are corrected; a verified corrective push and deployed acceptance
remain pending. Both application deployments are waiting for CI. Batch 6 is
open and client cloning stays paused; see the latest handoff.

Root CI subsequently fails the same scan; Runtime Images passes. The corrected
17 route tests and pinned staged/full-history scans pass (1,163 commits).
The current full native/service gate passes: all 162 cases, four Settings
modes (57 checkpoints each), four News modes (12 each), payment lifecycle,
PostgreSQL recovery, Redis, API and session checks. Independent cleanup proves
2,045 unchanged inputs, 632 closed relays and 785 known processes absent.
Both application builds, shared lint/types and eighteen storefront browser
cases pass. Commit the cohesive correction and require exact staging CI,
all-service rollout and live acceptance; Batch 6 stays open and cloning paused.

Earlier October 11 failures and corrections remain recorded below.

Batch 6 resumes; the client clone remains paused. The original full native
gate finishes 160/162: both desktop Settings and all four News modes pass;
both phone modes expose success feedback covering a currency-row action.
Independent cleanup releases the source freeze. Current same-version patches
scope the new placement to errors and repair Product Tags query translation;
media timestamps are retained through serialization. All 266 installed
regressions, 46 focused media tests and the 336-file fixture build pass.
The corrected phone-light diagnostic passes all 57 checkpoints and cleanup;
full native and release acceptance were pending at that diagnostic checkpoint.
The complete local run recorded above subsequently passes. See the
[October 11 handoff](NEXT_SESSION_HANDOFF.md) for exact evidence and next work.

The later reviewed Chrome run completes every Settings/News UI checkpoint but
finishes 161/162 because News phone-dark checks process absence before an
observed descendant is naturally reaped. Independent cleanup releases the
source freeze with all 707 known processes absent. Six process regressions
pass after joining natural removal within the existing deadline; the original
failure remains retained; the complete local run above subsequently passes.
Exact staging CI and deployed acceptance remain required.

## October 10 continuation boundary

The focused Settings phase-timing diagnostic (original session 73356) finishes
with exit 0 on October 9, 23:23:44–23:29:35 UTC: 154 ordinary checks plus the
original desktop-light Settings case pass (155 passed, 3 skipped, 158 total
in four suites). All 57 selected checkpoints and five cleanup actions pass.
The other three Settings modes, every News mode, post-Jest payment lifecycle
and later chained families are unrun. This is diagnostic evidence only; the
original all-eight/162 gate, native acceptance and release acceptance remain
incomplete. Retained phase timings do not establish a cause or optimization.

Root independently verifies cleanup on October 10 at 21:28:53 UTC
(`f8fc1d0a…`): 1,038 source inputs and separately frozen Doc4 are unchanged,
56 recorded process identities and 509 relay host PIDs are absent, all
509 relays are closed, and the exact owned containers, Compose resources and
relay listeners are absent. Unobserved descendants remain outside the proof.
A separate Root join (`66c27a67…`) rechecks immutable bindings and runner
absence, then releases the source freeze at 21:29:17 UTC. Root sends no signals.

The user redirects active work to the professional profile/resume refresh.
Store Batch 6 remains paused with the same 49 paths uncommitted/unpushed; the
390 px phone-light Toast covering Edit role remains open. Client cloning stays
paused. Resume with the timing evidence and unchanged full gate, checkpoint,
Axe, screenshot, mutation-fence and 900/240-second boundaries.

## Start here

1. Read [NEXT_SESSION_HANDOFF.md](NEXT_SESSION_HANDOFF.md) for the latest accepted
   revision, unfinished work, evidence, and operational boundaries.
2. Use [PRODUCTION_HARDENING_PLAN.md](PRODUCTION_HARDENING_PLAN.md) for the
   remaining launch requirements and [RELEASE_OPERATIONS.md](RELEASE_OPERATIONS.md)
   for the staging acceptance and production approval sequence.
3. Locate the affected code and runbook below, then inspect current source,
   manifests, lockfile, and CI before implementing changes.

The long handoff, hardening plan, and dependency audit contain dated history.
An old passing run, package version, command, or temporary evidence path is not
current acceptance. Prefer the latest applicable handoff entry and executable
policy; verify remote state again before release. Some package README files are
framework scaffolding rather than project-specific operational instructions.

## Code and tooling

| Task | Primary entrypoints |
| --- | --- |
| Understand the product and development setup | [Root README](../README.md), [Backend README](../backend/README.md), [Storefront README](../storefront/README.md) |
| Runtime and dependency policy | Root `.nvmrc`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; `scripts/security/`; mirrored Backend/Storefront workspace policy |
| Backend startup and provider wiring | `backend/medusa-config.js`, `backend/scripts/`, `backend/src/modules/` |
| Store/Admin HTTP contracts | `backend/src/api/store/`, `backend/src/api/admin/`, `backend/src/api/middlewares.ts`, `backend/src/policies/` |
| Catalog authoring, bundles, media, shelves | `backend/src/modules/catalog/`, `backend/src/lib/catalog/`, `backend/src/workflows/catalog/`, `backend/src/links/` |
| News and Discography | `backend/src/modules/news/`, `backend/src/modules/discography/`, `backend/src/lib/content/`, `backend/src/lib/discography/` |
| Admin screens and forms | `backend/src/admin/routes/`, `backend/src/admin/widgets/`, `backend/src/admin/features/`, `backend/src/admin/components/` |
| Checkout, payment, refunds, tax | `backend/src/lib/checkout/`, `payment-lifecycle/`, `stripe/`, `refund-operations/`, `tax-control/`, `tax-reporting/`; corresponding modules, routes, and subscribers |
| Scheduled reconciliation and retention | `backend/src/jobs/`, `backend/src/lib/cart-retention.ts`, `abandoned-checkout-retention.ts`, `backend/src/lib/health/` |
| Email and event delivery | `backend/src/subscribers/`, `backend/src/modules/email-notifications/`, `backend/src/lib/notifications/` |
| Storefront pages and server routes | `storefront/src/app/`, including `api/`, `checkout/`, `catalog/`, `products/`, `news/`, and `order/` |
| Storefront interactions and state | `storefront/src/components/`, `storefront/src/features/`, `storefront/src/lib/cart/`, `store/`, `query/`, and `storefront/src/providers/` |
| Storefront provider decoding, search, security | `storefront/src/lib/data/`, `medusa/`, `search/`, `security/`, `http/`; `storefront/src/config/`; `storefront/next.config.ts` |
| Health, telemetry, request correlation | Both applications' `src/lib/health/` and `src/lib/observability/` (including Backend continuous database windows); `backend/src/lib/meilisearch/transform-budget.ts`;  Backend `src/api/health/`; `scripts/observe-*-health.mjs`, `scripts/verify-railway-runtime-log.mjs` |
| Data maintenance and recovery | `backend/src/scripts/`, `backend/src/cli/`, root `scripts/postgres-*.mjs`, `railway-recovery-*.mjs`, `railway-scheduled-backup.mjs`, `staging-recovery-audit.mjs`, `operations/Dockerfile`, `media-backup.mjs`, `media-restore-drill.mjs`, `redis-capacity-audit.mjs`, `redis-aof-capture.mjs`, `redis-aof-recovery.mjs`, `redis-aof-isolated-replay.mjs`, `backend-isolated-startup-smoke.mjs` |
| Unit, service, browser, accessibility, performance QA | Application test/config files; `scripts/*.test.mjs`; `storefront/e2e/`; `storefront/playwright*.ts`; `qa/`; `lighthouse/` |
| Disposable service tests | `scripts/run-disposable-integration.mjs`, `scripts/scan-disposable-integration-images.mjs`, `docker/integration/` |
| Runtime image candidates | `backend/Dockerfile.runtime`, `storefront/Dockerfile.runtime`, `scripts/*runtime-image*.mjs`, `scripts/security/runtime-image-policy.json` |
| CI and scheduled monitoring | `.github/workflows/{root,backend,storefront,runtime-images,staging-scheduler-monitor,staging-operations-monitor}.yml` |
| Direct staging batch validation | `scripts/dependency-review-range.mjs`, `scripts/staging-release-readiness.mjs`, `scripts/staging-backup-audit.mjs`, `scripts/lib/staging-release.mjs`; [release runbook](RELEASE_OPERATIONS.md) |
| Railway application configuration | [Railway guide](../.railway/README.md), `.railway/railway.ts`, guarded `scripts/railway-config.mjs` |
| Reproducible dependency corrections | `patches/`, lockfile patch hashes, and their matching `scripts/verify-*.mjs` behavioral/policy gates |

Generated `.medusa`, `.next`, coverage, browser reports, and ignored operational
artifacts are outputs, not implementation authorities. `Default/` is unrelated
user data and is excluded from project work.

## Documentation guide

### Engineering, release, and operations

| Document | Use it for |
| --- | --- |
| [Next session handoff](NEXT_SESSION_HANDOFF.md) | Current continuation point and exact acceptance evidence |
| [October 2 security follow-up](SECURITY_FOLLOWUP_2026-10-02.md) | Historical credential revocation, dependency repair, and pending release gates |
| [Credential rotation](CREDENTIAL_ROTATION.md) | Batch 5 historical exposure audit, reference cleanup, recovery checkpoint and coordinated retirement evidence |
| [Production hardening plan](PRODUCTION_HARDENING_PLAN.md) | Completed engineering work, open launch blockers, and approval requirements |
| [Dependency migration audit](DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md) | Package families, cooling, compatibility, exceptions, and migration holds |
| [QA runbook](QA_RUNBOOK.md) | Local gates, browser scenarios, screenshots, and acceptance procedures |
| [End-to-end audit](END_TO_END_AUDIT.md) | Batch 6: exhaustive Storefront/Admin interactions, visual review, real Stripe sandbox purchases/refunds, fixes and acceptance before the client clone |
| [Disposable integration](DISPOSABLE_INTEGRATION.md) | Isolated PostgreSQL/Redis fixtures, scanned image identity, and cleanup |
| [Release operations](RELEASE_OPERATIONS.md) | Branch authority, grouped staging releases, CI hold, and rollback |
| [Infrastructure recovery](INFRASTRUCTURE_RECOVERY.md) | Data roles, networking, backups, restores, support images, and production topology |
| [PostgreSQL restore acceptance](POSTGRES_RESTORE_ACCEPTANCE.md) | Receipt-required same-major logical restore sequence and limits |
| [Observability operations](OBSERVABILITY_OPERATIONS.md) | Health contracts, service objectives, incident handling, and privacy-safe evidence |
| [API Problem contract](API_PROBLEM_CONTRACT.md) and [OpenAPI schema](openapi/api-problems.yaml) | Shared HTTP error format and generated contract checks |
| [Media security](MEDIA_SECURITY.md) | Upload validation, managed assets, quarantine, and the disabled physical-purge boundary |
| [Browser test README](../storefront/e2e/README.md) | Storefront test organization and fixture conventions |

### Commerce and operator guides

| Document | Use it for |
| --- | --- |
| [Admin client guide](ADMIN_CLIENT_GUIDE.md) | Everyday Catalog, Content, and Operations tasks |
| [Admin support guide](ADMIN_SUPPORT_GUIDE.md) | Recovery, failed/stale saves, permission issues, and escalation |
| [Admin experience rework](ADMIN_EXPERIENCE_REWORK.md) | Form architecture, UX inventory, design decisions, and acceptance history |
| [Checkout operations](CHECKOUT_OPERATIONS.md) | Payment authority, reconciliation, receipt/recovery, and safe incident handling |
| [Refund operations](REFUND_OPERATIONS.md) | Refund inspection, authorization, idempotency, and verification |
| [Tax control operations](TAX_CONTROL_OPERATIONS.md) | Audited collection-mode/provider transitions and rollback |
| [Tax collection client guide](TAX_COLLECTION_CLIENT_GUIDE.md) | Plain-language operator tax controls and their effects |
| [Tax records and filing](TAX_RECORDS_AND_FILING.md) | Tax evidence, reporting, retention, and filing responsibilities |
| [Legal compliance runbook](LEGAL_COMPLIANCE_RUNBOOK.md) | Consent, privacy/support procedures, legal review, and launch sign-offs |

### Architectural decisions

- [0001: Checkout payment authority](adr/0001-checkout-payment-authority.md)
- [0002: Stripe Tax and Medusa authority](adr/0002-stripe-tax-medusa-authority.md)
- [0003: Catalog authoring authority](adr/0003-catalog-authoring-authority.md)
- [0004: Catalog links and write lifecycle](adr/0004-catalog-links-and-write-lifecycle.md)
- [0005: Managed media and Discography rebuild](adr/0005-managed-media-and-discography-rebuild.md)
- [0006: Native Admin RBAC](adr/0006-native-admin-rbac.md)
- [0007: Audited tax collection mode](adr/0007-audited-tax-collection-mode.md)

Backend extension READMEs live under `backend/src/{admin,api,jobs,modules,scripts,
subscribers,workflows}/`; the email provider has its own
`backend/src/modules/email-notifications/README.md`. Check actual application
contracts before applying generic framework examples from those files.

## Verified continuation boundary

**October 9, 23:07 UTC repeated service-timeout boundary:**

Original all-eight TTY run 60637 reaches the unchanged 900-second service
deadline (22:45:47.038–23:00:47.075 UTC). All four Settings modes finish all
57 checkpoints and all five cleanup actions. News desktop-light, desktop-dark
and phone-light each finish twelve checkpoints. News phone-dark retains eight
PNGs and twenty partial artifacts without a final result. Execution has no
numeric result field; seven mode finals, no 162-test aggregate and no later
chained service-family results remain. The full gate is incomplete; complete
News path coverage, native acceptance and release acceptance remain unverified.
No TTY fix, click lookup savings or timeout cause is established by this run.

Actual scoped cleanup `522e7a6a…` checks 1,036 unchanged inputs, separately
frozen Doc4, 554 closed relays and absence of 186 known process identities,
the two owned containers, Compose resources and recorded relay listeners.
The incomplete News phone-dark browser root and proxy-listener identity remain
unknown; unobserved descendants are not inferred absent. Root release join
`7567d738…` rechecks source, Doc4, executable/helper bindings and the original
Node's absence, then releases the freeze at 23:06:48.537 UTC. Root issued no
signals or CUA actions during the run and scoped cleanup.

After release, Root applies only checkpoint phase timing `707e6442…` to the
Settings QA source at 23:07:11.782 UTC. The bounded ledger preserves original
operations, result schema, native authority and 900/240-second limits. Phase
measurement and the private focused diagnostic remain pending; no timings,
performance cause, savings or native acceptance are claimed from this change.

The earlier 390 px phone-light Toast covering the Edit role heading remains
an open layout finding; peer `0eeba5a4…` and the original frame are retained.
The same 49 paths remain uncommitted/unpushed, Batch 6 stays open and the client
clone remains paused. Preserve completed-body readiness, every checkpoint,
Axe scan, screenshot, mutation fence and unchanged 900/240-second limits.

**October 9, 22:24 UTC original service-timeout boundary:**

Original all-eight TTY run 7169 reaches the unchanged 900-second service
deadline (22:01:58.198–22:16:58.227 UTC). All four Settings modes finish all
57 checkpoints; News desktop-light, desktop-dark and phone-light each finish
all twelve. News phone-dark retains eight PNGs without a final result. Seven
mode finals are verified; the 162-test aggregate and later chained service
families are absent. This is a timed-out full gate, not accepted verification
or proof that TTY fixes the earlier SIGTERM interruptions.

Actual scoped cleanup `c58ce74a…` verifies 1,036 unchanged inputs, separately
frozen Doc4, 556 closed relays and absence of 181 known process identities,
the two owned containers, Compose resources and recorded relay listeners.
The incomplete News phone-dark browser root and proxy-listener identity remain
unknown; unobserved descendants are not inferred absent. Root release join
`5c2907e1…` rechecks source, Doc4, executable/helper bindings and the original
Node's absence, then releases the freeze at 22:24:34 UTC. Root issued no signals
during this run or cleanup.

The earlier 390 px phone-light Toast covering the Edit role heading remains
an open layout finding; peer `0eeba5a4…` and the original frame are retained.
The same 49 paths remain uncommitted/unpushed, Batch 6 stays open and the client
clone remains paused. Source-only browser-runtime efficiency review is pending.
Preserve native authority, completed-body readiness, every checkpoint, Axe
scan, screenshot, mutation fence and unchanged 900/240-second limits.

**October 9, 21:45 UTC node-only signal boundary:**

Original all-eight run 39766 is interrupted by SIGTERM (exit 143).
Desktop-light, desktop-dark and phone-light Settings each finish all 57
checkpoints and all five cleanup actions. Phone-dark has 41 PNGs and 41 Axe
artifacts without a final result; these remain partial evidence. Five mode
finals and the 162-test aggregate are absent; later service families are unrun.

Node-only trace `9d981888…` records an immediate SI_USER SIGTERM sender of
PID 19536, UID 1000. Current two-stable identity receipt `b7f63cf2…` identifies
that PID as the installed Codex executable; it does not establish its executable
at the signal moment or the ultimate reason for termination. Root issued no
CUA actions or signals during the run. No application cause or fix is proved.

Root later sends one TERM to the exact owned browser root, without group
signals or KILL escalation. Actual cleanup `88c9e023…` verifies 1,036 unchanged
inputs, separately frozen Doc4, 156 closed relays, 107 known process identities,
separate Node/tracer absence, the two owned containers, Compose resources and
recorded relay listeners absent. Unobserved descendants and the incomplete
phone-dark proxy listener are not inferred absent. Release join `15665475…`
also verifies separate executable and tracer-helper bindings, then releases
the source freeze at 21:45:59 UTC after that cleanup.

Phone-light frame `44-native-role-response-loss-committed-projection.png`
shows the native error Toast covering the Edit role heading at 390 px; peer
`0eeba5a4…` retains this layout defect. Name, Description and Cancel/Save remain
visible; no page-overflow claim follows. Correct Toast placement before calling
Batch 6's layout audit complete.

The same 49 paths remain uncommitted/unpushed, Batch 6 stays open and the client
clone remains paused. Tags v3 stays private and unapplied. A documented outer
PTY trial is pending: keep the original all-eight gate, native authority,
body completion, every check and 900/240-second limits, retain private output
files and use explicit null stdin. Native children still inherit those streams
with CI enabled. PTY support is not proof that it fixes the termination.

**October 9, 21:06 UTC Chrome-interruption boundary:**

Chrome comparison 6706 is interrupted by SIGTERM (exit 143). Desktop-light
and desktop-dark Settings each finish all 57 checkpoints with all five cleanup
actions passing. Phone-light has 33 PNGs and 33 Axe artifacts, without a final
result; these are partial evidence, not checkpoint outcomes. Six mode finals
and the 162-test aggregate are absent. Later chained service families are unrun.
The original signal's cause is unknown; this comparison is not accepted.

Root later sends one TERM to the exact owned browser root, without group
signals or KILL escalation. Actual independent cleanup `564917c0…` verifies
1,036 unchanged inputs, separately frozen Doc4, 148 closed relays, 41 known
process identities, the two owned containers, Compose resources and relay
listeners absent. Release join `f661432f…` retains the scoped limitations:
unobserved descendants and the incomplete phone-light proxy listener are not
inferred absent. Source peer `eba5bb02…` is postdated to Root's cleanup execution.

Auth-free local control 4722 passes six fresh-profile sequences with body
completion and intact observation. No reload is observed in its bounded windows;
Helium's known component reports the DNS/blocking capability conjunction, while
Chrome's missing target remains unknown. This is diagnostic nonreproduction,
not native acceptance or proof of the earlier reload's cause or a fix. Earlier
Helium retry 26102 remains 161/162, including its phone-light startup failure.

The same 49 paths remain uncommitted/unpushed, Batch 6 stays open and the client
clone remains paused. Tags v3 stays private and unapplied. Investigate the long
signal/interruption diagnostics, then require the original all-eight full gate;
native authority, body completion, every check and 900/240-second limits remain.

**October 9, 20:31 UTC full-retry boundary:**

Original all-eight retry 26102 closes naturally with 161/162 tests passing.
All 154 ordinary native cases pass. Desktop-light, desktop-dark and phone-dark
Settings pass all 57 checkpoints each; all four News modes pass twelve each.
Phone-light Settings fails initial navigation before credentials or checkpoints,
retaining its native-session 401 cleanup failure. Later chained service families
are unrun; the full gate remains unaccepted.

Independent cleanup `30e553f5…` verifies 1,036 unchanged inputs, 552 closed
relays, all eight naturally closed browser roots and recorded owned resources
absent. Join `e9432e5b…` verifies the three finite snapshots' 77-process union
and original runner absent. Unobserved or short-lived descendants are not
inferred; source freeze was released only after actual scoped cleanup.

Trace `835e85…` positively records a same-URL reload about 1.10 seconds after
initial navigation starts and 0.77 seconds after its native load returns.
The old-document Store GET has an acknowledged continuation but no observed
body terminal. No renderer navigation request or later Page command is observed
within the bounded capture; the initial Page command predates observation.
The reload's cause remains unknown. An auth-free owned-local browser comparison
is being prepared; it is diagnostic only and changes no native gate.

The same 49 paths remain uncommitted/unpushed, Batch 6 remains open and the
client clone stays paused. Tags v3 remains private and unapplied, with runtime
validation pending. Preserve native authority, body completion, every check
and unchanged 900/240-second limits.

**October 9, 20:11 UTC interrupted full-run boundary:**

Original full run 48348 is interrupted by SIGTERM (exit 143), with no final
162-test summary or browser-mode results. Its 56 desktop-light screenshots and
56 Axe artifacts remain partial evidence; no checkpoint outcome or natural
browser closure is inferred. The original signal's cause is unknown.

Root later sends one TERM to the exact owned browser root, without group
signals or KILL escalation. Independent cleanup `67878675…` verifies 1,036
unchanged inputs, 133 closed relays, 46 observed process identities, both owned
containers, Compose resources and recorded relay listeners absent. Missing
proxy-listener identity and unobserved descendants remain explicit limits.

An unchanged original all-eight retry is pending; preserve every check and
900/240-second budgets. The startup cause remains unproved. The private Tags
v3 proposal preserves unknown-key strict rejection while normalizing only
recognized table placeholders; it is unapplied and runtime validation is
pending. The same 49 paths remain uncommitted/unpushed, Batch 6 remains open
and the client clone stays paused.

**October 9, 19:42 UTC desktop-dark diagnostic boundary:**

Diagnostic 40388 passes the original 17 native Settings HTTP cases and all
57 desktop-dark checkpoints; the other three modes are skipped. Independent
cleanup `89da1ee6…` verifies 1,036 unchanged inputs, 134 closed relays and owned
resources absent. Join `6db4d41b…` verifies both finite snapshots' 37-process
union and original root absent; unseen descendants are not inferred.

Both initial captures contain one document and completed bodies, with no
readiness deadline or additional observed Page navigation command. The initial
Page command predates observation. The intermittent startup failure is not
reproduced and its cause remains unproved. Full run 38190 remains unaccepted
at 161/162; an original all-eight matrix with passive observation is pending.
Preserve native authority, body completion, every checkpoint and accessibility
check, mutation fences and unchanged 900/240-second limits.

A read-only Product Types comparison renders an editable empty Value filter
without the Product Tags 400. Back restores the URL but leaves the chip;
explicit Clear all removes its chip and input. No Save or CRUD occurred.
The private Tags loader proposal is unapplied. The 49-path release remains
uncommitted/unpushed, Batch 6 remains open and the client clone stays paused.

**October 9, 19:23 UTC full result and cleanup boundary:**

Original full normal run 38190 closes naturally with 161/162 tests passing.
All 154 ordinary native cases pass, including the unchanged shared-asset
creation-compensation regression. Desktop-light, phone-light and phone-dark
Settings pass all 57 checkpoints each; all four News modes pass twelve each.
Desktop-dark Settings fails the initial 30-second wait before credentials or
checkpoints, retaining its native-session 401 cleanup failure. Later chained
service families are unrun; the full gate is not accepted.

Independent cleanup `c229decb…` verifies 1,036 unchanged inputs, 551 closed
relays, all eight naturally closed browser roots and recorded owned resources
absent. Join `2f3b02b1…` verifies the five finite snapshots' 100-process union
and original root absent. Unobserved, short-lived or reparented descendants
are not inferred; source freeze was released only after actual cleanup.

Current local checks pass: 79 navigation/transport boundaries, 23 media units,
220 emitted regressions, shared QA and Backend coverage (317 suites/3,115 tests).
Both Admin builds bind 893 current inputs and 336 outputs each; six compiled
checks per build pass. The SQL correction permits at most three fresh attempts
for exact early `40001`/`40P01` conflicts. It flushes the pending audit insert
before media writes; once that flush succeeds, later errors are never retried.
Media writes, compensation and commit errors are not retried. The real
compensation regression now passes without alteration.

The failed desktop-dark trace records two same-URL documents on one client and
frame, then an old-loader Store GET without a recorded body terminal. The
second-document cause remains unknown. Continue with source-backed observation
before any correction; preserve body completion, native authority, every
checkpoint and accessibility check, mutation fences and 900/240-second limits.

A read-only live review of accepted staging `15f7217` reports all nine services
healthy, but Product Tags Filter → Value renders a 400 after creating the empty
`ptag_value=%22%22` filter. Source localization `17d75ab7…` suggests the route
loader forwards that UI-prefixed key to the strict native API. This remains an
inference without the live API request journal; no Save or data write occurred.
The 49-path release plan remains uncommitted/unpushed, native and release
acceptance remain open, Batch 6 remains open and the client clone stays paused.

**October 9, 18:56 UTC SQL and navigation boundary:**

Full normal run 3771 fails with 158/162 passing: 153/154 ordinary native
cases, phone-light Settings (all 57 checkpoints), and all four News modes
(twelve each) pass. The shared-asset creation-compensation test fails on a
PostgreSQL serialization conflict inserting its pending audit operation.
The other three Settings modes fail initial navigation before checkpoints;
their native-session 401 cleanup failures remain recorded. Later chained
service families are unrun. Preserve the original exact three-update assertion.

Independent cleanup `49a45a17…` verifies 1,036 unchanged inputs, 541 closed
relays, all eight naturally closed browser roots and recorded owned resources
absent. Join `cd4a814b…` verifies the finite 42-process union and original root
absent; unobserved descendants are not inferred.

Diagnostic 49244 passes the original 17 native Settings HTTP cases and one
desktop-light sequence (57 checkpoints). Cleanup `babca469…` and finite
34-process/root absence join `03431037…` pass. Both initial captures contain
one document, completed bodies and no readiness deadline; the failed full run's
second-document/pending Store request is not reproduced. Its cause remains
unproved. This diagnostic does not replace the original full matrix.

The SQL correction was applied at 18:54 UTC. It flushes the pending audit
insert before media writes and allows at most three fresh transaction attempts
for exact early `40001`/`40P01` conflicts. It never retries media writes,
compensation or commit errors. Against the old implementation, the ten new
regressions produced seven failures and three passes, with 13 original cases
skipped. The current implementation passed all 23 cases, and shared QA passed.
Backend coverage, refreshed Admin builds and the unchanged full gate remain
pending. This is bounded preflight recovery, not complete serialization
resilience. Preserve native
authority, body completion, mutation fences, accessibility and 900/240-second
limits. The 49-path release plan remains uncommitted/unpushed; staging stays
`15f7217`, Batch 6 remains open and the client clone stays paused. Native and
release acceptance remain open.

**October 9, 18:12 UTC remaining initial navigation boundary:**

All 79 navigation/transport boundary tests and shared QA pass. The original
desktop-light run 5208 passes all 57 Settings checkpoints; independent cleanup
`2514a8e9…` and the finite 36-process join `09ca3e8b…` pass.

Full normal run 84938 fails with 160/162 passing: all 154 ordinary
native cases, desktop-light and phone-dark Settings (57 checkpoints each), and
all four News modes (twelve each) pass. Desktop-dark and phone-light Settings
fail initial Store navigation before credentials or checkpoints, retaining a
pending Store GET and native 401 reads. Their unauthorized native-session
cleanup failures remain recorded. Later chained service families are unrun.

Independent cleanup `67fba8cb…` verifies 1,036 unchanged inputs, 544 closed
relays, all eight naturally closed browser roots and recorded owned resources
absent. Join `de55011a…` verifies the finite 38-process snapshot and owned root
absent; unobserved descendants are not inferred. Next, diagnose one original
desktop-dark case with passive network observation before correcting the proven
cause and rerunning the complete gate. Preserve body completion, native
authority, mutation fences, accessibility checks and 900/240-second limits.
Source is uncommitted/unpushed; staging remains `15f7217`, Batch 6 stays open and
the client clone stays paused. Full native and release acceptance remain open.

**October 9, 17:13 UTC authenticated navigation boundary:**

The public CDP Network correction counts actual request bodies instead of
Fetch-only duplicate interceptions. All 75 boundary tests and shared QA pass;
a true same-origin child stream also finishes before 500 milliseconds of quiet
on both repeated navigations. These controlled checks do not prove native
Settings acceptance. Original full run 41626 still finishes with 158/162 passing:
154 ordinary tests and all four News modes pass, with twelve checkpoints each.
All four Settings modes time out after sign-in before their first checkpoint.

Independent cleanup `fdeeccef…` verifies 1,036 unchanged inputs, 550 closed
relays, all eight naturally closed browser roots and recorded owned resources
absent. The finite snapshot join `22970434…` verifies all 38 recorded process
identities absent; unobserved descendants are not inferred. Later chained
families remain unrun. A bounded, hashed navigation-state observer is applied
without changing load, body, quiet, deadline, authentication or mutation gates.
Next, use one original authenticated Settings mode for diagnosis, correct the
proven cause, then rerun the unchanged complete matrix and release checks.
Source is uncommitted/unpushed; staging remains `15f7217`, Batch 6 stays open
and the client clone stays paused. Preserve the failed runs and diagnostics.

**October 9, 16:24 UTC navigation boundary:** original full run 13703 closes
naturally with 158/162 passing tests: all 154 ordinary cases and four News
modes pass. Four Settings modes fail after native sign-in at the first Store
navigation wait, before any checkpoint; later families are unrun. Cleanup
`5821ae58…` verifies 1,036 unchanged inputs, 549 closed relays, all eight browser
roots and recorded owned resources absent; a separate finite join verifies
all 28 recorded process identities absent. All 201 installed files, 220 emitted
regressions, shared QA, both Admin builds/six compiled checks and Storefront
build/thirteen browser checks pass. Synthetic navigation tests do not establish
the authenticated cause or native acceptance. Follow the opening handoff for
the bounded diagnostic and unchanged complete gate. Source is uncommitted and
unpushed, staging remains `15f7217`, Batch 6 is open and clone remains paused.

**October 9 current contrast and fixture checks:** all 201 reviewed package
files, 214 emitted regressions, shared QA, both fresh Admin builds and five
compiled checks per build pass. The current-lock Storefront build and thirteen
browser checks pass. Three joined workers create only twenty-one independent
no-grant fixture accounts; serial Region/Tax writes, native authority and
readbacks remain intact. Thirty static PNG captures verify identical pixels
and faster encoding; all checkpoints, fences and 900/240-second limits remain.
Full 28070 times out after four Settings modes and one News mode; the actual
“Clear all” contrast defect is now corrected. Cleanup `218e387d…` verifies the
recorded resources absent, retaining the interrupted News process-journal
limitation. The corrected original full gate and exact release remain pending;
source is uncommitted/unpushed, staging stays `15f7217` and clone stays paused.

**October 9 compiled integration boundary:** full normal 18580 passes 159/162;
independent cleanup passes. Shared FormProvider mutation and stylesheet order
defeat the direct label/color corrections, and an open date-filter popover
needs its native name. Follow the opening handoff for the cohesive correction,
compiled regressions and complete normal/release gates. Clone remains paused.

**October 9 remaining controls:** the focused run verifies the original
native error/recovery fixes, then exposes date-filter semantics, sorting-menu
scope and protected content mounting during permission loading. Cleanup passes.
Follow the opening handoff for the current 198-case/source/build checks and next
correction; full native and release acceptance remain open, clone paused.

**October 9 Settings boundary:** 43 focused checkpoints pass before native
Role Edit naming, event-error and response-loss failures. Independent cleanup
passes. The same-version native corrections and exact committed-response-loss
boundary test are applied, with current builds and full native acceptance still
pending. Follow the opening handoff; staging is `15f7217`, client clone paused.

**October 9 focused continuation:** phone-light News passes twelve checkpoints
and native USD restoration passes. Region Create's exact uppercase request
expectation is corrected. A subsequent Settings-only run exposes a no-op role
permission removal; source confirms its incomplete first-page assignable scope.
Independent cleanup passes. The page-scope fix preserves unseen assignments
and passes 150 installed regressions, fresh coverage, builds and shared checks.
Follow the opening handoff for compiled native and complete normal/release
gates. Staging remains `15f7217`, with the client clone paused.

**October 9 local correction:** installed component verification passes 134
cases and current builds/shared checks pass. The latest normal run passes 154
ordinary native cases and both desktop News modes; Settings's currency setup
and both phone News heading checks remain open. Independent cleanup passes.
Follow the opening handoff for the applied QA prerequisite and focused
diagnosis; staging remains accepted at `15f7217` and the client clone is paused.

**October 8 deployed correction and audit continuation:** exact staging
`15f7217` passes four original workflows / 23 checks, exact app/Migrations
and runtime/heartbeat/log/search gates. Three owned Gallery saves and same-UUID
checks complete; Root accepts the scoped deployed correction after verifying
all 44 evidence bindings. Original expired collection/classifier failures remain retained
with separate narrow reconciliation. All-nine observation continues with its
explicit replacement gap. Actual native News creation exposes a pre-flush
undefined-timestamp bug; its transaction fix passes all six initialized HTTP
cases. The expanded native run passes 151/154; three actual Settings failures
require correction before the full service/browser gates. Owned repair has one
independently verified completion and saved-state refresh, with retained
assets/history. Country flags,
a media translation and duplicated News titles are also corrected locally.
The single new Mystery purchase is order #12, captured and fully refunded for
$32 through native cancellation. Provider/native inventory, tax, webhooks and
delivered-notification evidence agree; actual receipt expiry/retry passes. Never
repeat it. The latest run retains 153/154 native passes and eight compiled UI
failures while their fixes and owned catalog visibility cleanup continue.
Read the opening handoff for unfinished browser/payment/cleanup and exact evidence.
Batch 6 stays open, client cloning paused, production untouched.


**October 8 image compiler correction:** `e5cecff` clears the prior RBAC runner
and secret-scan corrections, but its disposable image scan rejects thirteen
UNKNOWN Go standard-library findings before native tests run. The same gosu
source is rebuilt with reviewed, checksum-pinned Go 1.27.2 and passes its fresh
strict scan and 112 boundary tests; all image severity gates remain intact.
All four original CI workflows are terminal with 22 passes and one failure.
The normal full services pass all 233 tests with 663 unchanged source hashes
and 344 closed relay connections; independent owned-resource cleanup passes.
Read the opening handoff for new exact release acceptance. Old accepted apps remain running;
owned UI writes and client cloning have not started.

**October 8 native RBAC fixture correction:** `6c3713c` clears the historical
secret findings; its four workflows finish with 22 required passes and one
disposable-integration failure. Ten new HTTP cases reject missing native RBAC
before assertions. The normal runner now pins RBAC on; 29 boundary/loader tests
pass, fresh image scans pass and all 233 normal service tests pass with inherited
RBAC disabled. Source hashes stay unchanged; 345 relay clients close. The normal
boundary coverage gate passes 111 tests; independent owned-fixture cleanup passes.
Previous `b6e494f` services stay running. Read the opening handoff for the final
normal service, corrective push and new exact CI/deployment/live gates; earlier
entries below are history. Client cloning remains paused.

**October 8 evening CI repair:** the grouped push reached `5aba8a5`; Root,
Backend and Storefront fail on seven synthetic request-UUID findings in Git
history, while Runtime Images passes. The previous `b6e494f` instances continue
running; no corrective release is accepted. Active fixture normalization and
seven exact historical fingerprints pass a local pinned full-history scan and
154 affected tests. Read the current opening handoff before the correction push
and new exact CI/Railway/live acceptance. The entries below retain older
pre-push evidence; client cloning remains paused.

**October 8 evening reentry:** remote staging stays `b6e494f`; the seven saved
local commits are preserved and the managed Gallery / native Variant parent
corrections are added. Fresh strict scans, ten real initialized HTTP cases,
233 full normal disposable tests, shared QA, both builds and 313 Backend
coverage suites / 2,959 tests pass. Eighteen compiled Gallery cases have
24 inspected clear Axe frames with verified focus/cursors/contained artwork.
Original failures and verified disposable cleanup are retained. All-nine
monitoring runs with its explicit pause gap and zero fault samples. The grouped
push, exact CI/deployments/live acceptance and owned repair/re-saves remain
required; no new release, client clone or production action is claimed. Use
the opening handoff/audit for current evidence. The continuation below retains
the earlier scanner failure as history.

**Current October 8 continuation:** Store Batch 6 continues at `b6e494f`.
All four exact workflows / 23 checks, exact app/Migrations deployments,
runtime/role proof, ordinary health and correlated application logs pass.
All 13 deployed card/404 cases and 23 inspected frames pass. Complete
native/index/public format membership matches all 464 IDs, but facet counts
and quantity-bundle definitions fail; the current corrective batch fixes those
alongside native Admin control names, phone targets, filter focus and landmarks.
Local Conventional Commit `ffd6891` passes full catalog count/API fixture,
coverage and production-build checks. Its two strict mobile contrast incompletes
are retained with exact manual review. Additional native Settings findings
remain. The exact missing-cart recovery correction in `32ebe2b` also passes full Storefront
coverage, the normal production build and all 12 compiled browser cases while
preserving uncertain payment recovery. Signed-in read-only navigation reaches
all 19 Settings pages; distinct workflows remain open. The native 67-case
predecessor passes after scoped dark-text and independently evidenced harness
corrections. The expanded 69-case matrix adds Product Type dialog registration,
button Enter validation and Cancel/Escape return; 142 component checks and the
normal build pass. One exact phone Description contrast incomplete remains a
raw failure with separate manual paint proof; the completed 69-case matrix has
68 strict passes and that one retained raw failure. All seven complete actual-index
sort orders are reconciled against primary source; three finite native creation
dates still have null indexed projections. The scoped Date converter correction
passes 34 focused tests, 303 Backend suites / 2,713 tests and the compiled build.
Catalog heading/toolbar corrections pass five browser cases with unchanged card
geometry. Live correction acceptance and distinct owned workflows remain open.
The approved scanner
DB's upstream publication failure blocks fresh
integration and release acceptance; keep its normal freshness gates intact.
Saved native Admin sign-in is restored. Same-version vendor patches and full
expanded compiled-page evidence is complete, with RBAC/modal semantics preserved.
All-nine observation retains its intentional gap; Redis retains its October 3
run identity while diagnostic child warnings are reconciled against exact PIDs.
RecoveryBackups has authenticated current completion/manifest proof, not a
repeated full restore/PITR acceptance. Existing thumbnail drift, owned orphan
repair, media/search controls, the live clipboard bridge and mystery payment
remain open. Compiled native clipboard bytes are verified separately.
The failed-creation repair is moving to a narrow initialized native Admin API
and session UI; exact actor/manifest/replay checks and the source-derived
66-method authorization inventory pass focused local checks. Full exec startup
can write before a preview and is held. The replacement's 14 compiled GET-only
UI cases and 16 main-scoped Axe scans now pass, with 72 focused UI tests and
final 309-suite / 2,840-test Backend coverage. Its fresh disposable HTTP gate
and exact deployed acceptance remain pending; use the
updated support guide and opening handoff before any owned repair.
Never repeat completed orders #8/#9/#10/#11. AST control candidates do not
establish executed passes. Client cloning stays paused and production is
untouched. The opening handoff/audit retain exact receipts and unresolved gates.

The following continuation description predates that current correction.

Latest fully accepted hardening batch is Batch 5 at
`960fe7bbc47b912770c8357c148f5bd6cb75b3f8`. Batch 6's exhaustive audit stays
open and resumed at the user's request on October 7. The earlier 00:11 UTC
pause is historical; the client clone remains separately paused. Exact `86c325a3a40679feff1a027a9a8cc1e089bef897` runs on both
applications with all four workflows / 23 checks passing; Migrations and
RecoveryBackups also succeed. Basic/readiness and backup gates pass. Owned
order #9's payment is fully refunded and its inventory is restored; native
shipping accounting still retains its original charge. RMA notifications and
complete native claim/return stock guidance are local, uncommitted corrections
with full Backend coverage, native contracts, real RMA/inventory integration
and email rendering passing. All 40 final Admin cases and both production
builds pass; exact CI/deployed acceptance remains. Follow the opening handoff before running or committing
them. The all-nine watcher is renewed; its deliberate overnight observation gap
is recorded. Redis remains on the same healthy process. Preserve failed `1b09546`, observer gaps and the removed Backend
instance for investigation. Paid families, owned media, guarded search rebuild,
prepared-notice/bundle-stock live retests and the executed-control ledger remain
open. Keep the scheduler incident latch intact through its documented window
and fresh normal observation. The Admin tab is authenticated and open.
Public pages and unpaid carts do not prove paid-family acceptance. Pause before
Batch 7's client clone; do not create it.
Production approval remains separately in Batch 8. Earlier recovery/support
limits remain in the carryover register. The snapshots below are historical.

At the 07:54 UTC acceptance, the application pair was Backend `33de0ec` and
Storefront `7e743bf`; the exact CI runs, deployments, health probes, scheduler
heartbeat, and cold database timings are in
[NEXT_SESSION_HANDOFF.md](NEXT_SESSION_HANDOFF.md).
The following `48b3376` evidence is a historical acceptance snapshot, not the
current deployed revision.

Both Railway applications ran accepted revision
`48b33765bb98637d61acc36d1addba708b0d7f84`. Root, Backend, Storefront,
and Runtime Images CI passed on that exact SHA (runs `35481443600`,
`35481443610`, `35481443578`, `35481443603`); Backend deployment
`376092ee-7b0a-486c-820c-f8b4de6eec62` and Storefront deployment
`eff51f25-082d-4969-8715-22578db2d6f0` reached `SUCCESS`. Both health
pairs, Backend operations/scheduler/retention, an ordinary same-SHA scheduler
heartbeat, and Storefront root/catalog passed. Deployed responsive browsers
passed 75 cases with eight expected skips; Firefox/WebKit were not rerun for
this release. Bounded exact-deployment HTTP 5xx queries found zero through
`2026-09-20T01:50:23Z`; the handoff records the existing Storefront error
families and exact image identities. The prior accepted revision was
`e7a37c2180f890e0562495a5897b3cef7decc5c2`. GitHub repository access
and pinned Railway CLI access were verified. Railway project `store` has one
environment, `staging`, containing Backend, Storefront, Postgres, Redis, Bucket (MinIO),
Console, and MeiliSearch. All seven active deployments report `SUCCESS`.

Both applications' liveness/readiness returned 200 with the new revision.
Backend scheduler, retention, operations, and dependency checks passed. The
prior accepted release's authenticated bounded catalog reads verified 461
Products, 442 Discography records, three shelves, and 25 shelf memberships;
only aggregate counts were retained. Four data volumes were ready with no
pending deletion at that check. These checks establish
bounded live access and health, not a backup/restore or complete data audit.

The earlier dependency findings and PCRE2 fixes passed their exact-revision
Root, Backend, Storefront and Runtime Images workflows. Live package identity,
corrected deployed browser and concurrent-trace acceptance also passed; the
handoff retains all original failures, corrections and bounded-log limitations.
The deployed PostgreSQL auditor now evaluates on the actual 16.11 source and
correctly rejects the existing administrator identity.

At the start of the September 19 session, local `staging` HEAD was
`33d2823ab03ef044aa017ba78878017395ab13d6`, one commit ahead of
`origin/staging` and unpushed. The recovery notes record a scanned PostgreSQL
16.15 target and a real, bounded 16.11 export. Its private `/tmp` archive is
unavailable in this session. A new `data:postgres:restore-receipt` command and
receipt-required restore verification passed 45 focused tests and 12 real
same-major PostgreSQL 16.15 roundtrip cases locally. The earlier export cannot
gain a receipt retroactively; the later isolated staging-data restore required
a fresh source-bound archive and receipt. The legacy two-command path requires
quiescent source writes; the accepted shared-snapshot path permits DML to
continue while schema DDL is paused.
At that point Redis multipart-AOF capture, verification, replay, and queue
reconciliation were pending. The later approved September 20 drill completed
the bounded staging capture, offline checker, and isolated startup/restart;
queue and business reconciliation remain open.

The subsequent September 20 UTC local staging-data PostgreSQL drill captured
a source-scope-bound shared-snapshot archive and restored all 171 physical
tables with matching row/schema counts to a distinct, isolated 16.15 target.
Owned target cleanup passed. The later local Redis AOF capture/replay passed;
the PostgreSQL result does not establish PITR, off-site backup, application
startup against the target, or production RTO.

Production remains absent. Redis's configured/running image mismatch and
documented live-version risk remain open. PostgreSQL retains a public TCP
proxy, and the MinIO Bucket retains a public domain; the approved Console and
MeiliSearch staging-domain removals left their scoped domain lists empty.
Actual Redis RDB export/isolated loading, bounded staging multipart-AOF capture
and worker-free replay, and the staging-data PostgreSQL logical restore pass.
Queue/business reconciliation, role cutover, support-image migration,
PostgreSQL proxy review, backup schedules, registry publication/source
cutover, and production provisioning remain open.
The user's autonomous-work authorization supersedes historical permission-only
holds; missing operational, licensing and business facts still require evidence.

## Work and push cadence

Build substantially larger, cohesive batches: combine compatible dependency
remediation, their real boundary regressions, policy checks, and documentation
before one staging push. Keep logical Conventional Commits within that batch.
Avoid separate documentation-only checkpoint pushes.

Run the current QA, coverage, security, integration, build, and applicable
browser gates from the runbooks. After pushing, observe Railway's exact-revision
`WAITING` hold, all required GitHub checks, the expected application deployments,
and live health/catalog/scheduler/log acceptance before accepting the release.
Watch paths determine which applications rebuild; an unchanged application
may correctly retain its previously accepted revision. The user authorized continued engineering and staging release work without
further permission prompts. Missing production, legal and provider facts still
require evidence; do not invent them or mark them complete.
