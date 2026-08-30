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

describe("catalog reference resolution", () => {
  it("retrieves explicit artist IDs without creating a duplicate", async () => {
    const service = serviceFixture()
    service.retrieveCatalogArtist.mockResolvedValue({
      id: "artist_1",
      name: "Artist",
    } as never)

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
      { id: "artist_existing", name: "Déjà Vu", slug: "deja-vu" },
    ] as never)

    await expect(
      resolveOrCreateCatalogArtist(service, { name: " Déjà Vu " })
    ).resolves.toMatchObject({
      created: false,
      record: { id: "artist_existing" },
    })
    expect(service.listCatalogArtists).toHaveBeenCalledWith(
      { slug: "deja-vu" },
      {},
      undefined
    )
    expect(service.createCatalogArtists).not.toHaveBeenCalled()
  })

  it("reports a newly created artist for compensation tracking", async () => {
    const service = serviceFixture()
    service.listCatalogArtists.mockResolvedValue([])
    service.createCatalogArtists.mockResolvedValue([
      { id: "artist_new", name: "New Artist", slug: "new-artist" },
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
      {
        id: "ref_existing",
        kind: "format",
        label: "Compact Disc",
        value: "cd",
      },
    ] as never)

    await expect(
      resolveOrCreateCatalogReferenceValue(service, {
        kind: "format",
        label: "Compact Disc",
        value: " CD ",
      })
    ).resolves.toMatchObject({
      created: false,
      record: { id: "ref_existing" },
    })
    expect(service.listCatalogReferenceValues).toHaveBeenCalledWith(
      { kind: "format", value: "CD" },
      {},
      undefined
    )
  })

  it("reports newly created values and rejects incomplete free text", async () => {
    const service = serviceFixture()
    service.listCatalogReferenceValues.mockResolvedValue([])
    service.createCatalogReferenceValues.mockResolvedValue([
      {
        id: "ref_new",
        kind: "genre",
        label: "Death Metal",
        value: "death-metal",
      },
    ] as never)

    await expect(
      resolveOrCreateCatalogReferenceValue(service, {
        kind: "genre",
        label: "Death Metal",
      })
    ).resolves.toMatchObject({
      created: true,
      record: { id: "ref_new" },
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
      .mockResolvedValueOnce({
        id: "ref_genre",
        is_active: true,
        kind: "genre",
      } as never)
      .mockResolvedValueOnce({
        id: "ref_archived",
        is_active: false,
        kind: "format",
      } as never)

    await expect(
      resolveOrCreateCatalogReferenceValue(service, {
        kind: "format",
        referenceValueId: "ref_genre",
      })
    ).rejects.toThrow("is not a format")
    await expect(
      resolveOrCreateCatalogReferenceValue(service, {
        kind: "format",
        referenceValueId: "ref_archived",
      })
    ).rejects.toThrow("archived")
  })
})
