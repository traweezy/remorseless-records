import {
  callCatalogServiceMethod,
  CatalogServiceMethodError,
} from "./catalog-service-method"

describe("catalog service method boundary", () => {
  it("prefers the canonical method and preserves the receiver", async () => {
    const service = {
      marker: "catalog",
      listCatalogShelves(this: { marker: string }, filter: unknown) {
        return Promise.resolve({ filter, receiver: this.marker })
      },
      listCatalogShelfs: jest.fn().mockResolvedValue("fallback"),
    }

    await expect(
      callCatalogServiceMethod(
        service,
        ["listCatalogShelves", "listCatalogShelfs"],
        [{ handle: "featured" }]
      )
    ).resolves.toEqual({
      filter: { handle: "featured" },
      receiver: "catalog",
    })
    expect(service.listCatalogShelfs).not.toHaveBeenCalled()
  })

  it("uses a supported generated alias and normalizes synchronous results", async () => {
    const fallback = jest.fn().mockReturnValue([{ id: "cshelf_01" }])

    await expect(
      callCatalogServiceMethod(
        { listCatalogShelfs: fallback },
        ["listCatalogShelves", "listCatalogShelfs"],
        []
      )
    ).resolves.toEqual([{ id: "cshelf_01" }])
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["a primitive service", null, ["listCatalogShelves"]],
    ["a missing method", {}, ["listCatalogShelves"]],
    [
      "a non-function method",
      { listCatalogShelves: [] },
      ["listCatalogShelves"],
    ],
    ["no candidates", {}, []],
    ["duplicate candidates", {}, ["listCatalogShelves", "listCatalogShelves"]],
    ["an invalid candidate", {}, ["constructor.prototype"]],
  ])("rejects %s", async (_label, service, candidates) => {
    await expect(
      callCatalogServiceMethod(service, candidates, [])
    ).rejects.toBeInstanceOf(CatalogServiceMethodError)
  })

  it("propagates the selected service failure", async () => {
    const failure = new Error("database unavailable")

    await expect(
      callCatalogServiceMethod(
        {
          listCatalogShelves: jest.fn().mockRejectedValue(failure),
        },
        ["listCatalogShelves"],
        []
      )
    ).rejects.toBe(failure)
  })
})
