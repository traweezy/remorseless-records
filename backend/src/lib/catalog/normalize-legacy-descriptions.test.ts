import { normalizeLegacyCatalogDescriptions } from "./normalize-legacy-descriptions"

describe("legacy catalog description migration guards", () => {
  it.each([
    { id: "unexpected", description_html: "<p>Safe</p>", version: 1 },
    { id: "cprof_fixture", description_html: 42, version: 1 },
    { id: "cprof_fixture", description_html: "x".repeat(250_001), version: 1 },
    { id: "cprof_fixture", description_html: null, version: 0 },
    {
      id: "cprof_fixture",
      description_html: null,
      version: Number.MAX_SAFE_INTEGER,
    },
  ])("rejects invalid persisted data before writing", async (row) => {
    const execute = jest.fn().mockResolvedValue([row])
    await expect(normalizeLegacyCatalogDescriptions(execute)).rejects.toThrow(
      "invalid data"
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("refuses oversized pages before issuing writes", async () => {
    const execute = jest.fn().mockResolvedValue(
      Array.from({ length: 201 }, (_, index) => ({
        id: `cprof_${index}`,
        description_html: null,
        version: 1,
      }))
    )
    await expect(normalizeLegacyCatalogDescriptions(execute)).rejects.toThrow(
      "row bound"
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it.each([
    { acknowledgement: [] },
    { acknowledgement: [{ id: "cprof_different", version: 2 }] },
    { acknowledgement: [{ id: "cprof_fixture", version: 1 }] },
  ])(
    "rejects missing or contradictory write acknowledgement",
    async ({ acknowledgement }) => {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "cprof_fixture",
            description_html: '<p style="color:red">Keep</p>',
            version: 1,
          },
        ])
        .mockResolvedValueOnce(acknowledgement)
      await expect(normalizeLegacyCatalogDescriptions(execute)).rejects.toThrow(
        "not acknowledged"
      )
    }
  )
})
