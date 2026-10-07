import { EventEmitter } from "node:events"
import path from "node:path"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ILockingModule } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type NativePost = (req: MedusaRequest, res: MedusaResponse) => Promise<void>
type Schema = { parse: (input: unknown) => Record<string, unknown> }

const medusaDirectory = path.dirname(require.resolve("@medusajs/medusa"))
const frameworkDirectory = path.dirname(require.resolve("@medusajs/framework"))
const workflowRun = jest.fn()
const cases = [
  ["[id]", "AdminUpdateProduct", { thumbnail: null }, "updateProductsWorkflow"],
  [
    "batch",
    "AdminBatchProduct",
    { update: [{ id: "prod_01", thumbnail: null }] },
    "batchProductsWorkflow",
  ],
  [
    "[id]/variants/[variant_id]",
    "AdminUpdateProductVariant",
    { thumbnail: null },
    "updateProductVariantsWorkflow",
  ],
  [
    "[id]/variants/batch",
    "AdminBatchProductVariant",
    { update: [{ id: "variant_01", thumbnail: null }] },
    "batchProductVariantsWorkflow",
  ],
  [
    "[id]/variants/[variant_id]/images/batch",
    "AdminBatchVariantImages",
    { remove: ["img_01"] },
    "batchVariantImagesWorkflow",
  ],
  [
    "[id]/images/[image_id]/variants/batch",
    "AdminBatchImageVariant",
    { remove: ["variant_01"] },
    "batchImageVariantsWorkflow",
  ],
] as const

const setup = (
  relative: string,
  schemaName: string,
  body: unknown,
  workflowName: string
) => {
  const run = workflowRun
    .mockReset()
    .mockResolvedValue({ result: [{ id: "prod_01" }] })
  const nativeWorkflows = Object.fromEntries(
    cases.map(([, , , name]) => [name, jest.fn(() => ({ run }))])
  )
  if (!(workflowName in nativeWorkflows))
    throw new Error("Unknown native workflow fixture")
  jest.doMock("@medusajs/core-flows", () => nativeWorkflows)
  jest.doMock("@medusajs/framework/http", () => ({
    ...jest.requireActual<Record<string, unknown>>("@medusajs/framework/http"),
    refetchEntity: jest.fn().mockResolvedValue({ id: "prod_01" }),
  }))
  jest.doMock(
    path.join(medusaDirectory, "api/admin/products/helpers.js"),
    () => ({
      refetchBatchProducts: jest
        .fn()
        .mockResolvedValue({ created: [], updated: [], deleted: [] }),
      refetchBatchVariants: jest
        .fn()
        .mockResolvedValue({ created: [], updated: [], deleted: [] }),
      remapKeysForProduct: jest.fn(() => ["id"]),
      remapProductResponse: jest.fn((value: unknown) => value),
      remapVariantResponse: jest.fn((value: unknown) => value),
    })
  )
  const validators = jest.requireActual<
    Record<string, Schema | (() => Schema)>
  >(path.join(medusaDirectory, "api/admin/products/validators.js"))
  const { createBatchBody } = jest.requireActual<{
    createBatchBody: (create: Schema, update: Schema) => Schema
  }>(path.join(medusaDirectory, "api/utils/validators.js"))
  const schemaFor = (name: string): Schema => {
    const value = validators[name]
    if (!value) throw new Error(`Missing pinned native schema ${name}`)
    return typeof value === "function" ? value() : value
  }
  const schema =
    schemaName === "AdminBatchProduct"
      ? createBatchBody(
          schemaFor("CreateProduct"),
          schemaFor("AdminBatchUpdateProduct")
        )
      : schemaName === "AdminBatchProductVariant"
        ? createBatchBody(
            schemaFor("CreateProductVariant"),
            schemaFor("AdminBatchUpdateProductVariant")
          )
        : schemaFor(schemaName)
  if (!schema) throw new Error(`Missing pinned native schema ${schemaName}`)
  const profiles = jest.fn().mockResolvedValue([])
  const media = jest.fn().mockResolvedValue([])
  const graph = jest.fn(
    async (input: {
      entity: string
      filters: { id: string | string[]; product_id?: string }
    }) => ({
      data: (Array.isArray(input.filters.id)
        ? input.filters.id
        : [input.filters.id]
      ).map((id) => ({
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
      if (key === ContainerRegistrationKeys.FEATURE_FLAG_ROUTER)
        return { isFeatureEnabled: () => true }
      if (key === Modules.CACHING) return undefined
      if (key === Modules.LOCKING) return { acquire, release }
      if (key === ContainerRegistrationKeys.LOGGER) return { warn }
      throw new Error("Unexpected native fixture resolution")
    }),
  }
  const req = {
    auth_context: { app_metadata: { roles: ["role_writer"] } },
    headers: {},
    params: { id: "prod_01", variant_id: "variant_01", image_id: "img_01" },
    path: "/admin/products/prod_01",
    queryConfig: { fields: ["id"] },
    scope,
    validatedBody: schema.parse(body),
  } as unknown as MedusaRequest
  const res = Object.assign(new EventEmitter(), {
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn(),
    type: jest.fn(),
  })
  res.status.mockReturnValue(res)
  res.type.mockReturnValue(res)
  const project = jest.requireActual<{ POST: NativePost }>(
    path.join(__dirname, "../../api/admin/products", relative, "route.ts")
  )
  return {
    acquire,
    release,
    warn,
    graph,
    post: project.POST,
    profiles,
    req,
    res,
    run,
    scope,
  }
}

describe("guarded pinned native Medusa handlers", () => {
  it.each([
    ["[id]", "AdminUpdateProduct", "updateProductsWorkflow"],
    ["batch", "AdminBatchProduct", "batchProductsWorkflow"],
  ])(
    "guards new nested Variant artwork on installed %s without requiring an ID",
    async (relative, schema, workflow) => {
      const variant = {
        title: "New",
        prices: [],
        thumbnail: "https://example.test/new.webp",
      }
      const body =
        relative === "batch"
          ? { update: [{ id: "prod_01", variants: [variant] }] }
          : { variants: [variant] }
      const f = setup(relative, schema, body, workflow)
      expect(f.req.validatedBody).toMatchObject(body)
      f.profiles.mockResolvedValue([
        { id: "cprof_01", product_id: "prod_01", version: 1 },
      ])
      await f.post(f.req, f.res as unknown as MedusaResponse)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.res.status).toHaveBeenCalledWith(409)
      expect(f.graph).toHaveBeenCalledTimes(1)
      expect(f.graph).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "product" })
      )

      f.profiles.mockResolvedValue([])
      await f.post(f.req, f.res as unknown as MedusaResponse)
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.run).toHaveBeenCalledWith(
        relative === "batch"
          ? {
              input: { update: [{ id: "prod_01", variants: [variant] }] },
            }
          : {
              input: {
                selector: { id: "prod_01" },
                update: { variants: [variant] },
                additional_data: undefined,
              },
            }
      )
    }
  )

  it("retains installed native creation rejection rather than dropping thumbnails", () => {
    const validators = jest.requireActual<
      Record<string, Schema | (() => Schema)>
    >(path.join(medusaDirectory, "api/admin/products/validators.js"))
    const schema = (name: string): Schema => {
      const value = validators[name]
      if (!value) throw new Error(`Missing pinned native schema ${name}`)
      return typeof value === "function" ? value() : value
    }
    const variant = { title: "New", prices: [], thumbnail: null }
    expect(() => schema("AdminCreateProductVariant").parse(variant)).toThrow()
    const { createBatchBody } = jest.requireActual<{
      createBatchBody: (create: Schema, update: Schema) => Schema
    }>(path.join(medusaDirectory, "api/utils/validators.js"))
    expect(() =>
      createBatchBody(
        schema("CreateProductVariant"),
        schema("AdminBatchUpdateProductVariant")
      ).parse({ create: [variant] })
    ).toThrow()
  })

  it.each([
    ["batch", "AdminBatchProduct", "prod_01", "batchProductsWorkflow"],
    [
      "[id]/variants/batch",
      "AdminBatchProductVariant",
      "variant_foreign",
      "batchProductVariantsWorkflow",
    ],
  ])(
    "rejects installed %s POST delete payloads before any workflow",
    async (relative, schema, targetId, workflow) => {
      const f = setup(relative, schema, { delete: [targetId] }, workflow)
      expect(f.req.validatedBody).toMatchObject({ delete: [targetId] })
      await f.post(f.req, f.res as unknown as MedusaResponse)
      expect(f.res.status).toHaveBeenCalledWith(409)
      expect(f.res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "catalog_hard_deletion_disabled" })
      )
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
      expect(f.acquire).not.toHaveBeenCalled()

      f.req.validatedBody = { delete: [], update: [] }
      await f.post(f.req, f.res as unknown as MedusaResponse)
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.res.status).toHaveBeenLastCalledWith(200)
    }
  )

  it.each(cases)(
    "mounts only POST for %s with native authentication and Admin CORS",
    async (relative, schema, body, workflow) => {
      const f = setup(relative, schema, body, workflow)
      type Route = {
        handler: NativePost
        matcher: string
        method: string
        optedOutOfAuth: boolean
        shouldAppendAdminCors: boolean
      }
      const { RoutesLoader } = jest.requireActual<{
        RoutesLoader: new () => {
          reloadRouteFile: (file: string, sourceDir: string) => Promise<Route[]>
          getRoutes: () => Route[]
        }
      }>(path.join(frameworkDirectory, "http/routes-loader.js"))
      const loader = new RoutesLoader()
      const native = await loader.reloadRouteFile(
        path.join(medusaDirectory, "api/admin/products", relative, "route.js"),
        path.join(medusaDirectory, "api")
      )
      const project = await loader.reloadRouteFile(
        path.join(__dirname, "../../api/admin/products", relative, "route.ts"),
        path.join(__dirname, "../../api")
      )
      expect(project).toEqual([
        expect.objectContaining({
          handler: f.post,
          matcher: native[0]?.matcher,
          method: "POST",
          optedOutOfAuth: false,
          shouldAppendAdminCors: true,
        }),
      ])
      const mounted = loader.getRoutes()
      expect(mounted).toHaveLength(native.length)
      expect(mounted.find(({ method }) => method === "POST")?.handler).toBe(
        f.post
      )
      for (const original of native.filter(({ method }) => method !== "POST")) {
        expect(
          mounted.find(({ method }) => method === original.method)?.handler
        ).toBe(original.handler)
      }
    }
  )

  it.each(cases)(
    "delegates unmanaged %s with native validation and workflow semantics",
    async (relative, schema, body, workflow) => {
      const f = setup(relative, schema, body, workflow)
      await f.post(f.req, f.res as unknown as MedusaResponse)
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.res.status).toHaveBeenCalledWith(200)
      if (relative === "[id]") {
        expect(f.run).toHaveBeenCalledWith({
          input: {
            additional_data: undefined,
            selector: { id: "prod_01" },
            update: { thumbnail: null },
          },
        })
      }
      if (relative === "[id]/variants/[variant_id]") {
        expect(f.run).toHaveBeenCalledWith({
          input: {
            additional_data: undefined,
            selector: { id: "variant_01", product_id: "prod_01" },
            update: { thumbnail: null },
          },
        })
      }
    }
  )

  it.each(cases)(
    "rejects managed %s before the actual native workflow",
    async (relative, schema, body, workflow) => {
      const f = setup(relative, schema, body, workflow)
      f.profiles.mockResolvedValue([
        { id: "cprof_01", product_id: "prod_01", version: 1 },
      ])
      await f.post(f.req, f.res as unknown as MedusaResponse)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.res.status).toHaveBeenCalledWith(409)
    }
  )

  it.each([
    [
      "[id]/variants/[variant_id]/images/batch",
      "AdminBatchVariantImages",
      { remove: ["img_01"] },
      "batchVariantImagesWorkflow",
    ],
    [
      "[id]/images/[image_id]/variants/batch",
      "AdminBatchImageVariant",
      { remove: ["variant_01"] },
      "batchImageVariantsWorkflow",
    ],
  ])(
    "requires native Variant update permission for %s implicit clears",
    async (relative, schema, body, workflow) => {
      const f = setup(
        relative as string,
        schema as string,
        body,
        workflow as string
      )
      const { wrapWithPoliciesCheck } = jest.requireActual<{
        wrapWithPoliciesCheck: (
          handler: NativePost,
          policies: { resource: string; operation: string }[]
        ) => (
          req: MedusaRequest,
          res: MedusaResponse,
          next: (error?: unknown) => void
        ) => Promise<void>
      }>(path.join(frameworkDirectory, "http/middlewares/check-permissions.js"))
      const { nativeAdminPolicyOverlayRoutes } = jest.requireActual<{
        nativeAdminPolicyOverlayRoutes: {
          matcher: RegExp
          policies: { resource: string; operation: string }[]
        }[]
      }>(path.join(__dirname, "../../api/middlewares.ts"))
      Object.defineProperty(f.req, "path", {
        value:
          relative === "[id]/variants/[variant_id]/images/batch"
            ? "/admin/products/prod_01/variants/variant_01/images/batch"
            : "/admin/products/prod_01/images/img_01/variants/batch",
      })
      const overlay = nativeAdminPolicyOverlayRoutes.find(({ matcher }) =>
        matcher.test(f.req.path)
      )
      expect(overlay?.policies).toEqual([
        { resource: "product_variant", operation: "update" },
      ])
      const policies = overlay?.policies ?? []
      f.graph.mockResolvedValueOnce({
        data: [
          {
            id: "role_writer",
            policies: [
              {
                id: "policy_read",
                resource: "product_variant",
                operation: "read",
              },
            ],
          },
        ],
      } as unknown as Awaited<ReturnType<typeof f.graph>>)
      const next = jest.fn()
      await wrapWithPoliciesCheck(f.post, policies)(
        f.req,
        f.res as unknown as MedusaResponse,
        next
      )
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ type: "forbidden" })
      )
      expect(f.run).not.toHaveBeenCalled()
      expect(f.profiles).not.toHaveBeenCalled()

      f.graph.mockResolvedValueOnce({
        data: [
          {
            id: "role_writer",
            policies: [
              {
                id: "policy_write",
                resource: "product_variant",
                operation: "update",
              },
            ],
          },
        ],
      } as unknown as Awaited<ReturnType<typeof f.graph>>)
      next.mockClear()
      await wrapWithPoliciesCheck(f.post, policies)(
        f.req,
        f.res as unknown as MedusaResponse,
        next
      )
      expect(next).not.toHaveBeenCalled()
      expect(f.run).toHaveBeenCalledTimes(1)
    }
  )

  it("retains the exact owner through response close and a later native workflow error", async () => {
    const f = setup(
      "[id]",
      "AdminUpdateProduct",
      { thumbnail: null },
      "updateProductsWorkflow"
    )
    const failure = new Error("Original installed workflow failure")
    let fail: (error: Error) => void = () => undefined
    f.run.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    const native = f.post(f.req, f.res as unknown as MedusaResponse)
    const rejected = expect(native).rejects.toBe(failure)
    for (let i = 0; i < 30 && !f.run.mock.calls.length; i++)
      await Promise.resolve()
    f.res.emit("close")
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.release).not.toHaveBeenCalled()
    f.release.mockRejectedValueOnce(
      new Error("Cleanup must retain original native error")
    )
    fail(failure)
    await rejected
    expect(f.release).toHaveBeenCalledWith(["catalog:product-media:prod_01"], {
      ownerId: f.acquire.mock.calls[0]![1].ownerId,
    })
    expect(f.warn).toHaveBeenCalledTimes(1)
  })

  it("retains the lock through native late completion after response close", async () => {
    const f = setup(
      "[id]",
      "AdminUpdateProduct",
      { thumbnail: null },
      "updateProductsWorkflow"
    )
    const lockingPath = require.resolve("@medusajs/locking-redis", {
      paths: [medusaDirectory],
    })
    // Preserve the provider's timer behavior while letting Jest own and close
    // its acquisition timeout timers instead of leaving native Promise timers.
    jest.doMock("node:timers/promises", () => ({
      setTimeout: (delay: number) =>
        new Promise((resolve) => setTimeout(resolve, delay)),
    }))
    const { RedisLockingProvider } = jest.requireActual<{
      RedisLockingProvider: new (
        container: object,
        options: object
      ) => Pick<ILockingModule, "acquire" | "release" | "execute">
    }>(path.join(path.dirname(lockingPath), "services/redis-lock.js"))
    const held = new Map<string, string>()
    const acquireLock = jest.fn(
      async (key: string, owner: string, ttl: number) => {
        expect(ttl).toBe(120)
        if (held.has(key)) return 0
        held.set(key, owner)
        return 1
      }
    )
    const releaseLock = jest.fn(async (key: string, owner: string) => {
      if (held.get(key) !== owner) return 0
      return Number(held.delete(key))
    })
    const locking = new RedisLockingProvider(
      {
        redisClient: {
          acquireLock,
          defineCommand: jest.fn(),
          releaseLock,
        },
      },
      {}
    )
    let complete: (value: { result: { id: string }[] }) => void = () =>
      undefined
    f.run.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      })
    )
    f.acquire.mockImplementation((key, options) =>
      locking.acquire(key, options)
    )
    f.release.mockImplementation((keys, options) =>
      locking.release(keys, options)
    )
    jest.useFakeTimers()
    try {
      const native = f.post(f.req, f.res as unknown as MedusaResponse)
      for (let count = 0; count < 30 && !f.run.mock.calls.length; count++)
        await Promise.resolve()
      expect(f.run).toHaveBeenCalledTimes(1)
      const adopted = jest.fn().mockResolvedValue(undefined)
      const adoption = locking.execute(
        ["catalog:product-media:prod_01"],
        adopted,
        { timeout: 120 }
      )
      f.res.emit("close")
      await jest.advanceTimersByTimeAsync(100)
      expect(adopted).not.toHaveBeenCalled()
      expect(releaseLock).not.toHaveBeenCalled()
      complete({ result: [{ id: "prod_01" }] })
      await native
      await jest.advanceTimersByTimeAsync(1000)
      await adoption
      expect(adopted).toHaveBeenCalledTimes(1)
      expect(held.size).toBe(0)
    } finally {
      jest.clearAllTimers()
      jest.useRealTimers()
    }
  })
})
