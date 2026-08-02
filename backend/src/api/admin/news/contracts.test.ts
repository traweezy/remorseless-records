import { newsCreateSchema, newsUpdateSchema } from "./contracts"

const baseCreate = {
  content: "<p>A label update.</p>",
  expectedVersion: 0 as const,
  idempotencyKey: "d8a102f4-c0da-4f50-b846-108503e26488",
  title: "Label update",
}

describe("News Admin contracts", () => {
  it("accepts web cover URLs", () => {
    expect(
      newsCreateSchema.safeParse({
        ...baseCreate,
        coverUrl: "https://cdn.example.com/news/cover.jpg",
      }).success
    ).toBe(true)
    expect(
      newsUpdateSchema.safeParse({
        coverUrl: "http://localhost:9000/static/news-cover.png",
        expectedVersion: 1,
        idempotencyKey: "b650e3d2-dccc-49f1-a55e-0dc6da2b7fd5",
      }).success
    ).toBe(true)
  })

  it("rejects non-web cover URL schemes", () => {
    expect(
      newsCreateSchema.safeParse({
        ...baseCreate,
        coverUrl: "ftp://cdn.example.com/news/cover.jpg",
      }).success
    ).toBe(false)
    expect(
      newsCreateSchema.safeParse({
        ...baseCreate,
        coverUrl: "data:image/png;base64,AAAA",
      }).success
    ).toBe(false)
    expect(
      newsCreateSchema.safeParse({
        ...baseCreate,
        coverUrl: "not a URL",
      }).success
    ).toBe(false)
  })
})
