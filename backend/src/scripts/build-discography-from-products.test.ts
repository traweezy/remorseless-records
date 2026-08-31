import { listAll } from "./build-discography-from-products"

describe("discography rebuild source pagination", () => {
  const readNumberId = (value: unknown): { id: number } => {
    if (
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      typeof value.id !== "number"
    ) {
      throw new Error("invalid record")
    }
    return { id: value.id }
  }

  it("loads exact stable pages to the declared count", async () => {
    const records = Array.from({ length: 201 }, (_, id) => ({ id }))
    const fetchPage = jest.fn(async (skip: number, take: number) => [
      records.slice(skip, skip + take),
      records.length,
    ])

    await expect(
      listAll<{ id: number }>(fetchPage, readNumberId)
    ).resolves.toEqual(records)
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 200)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 200, 200)
  })

  it.each([
    ["a malformed tuple", async () => [{ id: 1 }]],
    ["a non-integer count", async () => [[{ id: 1 }], "1"]],
    ["an excessive count", async () => [[], 100_001]],
    ["a short page", async () => [[{ id: 1 }], 2]],
  ])("rejects %s", async (_label, fetchPage) => {
    await expect(listAll(fetchPage, readNumberId)).rejects.toThrow(
      /Discography source pagination/u
    )
  })

  it("rejects count drift between pages", async () => {
    const firstPage = Array.from({ length: 200 }, (_, id) => ({ id }))
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce([firstPage, 201])
      .mockResolvedValueOnce([[{ id: 200 }], 202])

    await expect(listAll(fetchPage, readNumberId)).rejects.toThrow(
      "Discography source pagination changed during the rebuild."
    )
  })

  it("rejects duplicate identities across otherwise coherent pages", async () => {
    const records = Array.from({ length: 201 }, (_, id) => ({ id: String(id) }))
    records[200] = { id: "0" }

    await expect(
      listAll<{ id: string }>(
        async (skip, take) => [
          records.slice(skip, skip + take),
          records.length,
        ],
        (value) => {
          if (
            !value ||
            typeof value !== "object" ||
            !("id" in value) ||
            typeof value.id !== "string"
          ) {
            throw new Error("invalid record")
          }
          return { id: value.id }
        },
        ({ id }) => id
      )
    ).rejects.toThrow(
      "Discography source pagination returned duplicate identities."
    )
  })

  it("rejects malformed records before identity or projection work", async () => {
    await expect(
      listAll(async () => [[{ id: "wrong" }], 1], readNumberId)
    ).rejects.toThrow(
      "Discography source pagination returned invalid record data."
    )
  })
})
