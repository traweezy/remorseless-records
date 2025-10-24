# Remorseless Records Monorepo

Brutal maximalist commerce experience for extreme music: MedusaJS v2 backend, Next.js 16 (React 19) storefront, Stripe Checkout, Meilisearch discovery, and Resend emails — all wired for Railway deployments and polished local DX.

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Repository Setup](#repository-setup)
- [Environment Variables](#environment-variables)
- [Running the Backend Locally](#running-the-backend-locally)
- [Running the Storefront Locally](#running-the-storefront-locally)
- [Using Railway/Staging Environment Variables Locally](#using-railwaystaging-environment-variables-locally)
- [Stripe Checkout & Webhooks](#stripe-checkout--webhooks)
- [Search (Meilisearch)](#search-meilisearch)
- [Email (Resend)](#email-resend)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
/
├── backend/      # MedusaJS 2.x server (Stripe checkout, webhooks, Meilisearch, emails)
├── storefront/   # Next.js 16 / React 19 App Router storefront
├── node_modules/ # monorepo root dependencies (pnpm workspace)
├── pnpm-workspace.yaml
└── README.md
```

- **Backend**: Medusa core services plus Stripe Checkout session endpoint, webhook handler, Resend-powered notifications, Meilisearch sync helpers.
- **Storefront**: Next 16 App Router with React Compiler enabled, brutal UI spec, Stripe Checkout redirect, Meilisearch-powered search, variant selectors, optimistic cart updates.
- **Package management**: `pnpm` via Corepack. Node 22.11.0 enforced through `.nvmrc`.

## Prerequisites

| Tool        | Version / Notes                                              |
|-------------|--------------------------------------------------------------|
| Node.js     | 22.11.0 (via `.nvmrc`)                                       |
| pnpm        | 10.19.x (Corepack-managed)                                   |
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
   corepack enable pnpm
   pnpm --version       # should report 10.19.x
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

| Variable                 | Notes                                                                                  |
|--------------------------|----------------------------------------------------------------------------------------|
| `DATABASE_URL`           | PostgreSQL connection string                                                           |
| `REDIS_URL`              | Optional. When omitted, Medusa uses in-memory cache                                    |
| `STRIPE_API_KEY`         | Stripe secret key (*sk\_...*)                                                           |
| `STRIPE_WEBHOOK_SECRET`  | From Stripe CLI or dashboard endpoint for `/api/webhooks/stripe`                       |
| `BACKEND_PUBLIC_URL`     | External URL used in webhooks (e.g., `http://localhost:9000`)                          |
| `RESEND_API_KEY`         | Optional; required for transactional mail                                              |
| `MEILISEARCH_HOST`       | e.g., `https://xxx.meilisearch.io` or `http://localhost:7700`                          |
| `MEILISEARCH_ADMIN_KEY`  | Corresponding admin/master key                                                         |
| `JWT_SECRET`, `COOKIE_SECRET` | Medusa auth secrets (high entropy)                                               |
| `MINIO_*`                | Optional. Railway template populates these for object storage                          |

### Storefront (`storefront/.env.local`)

```bash
cd storefront
cp .env.local.template .env.local
```

Required values:

| Variable                              | Description                                                                      |
|---------------------------------------|----------------------------------------------------------------------------------|
| `NEXT_PUBLIC_MEDUSA_URL`             | Public Medusa Base URL (e.g., `http://localhost:9000`)                           |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Publishable API key created in Medusa (Admin > Settings > API Keys)              |
| `NEXT_PUBLIC_STRIPE_PK`              | Stripe publishable key (*pk\_...*)                                               |
| `NEXT_PUBLIC_MEILI_HOST`             | Meilisearch host (match backend)                                                 |
| `NEXT_PUBLIC_MEILI_SEARCH_KEY`       | Meili search-only key (never commit admin keys)                                  |
| `NEXT_PUBLIC_MEDIA_URL` / `NEXT_PUBLIC_ASSET_HOST` | Optional CDN overrides                                     |
| `MEDUSA_BACKEND_URL`                 | (server-only) override when the backend runs on a different domain               |

### Example local `.env`

```dotenv
# backend/.env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/remorseless
JWT_SECRET=change-me
COOKIE_SECRET=also-change-me
BACKEND_PUBLIC_URL=http://localhost:9000
STRIPE_API_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
MEILISEARCH_HOST=http://127.0.0.1:7700
MEILISEARCH_ADMIN_KEY=masterKey
RESEND_API_KEY=re_a1b2c3...
```

```dotenv
# storefront/.env.local
NEXT_PUBLIC_MEDUSA_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_medusa_public_client
NEXT_PUBLIC_STRIPE_PK=pk_test_...
NEXT_PUBLIC_MEILI_HOST=http://127.0.0.1:7700
NEXT_PUBLIC_MEILI_SEARCH_KEY=searchKey
MEDUSA_BACKEND_URL=http://localhost:9000
```

## Running the Backend Locally

1. **Install dependencies** (already satisfied by root `pnpm install`).
2. **Ensure DB is running** (local Postgres or tunnel to Railway).
3. **Migrate & seed (first run or schema change)**
   ```bash
   cd backend
   pnpm ib                 # runs migrations + seeds required system data
   ```
4. **Start Medusa**
   ```bash
   pnpm dev                # listens on http://localhost:9000
   ```

   - Healthcheck: `GET http://localhost:9000/api/health`
   - Stripe webhook endpoint: `POST http://localhost:9000/api/webhooks/stripe`
   - Stripe checkout session endpoint: `POST http://localhost:9000/store/checkout/stripe-session`

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

## Stripe Checkout & Webhooks

### Session Creation

- Storefront server action `start-stripe-checkout` posts to backend `/store/checkout/stripe-session`.
- Backend verifies cart contents and creates Stripe Checkout Session with `automatic_tax` enabled.
- Cart metadata stores Stripe session ID for reconciliation.

### Webhook Handling

- Endpoint: `POST /api/webhooks/stripe`
- Validates signature (requires `STRIPE_WEBHOOK_SECRET`).
- On `checkout.session.completed` with status `paid`, Medusa `completeCartWorkflow` finalizes the order, updates metadata to prevent duplicate processing, and stores Stripe IDs.

### Local testing

```bash
stripe login
stripe listen --forward-to localhost:9000/api/webhooks/stripe
```

Ensure `STRIPE_WEBHOOK_SECRET` matches the value printed by Stripe CLI.

## Search (Meilisearch)

- Storefront uses Meilisearch with TanStack Pacer debounced client for instant filtering.
- Backend configuration expects the products index to be populated (via Medusa events or manual sync).
- Local Meilisearch:
  ```bash
  docker run -it --rm \
    -p 7700:7700 \
    -e MEILI_MASTER_KEY=masterKey \
    getmeili/meilisearch:v1.12
  ```
- **Bootstrap the index** (re-run whenever products change in bulk):
  ```bash
  pnpm --filter backend run search:rebuild
  ```
- Seed the index (example):
  ```bash
  curl \
    -X POST http://127.0.0.1:7700/indexes/products/documents \
    -H 'Authorization: Bearer masterKey' \
    -H 'Content-Type: application/json' \
  -d '[{ "id": "prod_123", "title": "Demo", "handle": "demo", "price": 2500, "genres": ["doom"], "format": "vinyl" }]'
  ```

## Email (Resend)

- Backend includes Resend notification templates (`backend/src/modules/email-notifications`).
- Set `RESEND_API_KEY` and optionally `RESEND_FROM_EMAIL`.
- Emails dispatch on order placement (via subscribers). To disable temporarily, omit the API key; Medusa will no-op.

## Troubleshooting

| Symptom | Resolution |
|---------|------------|
| `pnpm run typecheck` fails with engine warning | Ensure `nvm use` applied (Node 22). Warning occurs on newer runtimes; stick to Node 22 for dev/build parity. |
| Storefront shows empty cart despite items | Cart cookies scoped to domain. When using Railway URLs, ensure `NEXT_PUBLIC_MEDUSA_URL` points to same origin or configure CORS. |
| Search results empty | Confirm Meilisearch index name (`products`), API keys, and that documents exist. Backend fallback logs to console when Meili query fails. |
| Webhook signature errors | Verify CLI tunnel URL matches `BACKEND_PUBLIC_URL` or override Stripe webhook endpoint with the CLI-provided forwarding URL. |
| React Compiler warnings | `next.config.ts` already enables `reactCompiler`. Ensure lint errors are fixed; the compiler is strict about invalid hooks usage. |

---

## QA & Accessibility Checklist

Full runbook with detailed steps lives in [`docs/QA_RUNBOOK.md`](docs/QA_RUNBOOK.md). Quick reminders:

- `pnpm exec eslint --ext .ts,.tsx src` and `pnpm run typecheck` (storefront) / `pnpm --filter backend exec tsc --noEmit` before commits.
- Monorepo check shortcut: `pnpm run qa:lint` (lint + typecheck for storefront and backend).
- Reindex search after catalog bulk changes: `pnpm --filter backend run search:rebuild` (use `pnpm --filter backend run search:check` to compare Medusa vs. Meilisearch counts).
- Keyboard and screen-reader sweeps on header, Quick Shop, PDP, cart. Document in runbook checklist.
- Lighthouse (desktop + mobile) on `/`, `/products`, `/products/[handle]`, `/cart` targeting LCP < 2.5s and A11y ≥ 95.
- Stripe standard + 3DS test cards, confirm webhook metadata and Medusa order creation.
- Automated bundle: `QA_BASE_URL=<deployed url> pnpm run qa:ci` (runs lint/typecheck, pa11y axe audits, and Lighthouse assertions). Optional overrides: `QA_PRODUCT_PATH=/products/{handle}`, `QA_EXTRA_URLS=/custom`.

### Support

- Medusa docs: https://docs.medusajs.com/
- Stripe docs: https://stripe.com/docs/payments/checkout
- Meilisearch docs: https://www.meilisearch.com/docs
- Railway docs: https://docs.railway.app/

When in doubt, open an issue or drop a note in the project instructions. Stay brutal. \m/
