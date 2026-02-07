import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { searchProductsBrowser } from "@/lib/search/browser"
import { getBrowserSearchClient } from "@/lib/search/client"
import { searchProductsWithClient } from "@/lib/search/search"

vi.mock("@/lib/search/client", () => ({
  getBrowserSearchClient: vi.fn(),
}))

vi.mock("@/lib/search/search", () => ({
  searchProductsWithClient: vi.fn(),
}))

describe("searchProductsBrowser", () => {
  beforeEach(() => {
    faker.seed(1501)
  })

  it("delegates to searchProductsWithClient using browser client", async () => {
    const client = { index: vi.fn() } as never
    const response = {
      hits: [],
      total: 0,
      offset: 0,
      facets: {
        genres: {},
        metalGenres: {},
        format: {},
        categories: {},
        variants: {},
        productTypes: {},
      },
    }
    vi.mocked(getBrowserSearchClient).mockReturnValue(client)
    vi.mocked(searchProductsWithClient).mockResolvedValue(response)

    const request = { query: faker.word.noun() }
    await expect(searchProductsBrowser(request)).resolves.toEqual(response)
    expect(searchProductsWithClient).toHaveBeenCalledWith(client, request)
  })
})
