import { Modules } from "@medusajs/framework/utils"

import { GET } from "./route"

const entry = (overrides: Record<string, unknown> = {}) => ({
  album: "Release",
  archived_at: null,
  artist: "Artist",
  availability: "in_print",
  catalog_number: null,
  collection_title: null,
  cover_alt_text: null,
  cover_url: null,
  created_at: "2026-08-01T00:00:00.000Z",
  formats: ["Vinyl"],
  genres: [],
  id: "disc_1",
  product_handle: null,
  product_id: null,
  release_date: null,
  release_year: 2026,
  source_mode: "manual",
  tags: [],
  title: "Release",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
  ...overrides,
})

const request = (listAndCountDiscographyEntries: jest.Mock) => ({
  query: {},
  scope: {
    resolve: jest.fn((key: string) =>
      key === Modules.PRODUCT
        ? { listProducts: jest.fn() }
        : { listAndCountDiscographyEntries }
    ),
  },
})

describe("GET /admin/discography", () => {
  it("returns a validated counted content page", async () => {
    const listAndCountDiscographyEntries = jest
      .fn()
      .mockResolvedValue([[entry()], 1])
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(
      request(listAndCountDiscographyEntries) as never,
      { status } as never
    )

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      count: 1,
      entries: [
        expect.objectContaining({ id: "disc_1", sourceMode: "manual" }),
      ],
      limit: 25,
      offset: 0,
    })
  })

  it("rejects an incoherent Product link before hydration", async () => {
    const listAndCountDiscographyEntries = jest.fn().mockResolvedValue([
      [
        entry({
          product_id: "prod_1",
          source_mode: "catalog_product",
        }),
      ],
      1,
    ])

    await expect(
      GET(request(listAndCountDiscographyEntries) as never, {} as never)
    ).rejects.toThrow(
      "The Admin content persistence boundary returned invalid structured data."
    )
  })
})
