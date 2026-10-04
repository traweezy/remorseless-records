import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it, vi } from "vitest"

import { resolveCartInventory } from "./inventory"

const cart = () =>
  ({
    id: "cart_AUDIT",
    sales_channel_id: "sc_WEB",
    total: 1.23,
    items: [
      {
        id: "cali_AUDIT",
        product_id: "prod_AUDIT",
        variant_id: "variant_CD",
        quantity: 1,
        unit_price: 1.23,
        product: { id: "prod_AUDIT" },
        variant: {
          id: "variant_CD",
          manage_inventory: true,
          allow_backorder: false,
        },
      },
    ],
  }) as unknown as HttpTypes.StoreCart

const products = (inventory: unknown = 20) => ({
  count: 1,
  products: [
    {
      id: "prod_AUDIT",
      handle: "music-release-audit",
      variants: [
        {
          id: "variant_CD",
          manage_inventory: true,
          allow_backorder: false,
          inventory_quantity: inventory,
        },
      ],
    },
  ],
})

describe("native cart inventory enrichment", () => {
  it("resolves omitted native cart availability in its exact channel without changing money", async () => {
    const source = cart()
    const read = vi.fn().mockResolvedValue(products())
    const result = await resolveCartInventory(source, read)
    expect(read).toHaveBeenCalledWith({
      productIds: ["prod_AUDIT"],
      salesChannelId: "sc_WEB",
    })
    expect(result.items![0]?.variant?.inventory_quantity).toBe(20)
    expect(result.total).toBe(1.23)
    expect(result.items![0]?.unit_price).toBe(1.23)
    expect(source.items![0]?.variant).not.toHaveProperty("inventory_quantity")
  })

  it("refreshes supplied inventory and keeps a valid zero restrictive", async () => {
    const source = cart()
    source.items![0]!.variant!.inventory_quantity = 99
    const result = await resolveCartInventory(
      source,
      vi.fn().mockResolvedValue(products(0))
    )
    expect(result.items![0]?.variant?.inventory_quantity).toBe(0)
  })

  it.each([
    undefined,
    null,
    false,
    "20",
    -1,
    0.5,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ])("fails closed for missing or malformed quantity %s", async (value) => {
    const reply = products()
    reply.products[0]!.variants[0]!.inventory_quantity = value
    await expect(
      resolveCartInventory(cart(), vi.fn().mockResolvedValue(reply))
    ).rejects.toThrow()
  })

  it.each([
    "missing product",
    "foreign product",
    "missing variant",
    "duplicate variant",
    "policy changed",
  ])("rejects %s instead of granting unlimited stock", async (kind) => {
    const reply = products()
    if (kind === "missing product") reply.products = []
    if (kind === "foreign product") reply.products[0]!.id = "prod_OTHER"
    if (kind === "missing variant") reply.products[0]!.variants = []
    if (kind === "duplicate variant")
      reply.products[0]!.variants.push({ ...reply.products[0]!.variants[0]! })
    if (kind === "policy changed")
      reply.products[0]!.variants[0]!.manage_inventory = false
    await expect(
      resolveCartInventory(cart(), vi.fn().mockResolvedValue(reply))
    ).rejects.toThrow()
  })

  it.each(["missing channel", "foreign product link", "foreign variant link"])(
    "rejects %s before reading the provider",
    async (kind) => {
      const source = cart()
      if (kind === "missing channel") delete source.sales_channel_id
      if (kind === "foreign product link")
        source.items![0]!.product!.id = "prod_OTHER"
      if (kind === "foreign variant link")
        source.items![0]!.variant!.id = "variant_OTHER"
      const read = vi.fn()
      await expect(resolveCartInventory(source, read)).rejects.toThrow()
      expect(read).not.toHaveBeenCalled()
    }
  )

  it("does not invent quantity limits for backorders or unmanaged stock", async () => {
    const source = cart()
    source.items![0]!.variant!.allow_backorder = true
    const read = vi.fn()
    expect(await resolveCartInventory(source, read)).toBe(source)
    source.items![0]!.variant!.allow_backorder = false
    source.items![0]!.variant!.manage_inventory = false
    expect(await resolveCartInventory(source, read)).toBe(source)
    expect(read).not.toHaveBeenCalled()
  })

  it("propagates inventory outages instead of accepting a stale quantity", async () => {
    await expect(
      resolveCartInventory(
        cart(),
        vi.fn().mockRejectedValue(new Error("unavailable"))
      )
    ).rejects.toThrow("unavailable")
  })

  it("keeps completed-cart recovery independent of current catalog availability", async () => {
    const source = cart()
    source.completed_at = "2026-10-04T00:00:00.000Z"
    const read = vi.fn().mockRejectedValue(new Error("product archived"))
    expect(await resolveCartInventory(source, read)).toBe(source)
    expect(read).not.toHaveBeenCalled()
  })
})
