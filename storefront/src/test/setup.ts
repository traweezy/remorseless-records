import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

process.env.NEXT_PUBLIC_SITE_URL ??= "https://storefront.test"
process.env.NEXT_PUBLIC_MEDUSA_URL ??= "https://backend.storefront.test"
process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??= "pk_test_default"
process.env.NEXT_PUBLIC_STRIPE_PK ??= "pk_test_stripe"
process.env.MEILISEARCH_HOST ??= "https://meili.storefront.test"
process.env.MEILISEARCH_SEARCH_KEY ??= "search_test_key"

vi.mock("server-only", () => ({}))
