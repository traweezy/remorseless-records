# Remorseless Records Storefront

The customer-facing Remorseless Records application. It uses Next.js 16,
React 19, Tailwind CSS 4, the Medusa Store API, and Meilisearch-backed catalog
discovery.

The monorepo-level setup, Railway workflow, and operational notes live in the
[root README](../README.md).

## Prerequisites

- Node.js 26.5.0
- pnpm 11.17.0
- A reachable Medusa backend and a Store API publishable key
- A reachable Meilisearch instance and search-only key

Install workspace dependencies from the repository root:

```sh
pnpm install --frozen-lockfile
```

## Environment

Create the local environment file:

```sh
cp storefront/.env.local.template storefront/.env.local
```

Required values:

| Variable                             | Purpose                                |
| ------------------------------------ | -------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`               | Canonical storefront URL               |
| `NEXT_PUBLIC_BASE_URL`               | Local and Playwright base URL          |
| `NEXT_PUBLIC_MEDUSA_URL`             | Browser-reachable Medusa Store API URL |
| `MEDUSA_BACKEND_URL`                 | Server-side Medusa URL override        |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Store API publishable key              |
| `NEXT_PUBLIC_STRIPE_PK`              | Browser-safe Stripe publishable key    |
| `NEXT_PUBLIC_MEILI_HOST`             | Meilisearch host                       |
| `NEXT_PUBLIC_MEILI_SEARCH_KEY`       | Meilisearch search-only key            |

Optional media origins and Bandcamp configuration are documented in
`.env.local.template`.

Do not place a Medusa Admin token or a Meilisearch admin key in the storefront
environment.

## Commands

Run these from the repository root:

```sh
pnpm --filter remorseless-records-storefront run dev
pnpm --filter remorseless-records-storefront run lint
pnpm --filter remorseless-records-storefront run typecheck
pnpm --filter remorseless-records-storefront run test:coverage
pnpm --filter remorseless-records-storefront run build
pnpm --filter remorseless-records-storefront run test:e2e
```

The local application listens on `http://localhost:3000`.

## Architecture

- `src/app`: App Router pages, layouts, and server route handlers.
- `src/components`: shared and feature-level UI components.
- `src/lib/data`: Medusa Store API data access.
- `src/lib/search`: typed Meilisearch requests, filtering, and result
  normalization.
- `src/app/api/search/products`: validated and rate-limited server-side search
  boundary.
- `src/config`: Zod-validated client and server environments.
- `src/test` and colocated `*.test.ts(x)` files: Vitest coverage.
- `e2e`: Playwright browser coverage.

Catalog search is not performed by a browser-side Meilisearch client. The
browser posts a validated request to `/api/search/products`; the server route
queries Meilisearch and returns the normalized catalog response. Text queries
match configured title and artist fields, while format, genre, type,
availability, price, and other facets are applied as filters.

## Quality gates

Before committing storefront changes, run:

```sh
pnpm run qa:lint
pnpm run qa:storefront:coverage
pnpm --filter remorseless-records-storefront run build
```

Responsive changes must also be verified with the Playwright device projects
and a real browser screenshot as described in `tmp/STARTUP.md`.
