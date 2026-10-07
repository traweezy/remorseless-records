import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import {
  guardNativeMediaHandler,
  guardNativeMediaOperation,
  nativeMediaMutationTargets,
  nativeProductMediaMutationTargets,
  type NativeMediaMutationRoute,
} from "./native-media-guard"

// Let Jest control the public delay/abort API's timers for deadline regressions.
jest.mock("node:timers/promises", () => ({
  setTimeout: (
    milliseconds: number,
    value: unknown,
    options?: { signal?: AbortSignal }
  ) =>
    new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        reject(new Error("Synthetic retry aborted"))
      }
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener("abort", abort)
        resolve(value)
      }, milliseconds)
      if (options?.signal?.aborted) abort()
      else options?.signal?.addEventListener("abort", abort, { once: true })
    }),
}))

const fixture = (
  body: Record<string, unknown>,
  params = { id: "prod_01", variant_id: "variant_01", image_id: "img_01" }
) => {
  const profiles = jest.fn().mockResolvedValue([])
  const media = jest.fn().mockResolvedValue([])
  const graph = jest.fn(
    async (input: {
      entity: string
      filters: { id: string[]; product_id?: string }
    }) => ({
      data: input.filters.id.map((id) => ({
        id,
        ...(input.filters.product_id
          ? { product_id: input.filters.product_id }
          : {}),
      })),
    })
  )
  const acquire = jest
    .fn<Promise<void>, [string, { ownerId: string; expire: number }]>()
    .mockResolvedValue(undefined)
  const release = jest
    .fn<Promise<boolean>, [string[], { ownerId: string }]>()
    .mockResolvedValue(true)
  const warn = jest.fn()
  const scope = {
    resolve: jest.fn((key: string) => {
      if (key === "catalog")
        return {
          listCatalogProductProfiles: profiles,
          listCatalogProductMediaItems: media,
        }
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      if (key === Modules.LOCKING) return { acquire, release }
      if (key === ContainerRegistrationKeys.LOGGER) return { warn }
      throw new Error("Unexpected fixture resolution")
    }),
  }
  const req = {
    headers: {},
    params,
    path: "/admin/products/prod_01",
    scope,
    validatedBody: body,
  } as unknown as MedusaRequest
  const res = {
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn(),
    type: jest.fn(),
  }
  res.status.mockReturnValue(res)
  res.type.mockReturnValue(res)
  const nativeHandler = jest.fn().mockResolvedValue(undefined)
  const run = (route: NativeMediaMutationRoute = "product") =>
    guardNativeMediaHandler(route, nativeHandler)(
      req,
      res as unknown as MedusaResponse
    )
  return {
    acquire,
    release,
    warn,
    graph,
    media,
    nativeHandler,
    profiles,
    req,
    res,
    run,
    scope,
  }
}

describe("native Catalog artwork boundary", () => {
  afterEach(() => jest.useRealTimers())

  it("uses a distinct UUID owner for each guarded operation", async () => {
    const f = fixture({ thumbnail: null })
    await f.run()
    await f.run()
    const owners = f.acquire.mock.calls.map(([, { ownerId }]) => ownerId)
    expect(new Set(owners).size).toBe(2)
    for (const owner of owners)
      expect(owner).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u)
    expect(f.release.mock.calls.map(([, { ownerId }]) => ownerId)).toEqual(
      owners
    )
  })

  it("cleans up a partial sorted acquisition before retrying only conflicts", async () => {
    jest.useFakeTimers()
    const f = fixture({
      update: [
        { id: "prod_02", thumbnail: null },
        { id: "prod_01", thumbnail: null },
      ],
    })
    f.acquire
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new MedusaError(MedusaError.Types.CONFLICT, "Held by another owner")
      )
    const running = f.run("products-batch")
    for (let i = 0; i < 20 && !f.release.mock.calls.length; i++)
      await Promise.resolve()
    expect(f.acquire.mock.calls.map(([key]) => key)).toEqual([
      "catalog:product-media:prod_01",
      "catalog:product-media:prod_02",
    ])
    expect(f.release).toHaveBeenCalledWith(
      ["catalog:product-media:prod_01", "catalog:product-media:prod_02"],
      { ownerId: f.acquire.mock.calls[0]![1].ownerId }
    )
    expect(f.nativeHandler).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(20)
    await running
    expect(f.acquire).toHaveBeenCalledTimes(4)
    expect(f.nativeHandler).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it("preserves a non-conflict acquisition error even when partial cleanup fails", async () => {
    const f = fixture({
      update: [
        { id: "prod_01", thumbnail: null },
        { id: "prod_02", thumbnail: null },
      ],
    })
    const failure = new Error("Isolated unavailable transport")
    f.acquire.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure)
    f.release.mockRejectedValue(new Error("Isolated cleanup transport"))
    await expect(f.run("products-batch")).rejects.toBe(failure)
    expect(f.acquire).toHaveBeenCalledTimes(2)
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.nativeHandler).not.toHaveBeenCalled()
    expect(f.warn).toHaveBeenCalledWith(
      expect.stringContaining("120-second lease")
    )
  })

  it("rejects an acquisition deadline and cleans up a late command without unlocking a later owner", async () => {
    jest.useFakeTimers()
    const f = fixture({
      update: [
        { id: "prod_01", thumbnail: null },
        { id: "prod_02", thumbnail: null },
      ],
    })
    const held = new Map<string, string>()
    let complete: () => void = () => undefined
    f.acquire.mockImplementation(async (key, { ownerId }) => {
      if (key.endsWith("prod_02"))
        await new Promise<void>((resolve) => {
          complete = resolve
        })
      held.set(key, ownerId)
    })
    f.release.mockImplementation(async (keys, { ownerId }) => {
      for (const key of keys) if (held.get(key) === ownerId) held.delete(key)
      return true
    })
    const running = f.run("products-batch")
    const rejected = expect(running).rejects.toMatchObject({
      type: MedusaError.Types.CONFLICT,
    })
    for (let i = 0; i < 20 && f.acquire.mock.calls.length < 2; i++)
      await Promise.resolve()
    await jest.advanceTimersByTimeAsync(120_000)
    await rejected
    expect(held.size).toBe(0)
    held.set("catalog:product-media:prod_01", "later-owner")
    complete()
    await jest.advanceTimersByTimeAsync(0)
    expect(held).toEqual(
      new Map([["catalog:product-media:prod_01", "later-owner"]])
    )
    expect(f.nativeHandler).not.toHaveBeenCalled()
    expect(f.graph).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it("bounds queued conflict retries without a native write or noisy ownership warnings", async () => {
    jest.useFakeTimers()
    const f = fixture({ thumbnail: null })
    f.acquire.mockRejectedValue(
      new MedusaError(MedusaError.Types.CONFLICT, "Owned fixture contention")
    )
    f.release.mockResolvedValue(false)
    const rejected = expect(f.run()).rejects.toMatchObject({
      type: MedusaError.Types.CONFLICT,
      message: "Timed-out acquiring lock.",
    })
    await jest.advanceTimersByTimeAsync(120_000)
    await rejected
    expect(f.acquire.mock.calls.length).toBeGreaterThan(1)
    expect(
      new Set(f.acquire.mock.calls.map(([, { ownerId }]) => ownerId)).size
    ).toBe(1)
    expect(f.nativeHandler).not.toHaveBeenCalled()
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.warn).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it("does not retry a partial conflict while its exact-owner cleanup remains in flight", async () => {
    jest.useFakeTimers()
    const f = fixture({
      update: [
        { id: "prod_01", thumbnail: null },
        { id: "prod_02", thumbnail: null },
      ],
    })
    const conflict = new MedusaError(
      MedusaError.Types.CONFLICT,
      "Other writer owns the second Product"
    )
    f.acquire.mockResolvedValueOnce(undefined).mockRejectedValueOnce(conflict)
    f.release.mockImplementation(() => new Promise<boolean>(() => {}))
    const rejected = expect(f.run("products-batch")).rejects.toBe(conflict)
    for (let i = 0; i < 20 && !f.release.mock.calls.length; i++)
      await Promise.resolve()
    await jest.advanceTimersByTimeAsync(2_000)
    await rejected
    expect(f.acquire).toHaveBeenCalledTimes(2)
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.nativeHandler).not.toHaveBeenCalled()
    expect(f.warn).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each(["false", "throw", "logger-throw"])(
    "preserves completed native success when cleanup=%s",
    async (failure) => {
      const f = fixture({ thumbnail: null })
      if (failure === "false") f.release.mockResolvedValue(false)
      else f.release.mockRejectedValue(new Error("Isolated cleanup failure"))
      if (failure === "logger-throw")
        f.warn.mockImplementation(() => {
          throw new Error("Isolated logging failure")
        })
      await expect(f.run()).resolves.toBeUndefined()
      expect(f.nativeHandler).toHaveBeenCalledTimes(1)
      expect(f.warn).toHaveBeenCalledTimes(1)
      expect(f.warn.mock.calls[0]![0]).not.toContain("prod_01")
    }
  )

  it("bounds stalled release after native success and preserves the original native failure", async () => {
    jest.useFakeTimers()
    const f = fixture({ thumbnail: null })
    f.release.mockImplementation(() => new Promise<boolean>(() => {}))
    const completed = f.run()
    for (let i = 0; i < 30 && !f.release.mock.calls.length; i++)
      await Promise.resolve()
    await jest.advanceTimersByTimeAsync(2_000)
    await expect(completed).resolves.toBeUndefined()
    expect(f.warn).toHaveBeenCalledTimes(1)
    const failure = new Error("Original native workflow failure")
    f.nativeHandler.mockRejectedValueOnce(failure)
    f.release.mockRejectedValueOnce(
      new Error("Cleanup must not replace native error")
    )
    await expect(f.run()).rejects.toBe(failure)
    expect(jest.getTimerCount()).toBe(0)
  })
  it.each([
    ["product", { thumbnail: "https://example.test/a.jpg" }],
    ["product", { thumbnail: null }],
    ["product", { thumbnail: "" }],
    ["product", { variants: [{ id: "variant_01", thumbnail: null }] }],
    ["product", { variants: [{ title: "New", thumbnail: null }] }],
    ["products-batch", { update: [{ id: "prod_01", thumbnail: null }] }],
    [
      "products-batch",
      {
        update: [
          { id: "prod_01", variants: [{ id: "variant_01", thumbnail: null }] },
        ],
      },
    ],
    [
      "products-batch",
      {
        update: [
          { id: "prod_01", variants: [{ title: "New", thumbnail: null }] },
        ],
      },
    ],
    ["variant", { thumbnail: null }],
    ["variants-batch", { update: [{ id: "variant_01", thumbnail: null }] }],
    ["variant-images", { remove: ["img_01"] }],
    ["image-variants", { remove: ["variant_01"] }],
  ] satisfies [NativeMediaMutationRoute, Record<string, unknown>][])(
    "rejects managed %s artwork writes including implicit clears",
    async (route, body) => {
      const f = fixture(body)
      f.profiles.mockResolvedValue([
        { id: "cprof_01", product_id: "prod_01", version: 1 },
      ])
      await f.run(route)
      expect(f.nativeHandler).not.toHaveBeenCalled()
      expect(f.res.status).toHaveBeenCalledWith(409)
      expect(f.res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "catalog_media_authoring_required",
        })
      )
      expect(f.acquire).toHaveBeenCalledWith("catalog:product-media:prod_01", {
        ownerId: expect.any(String),
        expire: 120,
        awaitQueue: false,
      })
      expect(f.release).toHaveBeenCalledWith(
        ["catalog:product-media:prod_01"],
        { ownerId: f.acquire.mock.calls[0]![1].ownerId }
      )
    }
  )

  it("keeps linked media authoritative even without a profile", async () => {
    const f = fixture({ thumbnail: null })
    f.media.mockResolvedValue([{ id: "cpmedia_01", product_id: "prod_01" }])
    await f.run()
    expect(f.res.status).toHaveBeenCalledWith(409)
    expect(f.nativeHandler).not.toHaveBeenCalled()
  })

  it("allows unmanaged thumbnails with exact native request and response", async () => {
    const f = fixture({ thumbnail: "https://example.test/legacy.jpg" })
    await f.run()
    expect(f.nativeHandler).toHaveBeenCalledWith(f.req, f.res)
    expect(f.res.status).not.toHaveBeenCalled()
  })

  it("allows a new unmanaged nested Variant while validating its actual parent", async () => {
    const f = fixture({ variants: [{ title: "New", thumbnail: null }] })
    await f.run()
    expect(f.graph).toHaveBeenCalledTimes(1)
    expect(f.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product",
        filters: { id: ["prod_01"] },
      })
    )
    expect(f.nativeHandler).toHaveBeenCalledWith(f.req, f.res)
  })

  it("exposes the awaited ownership operation without an invented request body", async () => {
    const f = fixture({})
    const targets = nativeProductMediaMutationTargets([
      { id: "prod_01", thumbnail: null },
    ])
    const operation = jest.fn().mockResolvedValue({ updated: 1 })
    const result = await guardNativeMediaOperation(
      f.req,
      f.res as unknown as MedusaResponse,
      targets,
      operation
    )
    expect(result).toEqual({ executed: true, value: { updated: 1 } })
    f.profiles.mockResolvedValue([
      { id: "cprof_01", product_id: "prod_01", version: 1 },
    ])
    operation.mockClear()
    expect(
      await guardNativeMediaOperation(
        f.req,
        f.res as unknown as MedusaResponse,
        targets,
        operation
      )
    ).toEqual({ executed: false })
    expect(operation).not.toHaveBeenCalled()
  })

  it.each([
    "products-batch",
    "variants-batch",
  ] satisfies NativeMediaMutationRoute[])(
    "rejects %s hard deletion before any native or ownership work",
    async (route) => {
      const f = fixture({
        delete: [route === "products-batch" ? "prod_02" : "variant_foreign"],
      })
      await f.run(route)
      expect(f.res.status).toHaveBeenCalledWith(409)
      expect(f.res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "catalog_hard_deletion_disabled",
        })
      )
      expect(f.nativeHandler).not.toHaveBeenCalled()
      expect(f.scope.resolve).not.toHaveBeenCalled()
      expect(f.acquire).not.toHaveBeenCalled()
    }
  )

  it.each([
    "products-batch",
    "variants-batch",
  ] satisfies NativeMediaMutationRoute[])(
    "preserves %s empty deletions and fails closed on a malformed list",
    async (route) => {
      const f = fixture({ delete: [], update: [] })
      await f.run(route)
      expect(f.nativeHandler).toHaveBeenCalledWith(f.req, f.res)
      f.req.validatedBody = { delete: "variant_foreign" }
      f.nativeHandler.mockClear()
      await expect(f.run(route)).rejects.toThrow()
      expect(f.nativeHandler).not.toHaveBeenCalled()
    }
  )

  it.each([
    [
      "product",
      { title: "Title", images: [{ url: "https://example.test/legacy.jpg" }] },
    ],
    [
      "product",
      {
        variants: [
          {
            id: "variant_01",
            prices: [{ amount: 1234, currency_code: "usd" }],
          },
        ],
      },
    ],
    [
      "products-batch",
      {
        update: [{ id: "prod_01", title: "Title" }],
        create: [{ title: "New", thumbnail: "https://example.test/new.jpg" }],
      },
    ],
    ["variant", { sku: "sku" }],
    ["variants-batch", { update: [{ id: "variant_01", title: "Title" }] }],
    ["variant-images", { add: ["img_01"], remove: [] }],
    ["image-variants", { add: ["variant_01"], remove: [] }],
  ] satisfies [NativeMediaMutationRoute, Record<string, unknown>][])(
    "leaves ordinary %s edits to native validation/RBAC without ownership reads",
    async (route, body) => {
      const f = fixture(body)
      await f.run(route)
      expect(f.nativeHandler).toHaveBeenCalledWith(f.req, f.res)
      expect(f.scope.resolve).not.toHaveBeenCalled()
    }
  )

  it("denies a mixed native batch before any partial write", async () => {
    const f = fixture({
      update: [
        { id: "prod_02", thumbnail: null },
        { id: "prod_01", thumbnail: null },
      ],
    })
    f.profiles
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "cprof_02", product_id: "prod_02", version: 2 },
      ])
    await f.run("products-batch")
    expect(f.acquire.mock.calls.map(([key]) => key)).toEqual([
      "catalog:product-media:prod_01",
      "catalog:product-media:prod_02",
    ])
    expect(f.nativeHandler).not.toHaveBeenCalled()
  })

  it.each([
    [{ id: "cprof_01", product_id: "prod_other", version: 1 }],
    [{ id: "cprof_01", product_id: "prod_01", version: 0 }],
    [{ id: "cprof_01", product_id: "prod_01", version: "1" }],
    [{ id: "wrong_01", product_id: "prod_01", version: 1 }],
    [null],
    [
      { id: "cprof_01", product_id: "prod_01", version: 1 },
      { id: "cprof_02", product_id: "prod_01", version: 1 },
    ],
  ])(
    "fails closed on ambiguous or malformed profile ownership %j",
    async (...rows) => {
      const f = fixture({ thumbnail: null })
      f.profiles.mockResolvedValue(rows)
      await expect(f.run()).rejects.toThrow()
      expect(f.nativeHandler).not.toHaveBeenCalled()
    }
  )

  it("fails closed on unavailable Catalog or locking services", async () => {
    const f = fixture({ thumbnail: null })
    f.profiles.mockRejectedValue(new Error("Unavailable fixture"))
    await expect(f.run()).rejects.toThrow()
    expect(f.nativeHandler).not.toHaveBeenCalled()
    f.acquire.mockRejectedValue(new Error("Unavailable lock"))
    await expect(f.run()).rejects.toThrow()
    expect(f.nativeHandler).not.toHaveBeenCalled()
  })

  it.each([
    { id: "cpmedia_01", product_id: "prod_other" },
    { id: "wrong_01", product_id: "prod_01" },
    { id: "cpmedia_01", product_id: undefined },
  ])("fails closed on malformed media ownership %j", async (row) => {
    const f = fixture({ thumbnail: null })
    f.media.mockResolvedValue([row])
    await expect(f.run()).rejects.toThrow()
    expect(f.nativeHandler).not.toHaveBeenCalled()
  })

  it("rejects duplicate native identities before ownership or writes", async () => {
    const f = fixture({ thumbnail: null })
    f.graph.mockResolvedValueOnce({
      data: [{ id: "prod_01" }, { id: "prod_01" }],
    })
    await expect(f.run()).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
    })
    expect(f.profiles).not.toHaveBeenCalled()
    expect(f.nativeHandler).not.toHaveBeenCalled()
  })

  it.each([
    "variant",
    "variant-images",
    "image-variants",
  ] satisfies NativeMediaMutationRoute[])(
    "verifies the actual parent before %s mutations",
    async (route) => {
      const f = fixture(
        route === "variant"
          ? { thumbnail: null }
          : {
              remove: [route === "variant-images" ? "img_01" : "variant_01"],
            }
      )
      f.graph
        .mockResolvedValueOnce({ data: [{ id: "prod_01" }] })
        .mockResolvedValueOnce({
          data: [{ id: "variant_01", product_id: "prod_other" }],
        })
      await expect(f.run(route)).rejects.toMatchObject({
        type: MedusaError.Types.UNEXPECTED_STATE,
      })
      expect(f.nativeHandler).not.toHaveBeenCalled()
    }
  )

  it("verifies removed image membership and rejects missing identities", async () => {
    const f = fixture({ remove: ["img_01"] })
    f.graph
      .mockResolvedValueOnce({ data: [{ id: "prod_01" }] })
      .mockResolvedValueOnce({
        data: [{ id: "variant_01", product_id: "prod_01" }],
      })
      .mockResolvedValueOnce({ data: [] })
    await expect(f.run("variant-images")).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(f.nativeHandler).not.toHaveBeenCalled()
  })

  it("rechecks ownership under the acquired lock", async () => {
    const f = fixture({ thumbnail: null })
    f.acquire.mockImplementation(async () => {
      f.profiles.mockResolvedValue([
        { id: "cprof_01", product_id: "prod_01", version: 1 },
      ])
    })
    await f.run()
    expect(f.nativeHandler).not.toHaveBeenCalled()
    expect(f.res.status).toHaveBeenCalledWith(409)
  })

  it("bounds relevant mutation targets without limiting unrelated updates", () => {
    const f = fixture({
      update: Array.from({ length: 101 }, (_, index) => ({
        id: `prod_${index}`,
        thumbnail: null,
      })),
    })
    expect(() => nativeMediaMutationTargets(f.req, "products-batch")).toThrow()
    f.req.validatedBody = {
      update: Array.from({ length: 101 }, (_, index) => ({
        id: `prod_${index}`,
        title: "Title",
      })),
    }
    expect(nativeMediaMutationTargets(f.req, "products-batch")).toEqual([])
  })
})
