import {
  assertCandidateIndexName,
  createMeilisearchAdminClient,
  selectStaleCandidateIndexes,
} from "./meilisearch-admin-client"

describe("Meilisearch admin client", () => {
  it("submits an authenticated atomic index swap", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ taskUid: 42 }), {
        headers: { "Content-Type": "application/json" },
        status: 202,
      })
    )
    const client = createMeilisearchAdminClient({
      apiKey: "test-admin-key",
      fetchImpl,
      host: "https://search.example.test",
    })

    await expect(
      client.swapIndexes("products", "products_build_20260727t001122z_deadbeef")
    ).resolves.toEqual({ taskUid: 42 })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://search.example.test/swap-indexes"),
      expect.objectContaining({
        body: JSON.stringify([
          {
            indexes: ["products", "products_build_20260727t001122z_deadbeef"],
          },
        ]),
        headers: expect.objectContaining({
          Authorization: "Bearer test-admin-key",
        }),
        method: "POST",
      })
    )
  })

  it("rejects unsafe live and candidate index names", async () => {
    expect(() => assertCandidateIndexName("products")).toThrow(
      "Candidate index must match"
    )
    const client = createMeilisearchAdminClient({
      apiKey: "test-admin-key",
      fetchImpl: jest.fn(),
      host: "https://search.example.test",
    })

    await expect(
      client.swapIndexes(
        "products_preview",
        "products_build_20260727t001122z_deadbeef"
      )
    ).rejects.toThrow("Live index must be 'products'")
  })

  it("selects only candidates older than the stability period", () => {
    const now = new Date("2026-07-27T12:00:00.000Z")
    const selected = selectStaleCandidateIndexes({
      indexes: [
        {
          createdAt: "2026-07-10T12:00:00.000Z",
          uid: "products_build_20260710t120000000z_old",
        },
        {
          createdAt: "2026-07-27T11:00:00.000Z",
          uid: "products_build_20260727t110000000z_recent",
        },
        {
          createdAt: "2026-07-01T12:00:00.000Z",
          uid: "products",
        },
        {
          createdAt: "2026-07-01T12:00:00.000Z",
          uid: "unrelated_index",
        },
        {
          createdAt: "2020-01-01T00:00:00.000Z",
          uid: "products_build_without_timestamp",
        },
      ],
      now,
      protectedIndexes: new Set([
        "products_build_20260701t120000000z_protected",
      ]),
      stabilityPeriodMs: 7 * 24 * 60 * 60 * 1_000,
    })

    expect(selected).toEqual(["products_build_20260710t120000000z_old"])
  })

  it("redacts no credentials into an HTTP failure", async () => {
    const client = createMeilisearchAdminClient({
      apiKey: "secret-key",
      fetchImpl: jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "not allowed" }), {
          status: 403,
        })
      ),
      host: "https://search.example.test",
    })

    await expect(client.listIndexes()).rejects.toThrow(
      "Admin request GET /indexes?limit=1000 failed (403)"
    )
    await expect(client.listIndexes()).rejects.not.toThrow("secret-key")
  })

  it("rejects malformed task and index projections", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ taskUid: "not-an-integer" }), {
          status: 202,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                createdAt: "not-a-timestamp",
                uid: "products_build_20260831_invalid",
              },
            ],
          }),
          { status: 200 }
        )
      )
    const client = createMeilisearchAdminClient({
      apiKey: "test-admin-key",
      fetchImpl,
      host: "https://search.example.test",
    })

    await expect(
      client.deleteIndex("products_build_20260831_invalid")
    ).rejects.toThrow("malformed structured data")
    await expect(client.listIndexes()).rejects.toThrow(
      "malformed structured data"
    )
  })
})
