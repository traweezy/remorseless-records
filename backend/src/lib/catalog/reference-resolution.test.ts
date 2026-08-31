import type CatalogModuleService from "../../modules/catalog/service"
import {
  resolveOrCreateCatalogArtist,
  resolveOrCreateCatalogReferenceValue,
  type CatalogService,
} from "./reference-resolution"

const serviceFixture = (): jest.Mocked<CatalogService> =>
  ({
    createCatalogArtists: jest.fn(),
    createCatalogReferenceValues: jest.fn(),
    listCatalogArtists: jest.fn(),
    listCatalogReferenceValues: jest.fn(),
    retrieveCatalogArtist: jest.fn(),
    retrieveCatalogReferenceValue: jest.fn(),
  }) as unknown as jest.Mocked<InstanceType<typeof CatalogModuleService>>

const artist = (overrides: Record<string, unknown> = {}) => ({
  bio: null,
  id: "artist_1",
  image_url: null,
  location: null,
  metadata: {},
  name: "Artist",
  slug: "artist",
  sort_name: "Artist",
  ...overrides,
})

const reference = (overrides: Record<string, unknown> = {}) => ({
  description: null,
  id: "cref_1",
  is_active: true,
  kind: "format",
  label: "Compact Disc",
  metadata: {},
  rank: 0,
  value: "cd",
  ...overrides,
})

describe("catalog reference resolution", () => {
  it("retrieves explicit artist IDs without creating a duplicate", async () => {
    const service = serviceFixture()
    service.retrieveCatalogArtist.mockResolvedValue(artist() as never)

    await expect(
      resolveOrCreateCatalogArtist(service, { artistId: "artist_1" })
    ).resolves.toMatchObject({
      created: false,
      record: { id: "artist_1" },
    })
    expect(service.listCatalogArtists).not.toHaveBeenCalled()
    expect(service.createCatalogArtists).not.toHaveBeenCalled()
  })

  it("reuses an artist by canonical slug before creating", async () => {
    const service = serviceFixture()
    service.listCatalogArtists.mockResolvedValue([
      artist({
        id: "artist_existing",
        name: "Déjà Vu",
        slug: "deja-vu",
        sort_name: "Déjà Vu",
      }),
    ] as never)

    await expect(
      resolveOrCreateCatalogArtist(service, { name: " Déjà Vu " })
    ).resolves.toMatchObject({
      created: false,
      record: { id: "artist_existing" },
    })
    expect(service.listCatalogArtists).toHaveBeenCalledWith(
      { slug: "deja-vu" },
      { take: 2 },
      undefined
    )
    expect(service.createCatalogArtists).not.toHaveBeenCalled()
  })

  it("reports a newly created artist for compensation tracking", async () => {
    const service = serviceFixture()
    service.listCatalogArtists.mockResolvedValue([])
    service.createCatalogArtists.mockResolvedValue([
      artist({
        id: "artist_new",
        name: "New Artist",
        slug: "new-artist",
        sort_name: "New Artist",
      }),
    ] as never)

    await expect(
      resolveOrCreateCatalogArtist(service, { name: "New Artist" })
    ).resolves.toMatchObject({
      created: true,
      record: { id: "artist_new" },
    })
  })

  it("reuses controlled reference values by kind and canonical value", async () => {
    const service = serviceFixture()
    service.listCatalogReferenceValues.mockResolvedValue([
      reference({ id: "cref_existing", value: "CD" }),
    ] as never)

    await expect(
      resolveOrCreateCatalogReferenceValue(service, {
        kind: "format",
        label: "Compact Disc",
        value: " CD ",
      })
    ).resolves.toMatchObject({
      created: false,
      record: { id: "cref_existing" },
    })
    expect(service.listCatalogReferenceValues).toHaveBeenCalledWith(
      { kind: "format", value: "CD" },
      { take: 2 },
      undefined
    )
  })

  it("reports newly created values and rejects incomplete free text", async () => {
    const service = serviceFixture()
    service.listCatalogReferenceValues.mockResolvedValue([])
    service.createCatalogReferenceValues.mockResolvedValue([
      reference({
        id: "cref_new",
        kind: "genre",
        label: "Death Metal",
        value: "death-metal",
      }),
    ] as never)

    await expect(
      resolveOrCreateCatalogReferenceValue(service, {
        kind: "genre",
        label: "Death Metal",
      })
    ).resolves.toMatchObject({
      created: true,
      record: { id: "cref_new" },
    })
    await expect(
      resolveOrCreateCatalogReferenceValue(service, {
        kind: "genre",
        label: " ",
      })
    ).resolves.toEqual({ created: false, record: null })
  })

  it("rejects explicit values with the wrong kind or archived state", async () => {
    const service = serviceFixture()
    service.retrieveCatalogReferenceValue
      .mockResolvedValueOnce(
        reference({ id: "cref_genre", kind: "genre" }) as never
      )
      .mockResolvedValueOnce(
        reference({ id: "cref_archived", is_active: false }) as never
      )

    await expect(
      resolveOrCreateCatalogReferenceValue(service, {
        kind: "format",
        referenceValueId: "cref_genre",
      })
    ).rejects.toThrow("is not a format")
    await expect(
      resolveOrCreateCatalogReferenceValue(service, {
        kind: "format",
        referenceValueId: "cref_archived",
      })
    ).rejects.toThrow("archived")
  })
})
