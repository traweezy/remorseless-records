import { beforeEach, describe, expect, it, vi } from "vitest"
const read = vi.hoisted(() => vi.fn())
vi.mock("@/lib/data/products", () => ({ getProductByHandle: read }))
import { resolveTypedProductHandle } from "./typed-route.server"

describe("typed product routes", () => {
  beforeEach(() => read.mockReset())
  it.each(["merch", "music-release", "bundle"] as const)(
    "resolves bare %s handles with the matching kind",
    async (kind) => {
      const productType = kind === "bundle" ? "fixed-bundle" : kind
      read.mockImplementation(async (handle) =>
        handle === "audit"
          ? { handle, metadata: { product_type: productType } }
          : null
      )
      expect(await resolveTypedProductHandle(kind, "audit")).toBe("audit")
    }
  )
  it("does not show a bare product under the wrong kind", async () => {
    read.mockResolvedValue({
      handle: "audit",
      metadata: { product_type: "music-release" },
    })
    expect(await resolveTypedProductHandle("merch", "audit")).toBe("")
  })
  it("preserves prefixed-handle precedence and avoids extra reads", async () => {
    read.mockResolvedValue({ handle: "merch-audit" })
    expect(await resolveTypedProductHandle("merch", "audit")).toBe(
      "merch-audit"
    )
    expect(read).toHaveBeenCalledTimes(1)
    expect(await resolveTypedProductHandle("merch", " ")).toBe("")
    expect(read).toHaveBeenCalledTimes(1)
  })
})
