import { withSearchTransformBudget } from "./transform-budget"
import productSearchTransformer from "./product-transformer"

describe("search database budget", () => {
  it("bounds real catalog expansion across a full plugin Promise.all batch", async () => {
    let active = 0
    let peak = 0
    const list = async (result: object[] = []) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setImmediate(resolve))
      active -= 1
      return result
    }
    const catalog = {
      listCatalogProductProfiles: () => list([{ id: "profile" }]),
      listCatalogProductArtists: () => list(),
      listCatalogProductReferences: () => list(),
      listCatalogVariantProfiles: () => list(),
      listCatalogBundleProfiles: () => list(),
      listCatalogProductMediaItems: () => list(),
      listCatalogShelfProducts: () => list(),
      listCatalogShelves: () => list(),
    }
    const container = {
      resolve: <T>(key: string): T => {
        if (key === "catalog") return catalog as T
        throw new Error("Unregistered fixture service")
      },
    }
    const documents = await Promise.all(
      Array.from({ length: 461 }, (_, index) =>
        productSearchTransformer(
          { id: `product_${index}`, variants: [{ id: `variant_${index}` }] },
          (product) => product,
          { container }
        )
      )
    )
    expect(documents.map((document) => document.id)).toEqual(
      Array.from({ length: 461 }, (_, index) => `product_${index}`)
    )
    expect(peak).toBe(6)
    expect(active).toBe(0)
  })

  it("preserves FIFO and original failures without stranding subsequent work", async () => {
    const order: number[] = []
    const failure = new Error("original failure")
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, index) =>
        withSearchTransformBudget(async () => {
          order.push(index)
          if (index === 1) throw failure
          return index
        })
      )
    )
    expect(order).toEqual([0, 1, 2])
    expect(results).toEqual([
      { status: "fulfilled", value: 0 },
      { status: "rejected", reason: failure },
      { status: "fulfilled", value: 2 },
    ])
  })

  it("rejects excess queued work without running it or poisoning admitted work", async () => {
    const task = jest.fn(async () => undefined)
    const pending = Array.from({ length: 10_000 }, () =>
      withSearchTransformBudget(task)
    )
    await expect(withSearchTransformBudget(task)).rejects.toThrow(
      "Search transform capacity exceeded"
    )
    await Promise.all(pending)
    expect(task).toHaveBeenCalledTimes(10_000)
    await expect(
      withSearchTransformBudget(async () => "available")
    ).resolves.toBe("available")
  })
})
