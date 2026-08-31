import { MedusaError } from "@medusajs/framework/utils"

import type { DiscographyEntryRecord } from "./serializers"
import DiscographyModuleService, {
  type DiscographyReplacementEntry,
} from "./service"

const observedAt = "2026-08-31T05:00:00.000Z"

const linkedEntry = (
  overrides: Partial<DiscographyEntryRecord> = {}
): DiscographyEntryRecord => ({
  album: "Existing Release",
  archived_at: null,
  artist: "Existing Artist",
  availability: "in_print",
  catalog_number: "RR-001",
  collection_title: "Remorseless Records",
  cover_alt_text: null,
  cover_url: null,
  created_at: "2026-08-01T00:00:00.000Z",
  formats: ["Vinyl"],
  genres: ["Death Metal"],
  id: "disc_existing",
  product_handle: "existing-release",
  product_id: "prod_existing",
  release_date: "2026-01-01T00:00:00.000Z",
  release_year: 2026,
  source_mode: "catalog_product",
  tags: ["Featured"],
  title: "Existing Release",
  updated_at: "2026-08-01T00:00:00.000Z",
  version: 4,
  ...overrides,
})

const manualEntry = (): DiscographyEntryRecord => ({
  ...linkedEntry({
    id: "disc_manual",
    product_handle: null,
    product_id: null,
    source_mode: "manual",
    version: 2,
  }),
})

const projectionEntry = (
  overrides: Partial<DiscographyReplacementEntry> = {}
): DiscographyReplacementEntry => ({
  album: "Existing Release",
  artist: "Existing Artist",
  availability: "in_print",
  catalog_number: "RR-001",
  collection_title: "Remorseless Records",
  cover_alt_text: null,
  cover_url: null,
  formats: ["Vinyl"],
  genres: ["Death Metal"],
  product_handle: "existing-release",
  product_id: "prod_existing",
  release_date: new Date("2026-01-01T00:00:00.000Z"),
  release_year: 2026,
  source_mode: "catalog_product",
  tags: ["Featured"],
  title: "Existing Release",
  version: 1,
  ...overrides,
})

type ServiceHarness = DiscographyModuleService & {
  createDiscographyEntries: jest.Mock
  entries: Map<string, DiscographyEntryRecord>
  listAndCountDiscographyEntries: jest.Mock
  updateDiscographyEntries: jest.Mock
}

const serviceHarness = (
  initialEntries: DiscographyEntryRecord[] = []
): ServiceHarness => {
  const manager = {}
  const entries = new Map(initialEntries.map((entry) => [entry.id, entry]))
  let nextId = 1
  const listAndCountDiscographyEntries = jest.fn(
    async (
      _filters: Record<string, unknown>,
      config: { skip?: number; take?: number }
    ) => {
      const sorted = [...entries.values()].sort((left, right) =>
        left.id.localeCompare(right.id)
      )
      const skip = config.skip ?? 0
      const take = config.take ?? sorted.length
      return [sorted.slice(skip, skip + take), sorted.length]
    }
  )
  return Object.assign(Object.create(DiscographyModuleService.prototype), {
    baseRepository_: {
      getFreshManager: jest.fn(() => manager),
      transaction: jest.fn(
        async (callback: (transactionManager: unknown) => unknown) =>
          callback(manager)
      ),
    },
    createDiscographyEntries: jest.fn(
      async (payloads: Array<Record<string, unknown>>) =>
        payloads.map((payload) => {
          const entry = linkedEntry({
            ...(payload as Partial<DiscographyEntryRecord>),
            archived_at: null,
            created_at: observedAt,
            id: `disc_created_${nextId++}`,
            updated_at: observedAt,
          })
          entries.set(entry.id, entry)
          return entry
        })
    ),
    entries,
    listAndCountDiscographyEntries,
    updateDiscographyEntries: jest.fn(
      async (payloads: Array<Record<string, unknown>>) =>
        payloads.flatMap((payload) => {
          const current = entries.get(String(payload.id))
          if (!current) {
            return []
          }
          const entry = {
            ...current,
            ...(payload as Partial<DiscographyEntryRecord>),
            updated_at: observedAt,
          }
          entries.set(entry.id, entry)
          return [entry]
        })
    ),
  }) as ServiceHarness
}

describe("discography catalog projection persistence", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(observedAt))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("updates, creates, archives, and verifies the complete projection", async () => {
    const service = serviceHarness([
      linkedEntry(),
      linkedEntry({
        id: "disc_stale",
        product_handle: "stale-release",
        product_id: "prod_stale",
        version: 2,
      }),
      linkedEntry({
        archived_at: "2026-08-15T00:00:00.000Z",
        id: "disc_returned",
        product_handle: "returned-release",
        product_id: "prod_returned",
        version: 7,
      }),
      manualEntry(),
    ])

    await expect(
      service.replaceWithCatalogProjection([
        projectionEntry({ title: "Updated Release" }),
        projectionEntry({
          product_handle: "returned-release",
          product_id: "prod_returned",
          title: "Returned Release",
        }),
        projectionEntry({
          product_handle: "new-release",
          product_id: "prod_new",
          title: "New Release",
        }),
      ])
    ).resolves.toEqual({
      archived: 1,
      created: 1,
      retainedManual: 1,
      updated: 2,
    })

    expect(service.entries.get("disc_existing")).toMatchObject({
      archived_at: null,
      title: "Updated Release",
      version: 5,
    })
    expect(service.entries.get("disc_returned")).toMatchObject({
      archived_at: "2026-08-15T00:00:00.000Z",
      title: "Returned Release",
      version: 8,
    })
    expect(service.entries.get("disc_stale")).toMatchObject({
      archived_at: new Date(observedAt),
      version: 3,
    })
    expect(
      [...service.entries.values()].find(
        ({ product_id }) => product_id === "prod_new"
      )
    ).toMatchObject({ archived_at: null, title: "New Release", version: 1 })
    expect(service.entries.get("disc_manual")).toEqual(manualEntry())
    expect(service.listAndCountDiscographyEntries).toHaveBeenCalledTimes(2)
  })

  it("rejects duplicate or malformed projection input before reading state", async () => {
    const service = serviceHarness()

    await expect(
      service.replaceWithCatalogProjection([
        projectionEntry(),
        projectionEntry(),
      ])
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
    await expect(
      service.replaceWithCatalogProjection([
        projectionEntry({
          cover_alt_text: null,
          cover_url: "file:///cover.jpg",
        }),
      ])
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
    expect(service.listAndCountDiscographyEntries).not.toHaveBeenCalled()
  })

  it("rejects incomplete pages and count drift", async () => {
    const service = serviceHarness([linkedEntry()])
    service.listAndCountDiscographyEntries.mockResolvedValueOnce([
      [linkedEntry()],
      2,
    ])

    await expect(
      service.replaceWithCatalogProjection([projectionEntry()])
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
    expect(service.updateDiscographyEntries).not.toHaveBeenCalled()
  })

  it("rejects short and drifting mutation acknowledgements", async () => {
    const shortService = serviceHarness()
    shortService.createDiscographyEntries.mockResolvedValueOnce([])
    await expect(
      shortService.replaceWithCatalogProjection([projectionEntry()])
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })

    const driftingService = serviceHarness([linkedEntry()])
    driftingService.updateDiscographyEntries.mockResolvedValueOnce([
      linkedEntry({ title: "Drifted", version: 5 }),
    ])
    await expect(
      driftingService.replaceWithCatalogProjection([
        projectionEntry({ title: "Expected" }),
      ])
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })

  it("rejects final readback drift after acknowledged writes", async () => {
    const service = serviceHarness([linkedEntry()])
    service.listAndCountDiscographyEntries.mockImplementationOnce(async () => [
      [linkedEntry()],
      1,
    ])
    service.listAndCountDiscographyEntries.mockImplementationOnce(async () => [
      [],
      0,
    ])

    await expect(
      service.replaceWithCatalogProjection([
        projectionEntry({ title: "Updated" }),
      ])
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })
})
