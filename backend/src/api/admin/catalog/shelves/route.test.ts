import { GET } from "./route"

const shelf = (overrides: Record<string, unknown> = {}) => ({
  archived_at: null,
  automation_type: "none",
  created_at: "2026-08-01T00:00:00.000Z",
  description: null,
  ends_at: null,
  handle: "featured",
  id: "cshelf_1",
  is_active: true,
  metadata: {},
  mode: "manual",
  product_limit: 12,
  ribbon_label: "Featured",
  ribbon_priority: 20,
  show_ribbon: true,
  starts_at: null,
  title: "Featured",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
  ...overrides,
})

const request = (
  listAndCountCatalogShelves: jest.Mock,
  query: Record<string, unknown> = {}
) => ({
  query,
  scope: {
    resolve: jest.fn(() => ({
      listAndCountCatalogShelves,
      listCatalogShelfProducts: jest.fn().mockResolvedValue([]),
    })),
  },
})

describe("GET /admin/catalog/shelves", () => {
  it("returns a validated shelf page with bounded memberships", async () => {
    const listAndCountCatalogShelves = jest
      .fn()
      .mockResolvedValue([[shelf()], 1])
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })

    await GET(request(listAndCountCatalogShelves) as never, { status } as never)

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      count: 1,
      limit: 100,
      offset: 0,
      shelves: [
        {
          products: [],
          shelf: expect.objectContaining({
            handle: "featured",
            id: "cshelf_1",
          }),
        },
      ],
    })
  })

  it("rejects a malformed counted page before Admin serialization", async () => {
    const listAndCountCatalogShelves = jest.fn().mockResolvedValue([[false], 1])

    await expect(
      GET(request(listAndCountCatalogShelves) as never, {} as never)
    ).rejects.toThrow(
      "The catalog shelf persistence boundary returned invalid structured data."
    )
  })

  it("rejects list sizes that can exceed the bounded relationship query", async () => {
    const listAndCountCatalogShelves = jest.fn()

    await expect(
      GET(
        request(listAndCountCatalogShelves, { limit: "101" }) as never,
        {} as never
      )
    ).rejects.toThrow()
    expect(listAndCountCatalogShelves).not.toHaveBeenCalled()
  })
})
