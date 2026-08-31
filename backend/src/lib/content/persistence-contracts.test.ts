import { serializeNewsEntry } from "@/modules/news/serializers"

import {
  readAdminDiscographyMutation,
  readAdminDiscographyPage,
  readAdminNewsMutation,
  readAdminNewsPage,
  readContentOperationList,
  readContentOperationMutation,
  readDiscographyOperationResult,
  readExactNewsOperationResult,
} from "./persistence-contracts"

const INVALID_PERSISTENCE =
  "The Admin content persistence boundary returned invalid structured data."
const idempotencyKey = "57fb5c69-d829-47c3-a877-19c15add6137"
const requestSha256 = "a".repeat(64)

const news = (overrides: Record<string, unknown> = {}) => ({
  archived_at: null,
  author: "Ada Admin",
  content: "<p>Update</p>",
  cover_alt_text: "News artwork",
  cover_url: "https://media.example/news.jpg",
  created_at: "2026-08-01T00:00:00.000Z",
  excerpt: "Update",
  id: "news_1",
  published_at: null,
  seo_description: "Update",
  seo_title: "Update",
  slug: "update",
  status: "draft",
  tags: ["Studio"],
  title: "Update",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
  ...overrides,
})

const discography = (overrides: Record<string, unknown> = {}) => ({
  album: "Release",
  archived_at: null,
  artist: "Artist",
  availability: "in_print",
  catalog_number: "RR-001",
  collection_title: "Collection",
  cover_alt_text: "Release artwork",
  cover_url: "https://media.example/release.jpg",
  created_at: "2026-08-01T00:00:00.000Z",
  formats: ["Vinyl"],
  genres: ["Metal"],
  id: "disc_1",
  product_handle: null,
  product_id: null,
  release_date: "2026-08-01T00:00:00.000Z",
  release_year: 2026,
  source_mode: "manual",
  tags: ["Featured"],
  title: "Release",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
  ...overrides,
})

const operation = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  actor_id: "user_admin",
  aggregate_id: "news_1",
  command: "news.entry.update",
  completed_at: null,
  expected_version: 1,
  id: "newsop_1",
  idempotency_key: idempotencyKey,
  metadata: {},
  request_sha256: requestSha256,
  result: {},
  status: "pending",
  ...overrides,
})

describe("Admin content persistence contracts", () => {
  it("accepts exact counted News and Discography pages", () => {
    expect(readAdminNewsPage([[news()], 3], 25)).toMatchObject({
      count: 3,
      records: [{ id: "news_1", slug: "update" }],
    })
    expect(readAdminDiscographyPage([[discography()], 1], 25)).toMatchObject({
      count: 1,
      records: [{ id: "disc_1", source_mode: "manual" }],
    })
  })

  it.each([
    ["a short counted page", [[news()], 0]],
    ["duplicate News slugs", [[news(), news({ id: "news_2" })], 2]],
    [
      "unsafe stored rich text",
      [[news({ content: "<p>Visible</p><script>hidden()</script>" })], 1],
    ],
    [
      "an incoherent draft publication",
      [[news({ published_at: "2026-08-01T00:00:00.000Z" })], 1],
    ],
    ["an invalid slug", [[news({ slug: " Update " })], 1]],
    [
      "cover artwork without alternative text",
      [[news({ cover_alt_text: null })], 1],
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => readAdminNewsPage(value, 25)).toThrow(INVALID_PERSISTENCE)
  })

  it.each([
    [
      "a linked row without a Product handle",
      [
        [
          discography({
            product_id: "prod_1",
            source_mode: "catalog_product",
          }),
        ],
        1,
      ],
    ],
    [
      "an inconsistent release year",
      [[discography({ release_year: 2025 })], 1],
    ],
    [
      "an unsafe cover protocol",
      [[discography({ cover_url: "file:///tmp/cover.jpg" })], 1],
    ],
    [
      "cover artwork without alternative text",
      [[discography({ cover_alt_text: null })], 1],
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => readAdminDiscographyPage(value, 25)).toThrow(
      INVALID_PERSISTENCE
    )
  })

  it("requires exact mutation identity and version acknowledgements", () => {
    expect(readAdminNewsMutation([news()], { version: 1 }).id).toBe("news_1")
    expect(
      readAdminDiscographyMutation([discography({ version: 2 })], {
        id: "disc_1",
        version: 2,
      }).id
    ).toBe("disc_1")
    expect(() =>
      readAdminNewsMutation([news({ version: 2 })], {
        id: "news_1",
        version: 1,
      })
    ).toThrow(INVALID_PERSISTENCE)
  })

  it("validates pending and succeeded operation transitions", () => {
    expect(readContentOperationList([operation()], "news")?.id).toBe("newsop_1")
    const expected = {
      actorId: "user_admin",
      aggregateId: "news_1",
      command: "news.entry.update",
      expectedVersion: 1,
      idempotencyKey,
      kind: "news" as const,
      requestSha256,
      status: "succeeded" as const,
    }
    expect(
      readContentOperationMutation(
        operation({
          completed_at: "2026-08-02T00:00:00.000Z",
          result: { entryId: "news_1" },
          status: "succeeded",
        }),
        expected
      ).status
    ).toBe("succeeded")
  })

  it.each([
    ["duplicate operation rows", [operation(), operation({ id: "newsop_2" })]],
    [
      "a nonempty pending result",
      [operation({ result: { entryId: "news_1" } })],
    ],
    ["a malformed request digest", [operation({ request_sha256: "invalid" })]],
  ])("rejects %s", (_label, value) => {
    expect(() => readContentOperationList(value, "news")).toThrow(
      INVALID_PERSISTENCE
    )
  })

  it("validates exact stored News and Discography replay results", () => {
    const record = readAdminNewsMutation([news()], { version: 1 })
    const dto = serializeNewsEntry(record)
    expect(
      readExactNewsOperationResult(
        { entry: dto, entryId: dto.id, version: dto.version },
        dto
      )
    ).toEqual(dto)
    expect(
      readDiscographyOperationResult({ entryId: "disc_1", version: 2 })
    ).toEqual({ entryId: "disc_1", version: 2 })
    expect(() =>
      readExactNewsOperationResult(
        {
          entry: { ...dto, title: "Tampered" },
          entryId: dto.id,
          version: dto.version,
        },
        dto
      )
    ).toThrow(INVALID_PERSISTENCE)
    expect(() =>
      readExactNewsOperationResult(
        {
          entry: { ...dto, slug: "Invalid Slug" },
          entryId: dto.id,
          version: dto.version,
        },
        { ...dto, slug: "Invalid Slug" }
      )
    ).toThrow(INVALID_PERSISTENCE)
    expect(() =>
      readDiscographyOperationResult({
        entryId: "disc_1",
        internal: true,
        version: 2,
      })
    ).toThrow(INVALID_PERSISTENCE)
  })
})
