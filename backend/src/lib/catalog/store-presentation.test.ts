import { loadStoreCatalogPresentations } from "./store-presentation"
import {
  catalogMediaAssetFixture,
  catalogProductMediaItemFixture,
  catalogProductProfileFixture,
} from "./transaction-persistence-fixtures.test-helpers"

const fixture = () => ({
  listCatalogProductProfiles: jest.fn().mockResolvedValue([
    catalogProductProfileFixture({
      description_html: "<p>Edited <strong>description</strong></p>",
      credits: { notes: "Owned credits", private: "DO NOT EXPOSE" },
      merch_details: { sizeGuide: "S 18 inches", private: "DO NOT EXPOSE" },
      tracklist: [
        "Signal Check",
        { title: "After the Echo", private: "DO NOT EXPOSE" },
      ],
      metadata: { private: "DO NOT EXPOSE" },
    }),
  ]),
  listCatalogProductMediaItems: jest
    .fn()
    .mockResolvedValue([catalogProductMediaItemFixture()]),
  listCatalogMediaAssets: jest
    .fn()
    .mockResolvedValue([
      catalogMediaAssetFixture({ source_file_key: "private/provider-key" }),
    ]),
  listCatalogProductArtists: jest.fn().mockResolvedValue([
    {
      id: "cpart_1",
      product_profile_id: "cprof_1",
      artist_id: null,
      display_name: "Audit Artist",
      role: "primary",
      sort_order: 0,
      metadata: {},
    },
  ]),
  listCatalogProductReferences: jest.fn().mockResolvedValue([]),
  listCatalogReferenceValues: jest.fn().mockResolvedValue([]),
})

describe("public catalog presentation", () => {
  it("projects authored content and original artwork without diagnostics or commerce", async () => {
    const service = fixture()
    const rows = await loadStoreCatalogPresentations(service as never, [
      "prod_1",
    ])
    expect(rows).toMatchObject([
      {
        productId: "prod_1",
        managedMedia: true,
        profile: {
          artists: ["Audit Artist"],
          descriptionHtml: "<p>Edited <strong>description</strong></p>",
          credits: "Owned credits",
          tracklist: ["Signal Check", "After the Echo"],
          merch: { sizeGuide: "S 18 inches" },
        },
        images: [
          {
            url: "https://media.example/cover.jpg",
            alt: "Cover",
            width: 1000,
            height: 1000,
          },
        ],
      },
    ])
    expect(JSON.stringify(rows)).not.toMatch(
      /DO NOT EXPOSE|provider-key|metadata|inventory|price|quarantinedBy/u
    )
    expect(service.listCatalogProductProfiles).toHaveBeenCalledWith(
      { product_id: ["prod_1"] },
      { take: 2 }
    )
  })

  it("retains managed ownership after quarantine so stale legacy images cannot return", async () => {
    const service = fixture()
    service.listCatalogMediaAssets.mockResolvedValue([
      catalogMediaAssetFixture({
        lifecycle_status: "quarantined",
        quarantined_at: "2026-10-04T00:00:00.000Z",
        quarantined_by: "user_1",
        purge_eligible_at: "2026-11-04T00:00:00.000Z",
      }),
    ])
    const [row] = await loadStoreCatalogPresentations(service as never, [
      "prod_1",
    ])
    expect(row).toMatchObject({ managedMedia: true, images: [] })
  })

  it("keeps catalog authority after the final managed image is removed", async () => {
    const service = fixture()
    service.listCatalogProductMediaItems.mockResolvedValue([])
    const [row] = await loadStoreCatalogPresentations(service as never, [
      "prod_1",
    ])
    expect(row).toMatchObject({ managedMedia: true, images: [] })
    expect(service.listCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it("returns explicit legacy absence without inventing content", async () => {
    const service = fixture()
    service.listCatalogProductProfiles.mockResolvedValue([])
    service.listCatalogProductMediaItems.mockResolvedValue([])
    expect(
      await loadStoreCatalogPresentations(service as never, ["prod_1"])
    ).toEqual([
      { productId: "prod_1", profile: null, managedMedia: false, images: [] },
    ])
    expect(service.listCatalogProductArtists).not.toHaveBeenCalled()
    expect(service.listCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it.each([
    "foreign profile",
    "duplicate profile",
    "foreign artist",
    "missing asset",
    "foreign media",
    "unsafe description",
    "malformed profile list",
  ])("fails closed on %s", async (kind) => {
    const service = fixture()
    if (kind === "foreign profile")
      service.listCatalogProductProfiles.mockResolvedValue([
        catalogProductProfileFixture({ product_id: "prod_hidden" }),
      ])
    if (kind === "duplicate profile")
      service.listCatalogProductProfiles.mockResolvedValue([
        catalogProductProfileFixture(),
        catalogProductProfileFixture({ id: "cprof_2" }),
      ])
    if (kind === "foreign artist")
      service.listCatalogProductArtists.mockResolvedValue([
        { id: "cpart_2", product_profile_id: "cprof_hidden" },
      ])
    if (kind === "missing asset")
      service.listCatalogMediaAssets.mockResolvedValue([])
    if (kind === "foreign media")
      service.listCatalogProductMediaItems.mockResolvedValue([
        catalogProductMediaItemFixture({ product_id: "prod_hidden" }),
      ])
    if (kind === "unsafe description")
      service.listCatalogProductProfiles.mockResolvedValue([
        catalogProductProfileFixture({
          description_html: '<p onclick="steal()">Unsafe</p>',
        }),
      ])
    if (kind === "malformed profile list")
      service.listCatalogProductProfiles.mockResolvedValue({ rows: [] })
    await expect(
      loadStoreCatalogPresentations(service as never, ["prod_1"])
    ).rejects.toThrow()
  })

  it.each([
    [],
    ["prod_1", "prod_1"],
    ["bad"],
    Array.from({ length: 26 }, (_, i) => `prod_${i}`),
  ])("bounds the requested set before persistence", async (...ids) => {
    const service = fixture()
    await expect(
      loadStoreCatalogPresentations(service as never, ids)
    ).rejects.toThrow()
    expect(service.listCatalogProductProfiles).not.toHaveBeenCalled()
  })
})
