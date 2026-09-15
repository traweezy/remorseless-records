# Project map and continuation guide

Last indexed: September 14, 2026 (America/New_York). Live access and health
verified September 15, 2026, at approximately 00:16 UTC.

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
| Health, telemetry, request correlation | Both applications' `src/lib/health/` and `src/lib/observability/`; Backend `src/api/health/`; `scripts/observe-*-health.mjs`, `scripts/verify-railway-runtime-log.mjs` |
| Data maintenance and recovery | `backend/src/scripts/`, `backend/src/cli/`, root `scripts/postgres-*.mjs`, `media-backup.mjs`, `redis-capacity-audit.mjs` |
| Unit, service, browser, accessibility, performance QA | Application test/config files; `scripts/*.test.mjs`; `storefront/e2e/`; `storefront/playwright*.ts`; `qa/`; `lighthouse/` |
| Disposable service tests | `scripts/run-disposable-integration.mjs`, `scripts/scan-disposable-integration-images.mjs`, `docker/integration/` |
| Runtime image candidates | `backend/Dockerfile.runtime`, `storefront/Dockerfile.runtime`, `scripts/*runtime-image*.mjs`, `scripts/security/runtime-image-policy.json` |
| CI and scheduled monitoring | `.github/workflows/{root,backend,storefront,runtime-images,staging-scheduler-monitor,staging-operations-monitor}.yml` |
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
| [Production hardening plan](PRODUCTION_HARDENING_PLAN.md) | Completed engineering work, open launch blockers, and approval requirements |
| [Dependency migration audit](DEPENDENCY_MIGRATION_AUDIT_2026-07-23.md) | Package families, cooling, compatibility, exceptions, and migration holds |
| [QA runbook](QA_RUNBOOK.md) | Local gates, browser scenarios, screenshots, and acceptance procedures |
| [Disposable integration](DISPOSABLE_INTEGRATION.md) | Isolated PostgreSQL/Redis fixtures, scanned image identity, and cleanup |
| [Release operations](RELEASE_OPERATIONS.md) | Branch authority, grouped staging releases, CI hold, and rollback |
| [Infrastructure recovery](INFRASTRUCTURE_RECOVERY.md) | Data roles, networking, backups, restores, support images, and production topology |
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

At indexing time, both Railway applications run accepted revision
`531e178e29b376b1e0a6a0968a0d94f0454b8f41`. GitHub repository access and pinned
Railway CLI access were verified. Railway project `store` has one environment,
`staging`, containing Backend, Storefront, Postgres, Redis, Bucket (MinIO),
Console, and MeiliSearch. All seven active deployments report `SUCCESS`.

Both applications' liveness/readiness returned 200 with that revision. Backend
scheduler, retention, operations, and dependency checks passed. Authenticated
bounded catalog reads verified 461 Products, 442 Discography records, three
shelves, and 25 shelf memberships; only aggregate counts were retained. Four
data volumes were ready with no pending deletion. These checks establish
bounded live access and health, not a backup/restore or complete data audit.

Weekly Root, Backend, and Storefront security runs have since failed on new
dependency findings at the accepted revision. The continuation batch must
restore current security gates and complete fresh exact-revision acceptance;
historical green CI does not resolve those findings.

Production remains absent. Redis's configured/running image mismatch and
documented live-version risk remain open. PostgreSQL retains a public TCP
proxy; MinIO, Console, and MeiliSearch retain public domains. Recovery drills,
role cutover, support-image migration, network changes, backup schedules,
registry publication/source cutover, and production provisioning retain their
documented approval boundaries.

## Work and push cadence

Build substantially larger, cohesive batches: combine compatible dependency
remediation, their real boundary regressions, policy checks, and documentation
before one staging push. Keep logical Conventional Commits within that batch.
Avoid separate documentation-only checkpoint pushes.

Run the current QA, coverage, security, integration, build, and applicable
browser gates from the runbooks. After pushing, observe Railway's exact-revision
`WAITING` hold, all required GitHub checks, the expected application deployments,
and live health/catalog/scheduler/log acceptance before starting another batch.
Watch paths determine which applications rebuild; an unchanged application
may correctly retain its previously accepted revision. Larger batches do not
change production, data, credential, cost, or infrastructure approval boundaries.
