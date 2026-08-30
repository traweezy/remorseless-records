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
| `MEILISEARCH_HOST`                   | Server-only Meilisearch host           |
| `MEILISEARCH_SEARCH_KEY`             | Server-only search key (never admin)   |
| `REDIS_URL`                          | Private shared Redis connection        |
| `CART_COOKIE_SECRET`                 | Cart signing and rate-key HMAC secret  |

Optional media origins and Bandcamp configuration are documented in
`.env.local.template`.

Server traces use `@vercel/otel`; optional OTLP export uses
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, and
`OTEL_EXPORTER_OTLP_PROTOCOL`. These are server-only values. Browser telemetry
contains only bounded Web Vital values or normalized framework error digests
and never sends cookies, URLs, customer fields, or raw exception text.

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

The search boundary accepts at most 60 results per request and only the first
1,000 matches. Filters that cannot run in Meilisearch may examine at most 2,048
raw hits before returning a conservative bounded result. The Medusa fallback
route applies the same 60-result and 1,000-result-window limits.

Sitemap generation and the bounded catalog fallback consume
`GET /store/products/handles`, not an offset scan over every Product. The feed
uses opaque 100-row keyset pages and the configured publishable key, so it
contains only published Products in the Storefront sales channel. Every page
has an eight-second deadline. Sitemap generation stops after 5,000 Products;
the in-process fallback hydrates at most 1,000 through native Store API batches.

Server-side news, discography, merchandising-shelf, and product-handle feeds
share one provider-read boundary. It permits only `GET` and `HEAD`, makes at
most two attempts under one eight-second deadline, preserves caller
cancellation, and applies 100 ms exponential backoff capped at one second.
Short `Retry-After` values are honored; longer provider windows return without
an eager retry. Discarded response bodies are canceled, and terminal transport
errors retain only `timeout` or `unavailable`, never an upstream URL, payload,
credential, or customer value.

Server-side Meilisearch queries use the same bounded retry primitives at the
semantic read-operation boundary. Although the SDK transports search queries
with `POST`, the operation is read-only and only SDK transport failures or
transient HTTP statuses are retried. Search makes at most two attempts under
one eight-second deadline, honors bounded `Retry-After`, and propagates the
incoming API request's cancellation signal. Catalog loaders do not add another
retry loop, preventing multiplicative attempts. Terminal errors use the same
redacted `timeout` or `unavailable` contract. Every retry emits one info-level
event containing only the next attempt, maximum attempts, and delay.

Server-side reads to the Medusa Store API also use one shared semantic
read-operation boundary. This includes correlated Storefront BFF reads and
cached Server Component reads for products, collections, categories, regions,
and bundle composition, plus cart retrieval, shipping and payment-provider
discovery, and order-receipt retrieval. The helper rejects methods other than
`GET` or `HEAD`, retries only SDK transport failures and transient HTTP
statuses, and makes at most two attempts under one eight-second deadline.
Correlated calls merge the incoming request signal with any explicit caller
signal. Terminal errors retain only `timeout` or `unavailable`; retry events
contain only the next attempt, maximum attempts, and delay, never a route,
query, provider payload, credential, or customer value. Cart, checkout, and
other mutations never use this retry boundary.

The storefront uses a version-controlled subset of the backend's filterable
index contract instead of reading index settings on every request. The backend
release rebuild validates that contract before its atomic index swap. Initial
catalog results use an explicit five-minute Next data cache carrying the
`products` cache tag; catalog-wide filters retain their 15-minute data caches.
Interactive search requests remain server-side and current.

Every HTML document is rendered behind `src/proxy.ts`, which generates a fresh
request nonce and sends the same strict Content Security Policy to Next and the
browser. Production scripts require that nonce and `strict-dynamic`; inline
event handlers are disabled, `base-uri` is `none`, and webpack generates SRI
metadata for eligible assets. Dynamic App Router documents authorize every
executable script with the request nonce; eligible Next asset tags may also
carry SRI. A nonce-authorized bootstrap opts Zod into its strict-CSP `jitless`
mode before client bundles load, avoiding Zod's otherwise harmless but
reportable eval capability probe. Document rendering is intentionally dynamic
so a nonce is never reused, while Medusa and Meilisearch reads keep their
explicit tagged data caches. Only configured application/media origins enter
the browser policy. Next Image additionally permits the exact HTTPS
`images.unsplash.com` host used by version-controlled news seed data, while the
browser continues to request only same-origin optimized images. Production
rejects HTTP image origins; local development may still use them.

Route and root error boundaries expose neutral recovery copy, focus the error
heading, report only a validated framework digest through the credentialless
same-origin telemetry boundary, and support retry or a plain home navigation
even when the router itself failed. Web Vitals report only the fixed metric
name, rating, and rounded value; routes, users, sessions, and browser identity
are excluded. Cookie-consent parsing
contains malformed percent encoding and rejects oversized values.

The proxy also validates or creates `X-Request-Id` and W3C `traceparent`
context for every `/api/*` request and returns both headers to the caller.
Storefront BFF calls create child spans while preserving the request and trace
IDs across Medusa cart, checkout, catalog, contact, and privacy requests.
Project-owned failures use the correlated RFC 7807 contract documented in
[`docs/API_PROBLEM_CONTRACT.md`](../docs/API_PROBLEM_CONTRACT.md); structured
problem logs contain correlation and deployment metadata but no paths, bodies,
PII, credentials, or provider payloads.

Every project-owned API abuse control uses the shared Redis fixed-window
counter in `src/lib/security/rate-limit.ts`. One Lua evaluation atomically
increments the HMAC-keyed client bucket and applies its TTL, so replicas share
the same decision without persisting a raw IP. User-Agent is not part of the
identity. Availability-sensitive catalog, product, news, bundle, search, and
hydrate reads use a bounded 10,000-bucket process-local fallback when Redis is
unavailable. Contact, privacy, and cart mutations reject with a correlated 503
instead of running without their distributed guard.

Client IP headers are trusted only in a Railway runtime that provides all of
`RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, and `RAILWAY_SERVICE_ID`.
Within that boundary only Railway's documented `X-Real-IP` is accepted and
validated as an IPv4 or IPv6 address. `X-Forwarded-For`, `CF-Connecting-IP`,
invalid values, and all forwarding headers outside that boundary are ignored.
See the operational contract in
[`docs/RELEASE_OPERATIONS.md`](../docs/RELEASE_OPERATIONS.md).
The alert/SLO contract is documented in
[`docs/OBSERVABILITY_OPERATIONS.md`](../docs/OBSERVABILITY_OPERATIONS.md).

## Quality gates

Before committing storefront changes, run:

```sh
pnpm run qa:lint
pnpm run qa:storefront:coverage
pnpm --filter remorseless-records-storefront run build
```

Responsive changes must also be verified with the Playwright device projects
and a real browser screenshot as described in `tmp/STARTUP.md`.

## Tax decision presentation

The Storefront treats tax collection mode as server-owned checkout evidence,
not a label inferred from the amount. Controlled `collect` lines preserve the
selected provider identity. Controlled `disabled` lines carry no provider and
render **Tax not collected** with `$0.00`; they are never described as exempt,
nontaxable, or provider-calculated zero.

Checkout projections, PaymentIntent metadata, and order receipts retain the
mode, generation, and fingerprint needed to distinguish those cases. Prepared
payments and completed receipts keep their historical decision after an Admin
disable, re-enable, or provider change. A malformed, mixed, or legacy line set
remains `unknown` rather than being promoted to disabled mode.
