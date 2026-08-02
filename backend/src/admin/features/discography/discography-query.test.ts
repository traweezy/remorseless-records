import { requestAdminJson } from "../../lib/admin-request"
import {
  createManualDiscographyEntry,
  listDiscographyEntries,
  updateDiscographyLifecycle,
  updateManualDiscographyEntry,
  type DiscographyEntry,
  type ManualDiscographyInput,
} from "./discography-query"

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(),
}))

const entry: DiscographyEntry = {
  album: "Demo",
  archivedAt: null,
  artist: "Artist",
  availability: "in_print",
  catalogNumber: "RR001",
  collectionTitle: null,
  coverAltText: null,
  coverUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  formats: ["CD"],
  genres: ["Death metal"],
  id: "disc_1",
  lastSyncedAt: null,
  linkHealth: "not_applicable",
  productHandle: null,
  productId: null,
  releaseDate: null,
  releaseYear: 1999,
  sourceMode: "manual",
  tags: ["Demo"],
  title: "Demo",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 4,
}

const manualInput: ManualDiscographyInput = {
  artist: "Artist",
  availability: "in_print",
  catalogNumber: "RR001",
  collectionTitle: null,
  coverAltText: null,
  coverUrl: null,
  formats: ["CD"],
  genres: ["Death metal"],
  releaseDate: null,
  releaseTitle: "Demo",
  releaseYear: 1999,
  tags: ["Demo"],
}

describe("discography admin requests", () => {
  beforeEach(() => {
    jest.mocked(requestAdminJson).mockReset().mockResolvedValue({})
  })

  it("omits inactive list filters and sends server pagination", async () => {
    await listDiscographyEntries({
      archived: "active",
      availability: "all",
      direction: "desc",
      limit: 25,
      offset: 50,
      order: "release_year",
      q: "  Demo  ",
      sourceMode: "all",
    })

    expect(requestAdminJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/admin/discography",
        query: {
          archived: "active",
          direction: "desc",
          limit: 25,
          offset: 50,
          order: "release_year",
          q: "Demo",
        },
      })
    )
  })

  it("sends idempotent create, update, and lifecycle commands", async () => {
    await createManualDiscographyEntry(manualInput, "create-key")
    await updateManualDiscographyEntry(entry, manualInput, "update-key")
    await updateDiscographyLifecycle(entry, "archive", "archive-key")

    expect(requestAdminJson).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        body: expect.objectContaining({
          expectedVersion: 0,
          idempotencyKey: "create-key",
        }),
        method: "POST",
        path: "/admin/discography",
      })
    )
    expect(requestAdminJson).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.objectContaining({
          expectedVersion: 4,
          idempotencyKey: "update-key",
        }),
        method: "PUT",
        path: "/admin/discography/disc_1",
      })
    )
    expect(requestAdminJson).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        body: {
          expectedVersion: 4,
          idempotencyKey: "archive-key",
        },
        method: "POST",
        path: "/admin/discography/disc_1/archive",
      })
    )
  })
})
