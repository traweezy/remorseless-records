import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { GET, POST } from "./route"

const INVALID_PROFILE =
  "The catalog profile persistence boundary returned invalid structured data."

const artist = (overrides: Record<string, unknown> = {}) => ({
  bio: null,
  created_at: "2026-08-01T00:00:00.000Z",
  id: "artist_1",
  image_url: null,
  location: null,
  metadata: {},
  name: "Primary Artist",
  slug: "primary-artist",
  sort_name: "Artist, Primary",
  updated_at: "2026-08-02T00:00:00.000Z",
  ...overrides,
})

type ResponseState = { body: unknown; status: number }

const responseFixture = (): { res: MedusaResponse; state: ResponseState } => {
  const state: ResponseState = { body: null, status: 200 }
  const response = {} as MedusaResponse
  response.status = jest.fn((status: number) => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.json = jest.fn((body: unknown) => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  return { res: response, state }
}

const requestFixture = (
  service: Record<string, unknown>,
  options: { body?: unknown; query?: Record<string, unknown> } = {}
): MedusaRequest =>
  ({
    body: options.body,
    query: options.query ?? {},
    scope: { resolve: jest.fn(() => service) },
  }) as unknown as MedusaRequest

describe("catalog artist collection routes", () => {
  it("returns a validated counted page", async () => {
    const listAndCountCatalogArtists = jest
      .fn()
      .mockResolvedValue([[artist()], 1])
    const { res, state } = responseFixture()

    await GET(
      requestFixture(
        { listAndCountCatalogArtists },
        { query: { limit: "25" } }
      ),
      res
    )

    expect(listAndCountCatalogArtists).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ skip: 0, take: 25 })
    )
    expect(state).toEqual({
      body: {
        artists: [
          expect.objectContaining({ id: "artist_1", name: "Primary Artist" }),
        ],
        count: 1,
        limit: 25,
        offset: 0,
      },
      status: 200,
    })
  })

  it("rejects malformed counted pages before serialization", async () => {
    const req = requestFixture({
      listAndCountCatalogArtists: jest.fn().mockResolvedValue([[false], 1]),
    })

    await expect(GET(req, {} as MedusaResponse)).rejects.toThrow(
      INVALID_PROFILE
    )
  })

  it("rejects unsafe image protocols before resolving persistence", async () => {
    const resolve = jest.fn()
    const req = {
      body: { imageUrl: "file:///tmp/artist.jpg", name: "Artist" },
      scope: { resolve },
    } as unknown as MedusaRequest

    await expect(POST(req, {} as MedusaResponse)).rejects.toThrow(
      "Invalid catalog artist payload"
    )
    expect(resolve).not.toHaveBeenCalled()
  })

  it("requires an exact create acknowledgement", async () => {
    const service = {
      createCatalogArtists: jest
        .fn()
        .mockResolvedValue([artist({ name: "Different Artist" })]),
      listCatalogArtists: jest.fn().mockResolvedValue([]),
    }
    const req = requestFixture(service, { body: { name: "Primary Artist" } })

    await expect(POST(req, {} as MedusaResponse)).rejects.toThrow(
      INVALID_PROFILE
    )
  })
})
