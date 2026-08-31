import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"

import type { DiscographyEntryRecord } from "@/modules/discography/serializers"

import { GET } from "./route"

const entry = (id: string, productId: string): DiscographyEntryRecord => ({
  album: `${id} album`,
  artist: `${id} artist`,
  availability: "in_print",
  catalog_number: null,
  collection_title: null,
  cover_alt_text: null,
  cover_url: null,
  formats: [],
  genres: [],
  id,
  product_handle: `${id}-stale-handle`,
  product_id: productId,
  release_date: null,
  release_year: 2026,
  source_mode: "catalog_product",
  tags: [],
  title: `${id} title`,
  updated_at: "2026-08-29T00:00:00.000Z",
  version: 1,
})

describe("GET /store/discography", () => {
  it("exposes purchase links only for published products in the key channel", async () => {
    const visibleEntry = entry("disc_visible", "prod_visible")
    const hiddenEntry = entry("disc_hidden", "prod_hidden")
    const listAndCountDiscographyEntries = jest
      .fn()
      .mockResolvedValue([[visibleEntry, hiddenEntry], 2])
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ product_id: "prod_visible" }] })
      .mockResolvedValueOnce({
        data: [
          {
            handle: "visible-release",
            id: "prod_visible",
            status: ProductStatus.PUBLISHED,
          },
        ],
      })
    const resolve = jest.fn((key: string) => {
      if (key === "discography") {
        return { listAndCountDiscographyEntries }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph }
      }
      throw new Error(`Unexpected dependency: ${key}`)
    })
    const json = jest.fn()
    const setHeader = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(
      {
        publishable_key_context: {
          key: "pk_test",
          sales_channel_ids: ["sc_web"],
        },
        query: {},
        scope: { resolve },
      } as never,
      { json, setHeader, status } as never
    )

    expect(graph).toHaveBeenNthCalledWith(1, {
      entity: "product_sales_channel",
      fields: ["product_id"],
      filters: {
        product_id: ["prod_visible", "prod_hidden"],
        sales_channel_id: ["sc_web"],
      },
      pagination: { take: 2 },
    })
    expect(graph).toHaveBeenNthCalledWith(2, {
      entity: "product",
      fields: ["id", "handle", "status"],
      filters: {
        id: ["prod_visible"],
        status: ProductStatus.PUBLISHED,
      },
      pagination: { take: 1 },
    })
    expect(setHeader).toHaveBeenCalledWith("Vary", "x-publishable-api-key")
    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            id: "disc_visible",
            linkHealth: "healthy",
            productHandle: "visible-release",
            productId: "prod_visible",
          }),
          expect.objectContaining({
            id: "disc_hidden",
            linkHealth: "missing",
            productHandle: null,
            productId: null,
          }),
        ],
      })
    )
  })

  it("rejects malformed visible Product links instead of publishing them", async () => {
    const visibleEntry = entry("disc_visible", "prod_visible")
    const listAndCountDiscographyEntries = jest
      .fn()
      .mockResolvedValue([[visibleEntry], 1])
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ product_id: "prod_visible" }] })
      .mockResolvedValueOnce({
        data: [
          {
            handle: "visible-release",
            id: "prod_visible",
            status: "draft",
          },
        ],
      })
    const resolve = jest.fn((key: string) =>
      key === "discography" ? { listAndCountDiscographyEntries } : { graph }
    )

    await expect(
      GET(
        {
          publishable_key_context: {
            key: "pk_test",
            sales_channel_ids: ["sc_web"],
          },
          query: {},
          scope: { resolve },
        } as never,
        {} as never
      )
    ).rejects.toThrow(
      "The Store product projection returned invalid structured data."
    )
  })
})
