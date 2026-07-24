import type { HttpTypes } from "@medusajs/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

const medusaMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  resolveRegionId: vi.fn(),
}))

vi.mock("@/lib/medusa/client", () => ({
  medusa: {
    client: {
      fetch: medusaMocks.fetch,
    },
  },
  storeClient: {
    cart: {},
    fulfillment: {},
    payment: {},
  },
}))
vi.mock("@/lib/regions", () => ({
  resolveRegionId: medusaMocks.resolveRegionId,
}))

import {
  addLineItem,
  createCart,
  getCart,
  removeLineItem,
  updateLineItem,
} from "@/lib/cart/api"

const cartFixture = {
  id: "cart_01ABC",
  currency_code: "usd",
  items: [],
} as unknown as HttpTypes.StoreCart

describe("cart Medusa boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    medusaMocks.resolveRegionId.mockResolvedValue("reg_01ABC")
  })

  it("creates and retrieves carts through cancellable Store API requests", async () => {
    medusaMocks.fetch.mockResolvedValue({ cart: cartFixture })

    await expect(createCart()).resolves.toBe(cartFixture)
    await expect(getCart(cartFixture.id)).resolves.toBe(cartFixture)

    expect(medusaMocks.fetch).toHaveBeenNthCalledWith(
      1,
      "/store/carts",
      expect.objectContaining({
        method: "POST",
        body: { region_id: "reg_01ABC" },
      })
    )
    expect(medusaMocks.fetch.mock.calls[1]?.[0]).toBe(
      `/store/carts/${cartFixture.id}`
    )
    expect(
      (medusaMocks.fetch.mock.calls[0]?.[1] as { signal?: unknown } | undefined)
        ?.signal
    ).toBeInstanceOf(AbortSignal)
    expect(
      (medusaMocks.fetch.mock.calls[1]?.[1] as { signal?: unknown } | undefined)
        ?.signal
    ).toBeInstanceOf(AbortSignal)
  })

  it("uses the documented line-item methods and returns the parent on delete", async () => {
    medusaMocks.fetch
      .mockResolvedValueOnce({ cart: cartFixture })
      .mockResolvedValueOnce({ cart: cartFixture })
      .mockResolvedValueOnce({ parent: cartFixture })

    await expect(addLineItem(cartFixture.id, "variant_01ABC", 2)).resolves.toBe(
      cartFixture
    )
    await expect(updateLineItem(cartFixture.id, "cali_01ABC", 3)).resolves.toBe(
      cartFixture
    )
    await expect(removeLineItem(cartFixture.id, "cali_01ABC")).resolves.toBe(
      cartFixture
    )

    expect(medusaMocks.fetch).toHaveBeenNthCalledWith(
      1,
      `/store/carts/${cartFixture.id}/line-items`,
      expect.objectContaining({
        method: "POST",
        body: { variant_id: "variant_01ABC", quantity: 2 },
      })
    )
    expect(medusaMocks.fetch).toHaveBeenNthCalledWith(
      3,
      `/store/carts/${cartFixture.id}/line-items/cali_01ABC`,
      expect.objectContaining({
        method: "DELETE",
      })
    )
    expect(
      (medusaMocks.fetch.mock.calls[0]?.[1] as { signal?: unknown } | undefined)
        ?.signal
    ).toBeInstanceOf(AbortSignal)
    expect(
      (medusaMocks.fetch.mock.calls[2]?.[1] as { signal?: unknown } | undefined)
        ?.signal
    ).toBeInstanceOf(AbortSignal)
  })
})
