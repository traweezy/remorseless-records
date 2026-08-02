import type { MedusaRequest } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import type { DiscographyEntryRecord } from "@/modules/discography/serializers"
import {
  createManualDiscographyEntry,
  setDiscographyEntryArchived,
  updateManualDiscographyEntry,
  type DiscographyService,
} from "./helpers"

const createKey = "57fb5c69-d829-47c3-a877-19c15add6137"
const updateKey = "64d0f078-50fe-428e-80e3-a628750353ad"
const archiveKey = "98c549f3-31d0-462f-854c-45f5796a9de9"
const restoreKey = "0a22bb15-6cf4-4881-85ef-afb817a94b47"

type Operation = {
  actor_id: string | null
  aggregate_id: string
  command: string
  completed_at?: Date | null
  expected_version: number
  id: string
  idempotency_key: string
  request_sha256: string
  result: Record<string, unknown>
  status: "pending" | "succeeded"
}

const entryFixture = (
  overrides: Partial<DiscographyEntryRecord> = {}
): DiscographyEntryRecord => ({
  album: "Archive Demo",
  archived_at: null,
  artist: "Test Artist",
  availability: "out_of_print",
  catalog_number: null,
  collection_title: "Remorseless Records",
  cover_alt_text: null,
  cover_url: null,
  created_at: "2026-08-02T05:00:00.000Z",
  formats: ["Cassette"],
  genres: ["Death Metal"],
  id: "disc_manual",
  product_handle: null,
  product_id: null,
  release_date: null,
  release_year: 1999,
  source_mode: "manual",
  tags: [],
  title: "Archive Demo",
  updated_at: "2026-08-02T05:00:00.000Z",
  version: 1,
  ...overrides,
})

const requestFixture = (): MedusaRequest =>
  ({
    auth_context: { actor_id: "user_admin" },
  }) as unknown as MedusaRequest

const serviceFixture = (initialEntries: DiscographyEntryRecord[] = []) => {
  const entries = new Map(initialEntries.map((entry) => [entry.id, entry]))
  const operations = new Map<string, Operation>()
  let nextEntry = 1
  let nextOperation = 1

  const service = {
    createDiscographyEntries: jest.fn(
      async (payloads: Record<string, unknown>[]) =>
        payloads.map((payload) => {
          const id = `disc_created_${nextEntry++}`
          const created = entryFixture({
            ...(payload as Partial<DiscographyEntryRecord>),
            created_at: "2026-08-02T05:00:00.000Z",
            id,
            updated_at: "2026-08-02T05:00:00.000Z",
          })
          entries.set(id, created)
          return created
        })
    ),
    createDiscographyOperations: jest.fn(async (payloads: Operation[]) =>
      payloads.map((payload) => {
        const operation = {
          ...payload,
          id: `discop_${nextOperation++}`,
        }
        operations.set(operation.idempotency_key, operation)
        return operation
      })
    ),
    listDiscographyOperations: jest.fn(
      async ({ idempotency_key }: { idempotency_key: string }) => {
        const operation = operations.get(idempotency_key)
        return operation ? [operation] : []
      }
    ),
    retrieveDiscographyEntry: jest.fn(
      async (id: string) => entries.get(id) ?? null
    ),
    runDiscographyTransaction: jest.fn(
      async (task: (context: object) => unknown) => task({})
    ),
    updateDiscographyEntries: jest.fn(
      async (payloads: Array<Record<string, unknown>>) =>
        payloads.map((payload) => {
          const id = String(payload.id)
          const current = entries.get(id)
          if (!current) {
            return null
          }
          const updated = {
            ...current,
            ...(payload as Partial<DiscographyEntryRecord>),
            updated_at: "2026-08-02T05:01:00.000Z",
          }
          entries.set(id, updated)
          return updated
        })
    ),
    updateDiscographyOperations: jest.fn(
      async (payloads: Array<Record<string, unknown>>) =>
        payloads.map((payload) => {
          const current = [...operations.values()].find(
            (operation) => operation.id === payload.id
          )
          if (!current) {
            return null
          }
          const updated = { ...current, ...payload } as Operation
          operations.set(updated.idempotency_key, updated)
          return updated
        })
    ),
  }

  return {
    entries,
    operations,
    service: service as unknown as DiscographyService,
  }
}

describe("discography authoring commands", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-02T05:30:00.000Z"))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("creates a normalized historical entry and replays the same command", async () => {
    const { service } = serviceFixture()
    const input = {
      artist: " Test Artist ",
      expectedVersion: 0 as const,
      formats: ["Cassette", " cassette "],
      idempotencyKey: createKey,
      releaseDate: "1999-05-01",
      releaseTitle: " Archive Demo ",
    }

    const created = await createManualDiscographyEntry(
      requestFixture(),
      service,
      input
    )
    const replayed = await createManualDiscographyEntry(
      requestFixture(),
      service,
      input
    )

    expect(created.replayed).toBe(false)
    expect(created.entry).toMatchObject({
      album: "Archive Demo",
      artist: "Test Artist",
      formats: ["Cassette"],
      linkHealth: "not_applicable",
      productId: null,
      releaseYear: 1999,
      sourceMode: "manual",
      title: "Archive Demo",
      version: 1,
    })
    expect(replayed).toEqual({ ...created, replayed: true })
    expect(service.createDiscographyEntries).toHaveBeenCalledTimes(1)
  })

  it("rejects edits to a catalog-synchronized entry", async () => {
    const linked = entryFixture({
      id: "disc_linked",
      product_handle: "music-release-test-artist-release",
      product_id: "prod_linked",
      source_mode: "catalog_product",
    })
    const { service } = serviceFixture([linked])

    await expect(
      updateManualDiscographyEntry(requestFixture(), service, linked.id, {
        expectedVersion: 1,
        idempotencyKey: updateKey,
        releaseTitle: "Changed",
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.CONFLICT })
    expect(service.createDiscographyOperations).not.toHaveBeenCalled()
  })

  it("rejects a stale manual update before creating an audit operation", async () => {
    const current = entryFixture({ version: 3 })
    const { service } = serviceFixture([current])

    await expect(
      updateManualDiscographyEntry(requestFixture(), service, current.id, {
        expectedVersion: 2,
        idempotencyKey: updateKey,
        releaseTitle: "Changed",
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.CONFLICT })
    expect(service.createDiscographyOperations).not.toHaveBeenCalled()
  })

  it("archives and restores without deleting the entry", async () => {
    const current = entryFixture()
    const { entries, service } = serviceFixture([current])

    const archived = await setDiscographyEntryArchived(
      requestFixture(),
      service,
      current.id,
      { expectedVersion: 1, idempotencyKey: archiveKey },
      true
    )
    expect(archived.entry).toMatchObject({
      archivedAt: "2026-08-02T05:30:00.000Z",
      version: 2,
    })

    const restored = await setDiscographyEntryArchived(
      requestFixture(),
      service,
      current.id,
      { expectedVersion: 2, idempotencyKey: restoreKey },
      false
    )
    expect(restored.entry).toMatchObject({ archivedAt: null, version: 3 })
    expect(entries.size).toBe(1)
  })

  it("maps database serialization failures to a merchant conflict", async () => {
    const { service } = serviceFixture()
    service.runDiscographyTransaction = jest.fn(async () => {
      throw Object.assign(new Error("could not serialize access"), {
        code: "40001",
      })
    })

    await expect(
      createManualDiscographyEntry(requestFixture(), service, {
        artist: "Test Artist",
        expectedVersion: 0,
        idempotencyKey: createKey,
        releaseTitle: "Archive Demo",
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.CONFLICT })
  })
})
