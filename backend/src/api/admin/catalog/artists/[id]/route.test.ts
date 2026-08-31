import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { GET, PUT } from "./route"

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

const requestFixture = (
  service: Record<string, unknown>,
  body: unknown = undefined
): MedusaRequest =>
  ({
    body,
    params: { id: "artist_1" },
    scope: { resolve: jest.fn(() => service) },
  }) as unknown as MedusaRequest

const responseFixture = (): MedusaResponse => {
  const response = {} as MedusaResponse
  response.status = jest.fn(() => response) as MedusaResponse["status"]
  response.json = jest.fn(() => response) as MedusaResponse["json"]
  return response
}

describe("catalog artist detail routes", () => {
  it("returns not found only for an absent record", async () => {
    const req = requestFixture({
      retrieveCatalogArtist: jest.fn().mockResolvedValue(null),
    })

    await expect(GET(req, responseFixture())).rejects.toThrow(
      "Catalog artist not found"
    )
  })

  it("rejects malformed records as persistence failures", async () => {
    const req = requestFixture({
      retrieveCatalogArtist: jest.fn().mockResolvedValue(false),
    })

    await expect(GET(req, responseFixture())).rejects.toThrow(INVALID_PROFILE)
  })

  it("requires an exact update acknowledgement", async () => {
    const service = {
      retrieveCatalogArtist: jest.fn().mockResolvedValue(artist()),
      updateCatalogArtists: jest.fn().mockResolvedValue([artist()]),
    }
    const req = requestFixture(service, { name: "Updated Artist" })

    await expect(PUT(req, responseFixture())).rejects.toThrow(INVALID_PROFILE)
    expect(service.updateCatalogArtists).toHaveBeenCalledWith([
      { id: "artist_1", name: "Updated Artist" },
    ])
  })
})
