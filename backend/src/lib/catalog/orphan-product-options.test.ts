import {
  parseExpectedCount,
  selectSafeOrphanProductOptions,
  type OrphanProductOptionRow,
} from "./orphan-product-options"

const cutoff = new Date("2026-07-20T00:00:00.000Z")

const safeRow = (
  overrides: Partial<OrphanProductOptionRow> = {}
): OrphanProductOptionRow => ({
  activeValueCount: 2,
  activeVariantCount: 0,
  createdAt: new Date("2026-07-19T12:00:00.000Z"),
  deletedVariantCount: 1,
  optionId: "opt_orphan",
  productLinkCount: 0,
  title: "Format",
  ...overrides,
})

describe("historical orphan product option cleanup", () => {
  it("selects only audited historical orphan options", () => {
    expect(
      selectSafeOrphanProductOptions(
        [safeRow(), safeRow({ optionId: "opt_orphan_2" })],
        cutoff
      )
    ).toEqual({
      activeValueCount: 4,
      deleteIds: ["opt_orphan", "opt_orphan_2"],
      deletedVariantCount: 2,
    })
  })

  it.each([
    ["product-link history", { productLinkCount: 1 }],
    ["active variant", { activeVariantCount: 1 }],
    ["cleanup cutoff", { createdAt: cutoff }],
    ["Format option", { title: "Size" }],
  ] as const)("rejects a target with unsafe %s", (_label, overrides) => {
    expect(() =>
      selectSafeOrphanProductOptions([safeRow(overrides)], cutoff)
    ).toThrow("[catalog-option-orphans]")
  })

  it("parses an exact expected count for apply mode", () => {
    expect(parseExpectedCount(["--apply", "--expected-count=931"])).toBe(931)
    expect(parseExpectedCount([])).toBeUndefined()
    expect(() => parseExpectedCount(["--expected-count=1.5"])).toThrow(
      "non-negative integer"
    )
  })
})
