import type {
  ConfigModule,
  ILockingModule,
  IProductModuleService,
  IRbacModuleService,
  IUserModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  generateJwtToken,
  Modules,
} from "@medusajs/framework/utils"
import { randomUUID } from "node:crypto"
import { createClient } from "redis"

import { mutateCatalogProductProfileWorkflow } from "../../src/workflows/catalog/mutate-product-profile"

type HttpApi = {
  post: (
    path: string,
    body: unknown,
    options?: {
      headers?: Record<string, string>
      validateStatus?: (status: number) => boolean
    }
  ) => Promise<{
    status: number
    data: unknown
    headers: Record<string, unknown>
  }>
}

// Sign only a synthetic persisted user's fixture token. Requests still traverse
// the real native authentication, policies, validators, delegate and workflows.
// Password-provider login is outside this HTTP mutation regression.
const adminHeaders = async (container: MedusaContainer) => {
  if (process.env.INTEGRATION_TESTS_ENABLED !== "1")
    throw new Error("Native HTTP fixtures require the disposable test runner")
  const config = container.resolve<ConfigModule>(
    ContainerRegistrationKeys.CONFIG_MODULE
  )
  const http = config.projectConfig.http
  if (http.jwtSecret !== "disposable_jwt_secret")
    throw new Error("Native HTTP fixtures require the synthetic signing secret")
  const user = await container
    .resolve<IUserModuleService>(Modules.USER)
    .createUsers({ email: `native-http-${randomUUID()}@example.invalid` })
  const flags = container.resolve<{
    isFeatureEnabled: (name: string) => boolean
  }>(ContainerRegistrationKeys.FEATURE_FLAG_ROUTER)
  let roleId = "role_disposable_native_http"
  if (flags.isFeatureEnabled("rbac")) {
    const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)
    const policies = await rbac.listRbacPolicies(
      { resource: "*", operation: "*" },
      { take: 2 }
    )
    if (policies.length > 1)
      throw new Error("Disposable wildcard policy identity is ambiguous")
    const policy =
      policies[0] ??
      (await rbac.createRbacPolicies({
        key: "*:*",
        resource: "*",
        operation: "*",
      }))
    const role = await rbac.createRbacRoles({
      name: `Disposable native HTTP ${randomUUID()}`,
    })
    await rbac.createRbacRolePolicies({
      role_id: role.id,
      policy_id: policy.id,
    })
    roleId = role.id
  }
  const token = generateJwtToken(
    {
      actor_id: user.id,
      actor_type: "user",
      auth_identity_id: "",
      app_metadata: { user_id: user.id, roles: [roleId] },
      user_metadata: {},
    },
    {
      secret: http.jwtSecret,
      expiresIn: "5m",
      ...(http.jwtOptions ? { jwtOptions: http.jwtOptions } : {}),
    }
  )
  return { authorization: `Bearer ${token}` }
}

const rows = async (container: MedusaContainer) => {
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const create = (title: string) =>
    products.createProducts({
      title,
      options: [{ title: "Format", values: ["CD", "LP"] }],
      variants: [
        { title: "CD", manage_inventory: false, options: { Format: "CD" } },
      ],
    })
  const own = await create("Owned native HTTP batch Product")
  const foreign = await create("Other native HTTP batch Product")
  if (!own.variants[0] || !foreign.variants[0])
    throw new Error("Native HTTP fixture must own both persisted Variants")
  const snapshot = async () => ({
    products: await products.listProducts(
      { id: [own.id, foreign.id] },
      { select: ["id", "title", "thumbnail"], take: 3, order: { id: "ASC" } }
    ),
    variants: await products.listProductVariants(
      { id: [own.variants[0]!.id, foreign.variants[0]!.id] },
      {
        select: ["id", "product_id", "title", "thumbnail"],
        take: 3,
        order: { id: "ASC" },
      }
    ),
  })
  return { foreign, own, products, snapshot }
}

const signal = () => {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const awaitSignal = async (promise: Promise<void>) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("Owned native HTTP lease milestone timed out")),
          5_000
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const registerNativeCatalogBatchHttpTests = (
  api: HttpApi,
  getContainer: () => MedusaContainer
): void => {
  it("does not let an expired native HTTP operation release the next guarded writer's actual Redis lease", async () => {
    const container = getContainer()
    const { own, products } = await rows(container)
    const headers = await adminHeaders(container)
    const locking = container.resolve<ILockingModule>(Modules.LOCKING)
    if (process.env.INTEGRATION_TESTS_ENABLED !== "1" || !process.env.REDIS_URL)
      throw new Error("Native HTTP lease expiry requires isolated Redis")
    const redis = createClient({
      url: process.env.REDIS_URL,
      disableOfflineQueue: true,
      socket: { connectTimeout: 2_000, reconnectStrategy: false },
    })
    redis.on("error", () => undefined)
    const key = `catalog:product-media:${own.id}`
    const redisKey = `medusa_lock:${key}`
    const releaseOriginal = locking.release.bind(locking)
    const updateOriginal = products.updateProducts.bind(products)
    const firstReleaseEntered = signal()
    const finishFirstRelease = signal()
    const firstReleaseCompleted = signal()
    const secondWriteEntered = signal()
    const finishSecondWrite = signal()
    const secondReleaseCompleted = signal()
    let firstOwner: string | undefined
    let staleReleaseResult: boolean | undefined
    let writes = 0
    const release = jest
      .spyOn(locking, "release")
      .mockImplementation(async (keys, args, context) => {
        if (
          (Array.isArray(keys) ? keys : [keys]).includes(key) &&
          !firstOwner
        ) {
          firstOwner = args?.ownerId ?? undefined
          firstReleaseEntered.resolve()
          await finishFirstRelease.promise
          staleReleaseResult = await releaseOriginal(keys, args, context)
          firstReleaseCompleted.resolve()
          return staleReleaseResult
        }
        const result = await releaseOriginal(keys, args, context)
        if ((Array.isArray(keys) ? keys : [keys]).includes(key))
          secondReleaseCompleted.resolve()
        return result
      })
    const update = jest
      .spyOn(products, "updateProducts")
      .mockImplementation((async (
        ...args: Parameters<typeof products.updateProducts>
      ) => {
        if (++writes === 2) {
          secondWriteEntered.resolve()
          await finishSecondWrite.promise
        }
        return updateOriginal(...args)
      }) as typeof products.updateProducts)
    let first: ReturnType<HttpApi["post"]> | undefined
    let second: ReturnType<HttpApi["post"]> | undefined
    try {
      await redis.connect()
      first = api.post(
        `/admin/products/${own.id}`,
        { thumbnail: "https://media.example.com/first-native-http.webp" },
        { headers, validateStatus: () => true }
      )
      await awaitSignal(firstReleaseEntered.promise)
      expect(firstOwner).toMatch(/^[0-9a-f-]{36}$/u)
      expect(await redis.get(redisKey)).toBe(firstOwner)
      expect(await redis.ttl(redisKey)).toBeGreaterThan(110)
      // Accelerate expiry only for this exact disposable Product's Redis key.
      // Application acquisition still uses the real 120-second TTL above.
      expect(await redis.pExpire(redisKey, 1)).toBe(1)
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      expect(await redis.get(redisKey)).toBeNull()
      second = api.post(
        `/admin/products/${own.id}`,
        { thumbnail: "https://media.example.com/second-native-http.webp" },
        { headers, validateStatus: () => true }
      )
      await awaitSignal(secondWriteEntered.promise)
      const secondOwner = await redis.get(redisKey)
      expect(secondOwner).toMatch(/^[0-9a-f-]{36}$/u)
      expect(secondOwner).not.toBe(firstOwner)
      finishFirstRelease.resolve()
      await awaitSignal(firstReleaseCompleted.promise)
      expect(staleReleaseResult).toBe(false)
      expect(await redis.get(redisKey)).toBe(secondOwner)
      await expect(
        locking.acquire(key, {
          ownerId: "disposable-late-http-probe",
          expire: 1,
        })
      ).rejects.toThrow()
      finishSecondWrite.resolve()
      expect((await first).status).toBe(200)
      expect((await second).status).toBe(200)
      await awaitSignal(secondReleaseCompleted.promise)
      expect(await products.retrieveProduct(own.id)).toMatchObject({
        thumbnail: "https://media.example.com/second-native-http.webp",
      })
      expect(await redis.get(redisKey)).toBeNull()
    } finally {
      finishFirstRelease.resolve()
      finishSecondWrite.resolve()
      await Promise.allSettled(
        [first, second].filter(
          (pending): pending is ReturnType<HttpApi["post"]> => !!pending
        )
      )
      release.mockRestore()
      update.mockRestore()
      if (redis.isOpen) {
        await redis.del(redisKey)
        await redis.quit()
      }
    }
  })

  it.each(["product", "variant", "foreign-variant"] as const)(
    "rejects mixed native HTTP batch %s deletion without any persisted write",
    async (kind) => {
      const container = getContainer()
      const { foreign, own, snapshot } = await rows(container)
      const before = await snapshot()
      expect(before.products).toHaveLength(2)
      expect(before.variants).toHaveLength(2)
      const headers = await adminHeaders(container)
      const product = kind === "product"
      const target =
        kind === "foreign-variant"
          ? foreign.variants[0]!.id
          : product
            ? own.id
            : own.variants[0]!.id
      const response = await api.post(
        product
          ? "/admin/products/batch"
          : `/admin/products/${own.id}/variants/batch`,
        {
          update: [
            {
              id: product ? own.id : own.variants[0]!.id,
              title: "A rejected batch must not persist this title",
            },
          ],
          delete: [target],
        },
        { headers, validateStatus: () => true }
      )
      expect(response.status).toBe(409)
      expect(response.data).toMatchObject({
        code: "catalog_hard_deletion_disabled",
        status: 409,
      })
      expect(response.headers["content-type"]).toMatch(
        /^application\/problem\+json/u
      )
      expect(response.headers["cache-control"]).toBe("private, no-store")
      expect(await snapshot()).toEqual(before)
    }
  )

  it.each(["product", "variant"] as const)(
    "preserves ordinary native HTTP %s batch updates with empty delete arrays",
    async (kind) => {
      const container = getContainer()
      const { foreign, own, products } = await rows(container)
      const headers = await adminHeaders(container)
      const product = kind === "product"
      const target = product ? own.id : own.variants[0]!.id
      const title = "Allowed ordinary native HTTP update"
      const response = await api.post(
        product
          ? "/admin/products/batch"
          : `/admin/products/${own.id}/variants/batch`,
        { update: [{ id: target, title }], delete: [] },
        { headers, validateStatus: () => true }
      )
      expect(response.status).toBe(200)
      expect(response.data).toMatchObject({
        updated: expect.arrayContaining([
          expect.objectContaining({ id: target }),
        ]),
        deleted: {
          object: product ? "product" : "variant",
          ids: [],
          deleted: true,
        },
      })
      expect(
        product
          ? await products.retrieveProduct(target)
          : await products.retrieveProductVariant(target)
      ).toMatchObject({ id: target, title })
      expect(await products.retrieveProduct(foreign.id)).toMatchObject({
        id: foreign.id,
        title: foreign.title,
      })
      expect(
        await products.retrieveProductVariant(foreign.variants[0]!.id)
      ).toMatchObject({
        id: foreign.variants[0]!.id,
        product_id: foreign.id,
        title: foreign.variants[0]!.title,
      })
    }
  )

  it("requires native Admin authentication before a batch mutation", async () => {
    const { own, snapshot } = await rows(getContainer())
    const before = await snapshot()
    const response = await api.post(
      "/admin/products/batch",
      { delete: [own.id] },
      { validateStatus: () => true }
    )
    expect(response.status).toBe(401)
    expect(await snapshot()).toEqual(before)
  })

  it.each(["single", "batch"] as const)(
    "rejects new nested Variant artwork under a managed Product through native HTTP %s updates",
    async (kind) => {
      const container = getContainer()
      const { own, products, snapshot } = await rows(container)
      await mutateCatalogProductProfileWorkflow(container).run({
        input: {
          actorId: "user_disposable_catalog_audit",
          aggregateId: own.id,
          command: "catalog.product-profile.upsert",
          expectedVersion: 0,
          idempotencyKey: randomUUID(),
          requestSha256: "a".repeat(64),
          patch: { releaseTitle: own.title },
        },
      })
      const before = await snapshot()
      const headers = await adminHeaders(container)
      const update = {
        title: "Managed artwork must reject the whole update",
        variants: [
          {
            title: "LP",
            thumbnail: "https://media.example.com/new-nested-variant.webp",
            options: { Format: "LP" },
            manage_inventory: false,
            prices: [{ amount: 5.25, currency_code: "usd" }],
          },
        ],
      }
      const response = await api.post(
        kind === "single"
          ? `/admin/products/${own.id}`
          : "/admin/products/batch",
        kind === "single" ? update : { update: [{ id: own.id, ...update }] },
        { headers, validateStatus: () => true }
      )
      expect(response.status).toBe(409)
      expect(response.data).toMatchObject({
        code: "catalog_media_authoring_required",
        status: 409,
      })
      expect(await snapshot()).toEqual(before)
      expect(
        await products.listProductVariants({ product_id: own.id })
      ).toHaveLength(1)
    }
  )

  it.each(["single", "batch"] as const)(
    "retains unmanaged new nested Variant artwork through the real native HTTP %s workflow under its lease",
    async (kind) => {
      const container = getContainer()
      const { own, products } = await rows(container)
      const locking = container.resolve<ILockingModule>(Modules.LOCKING)
      const headers = await adminHeaders(container)
      const thumbnail = "https://media.example.com/new-nested-variant.webp"
      const update = {
        variants: [
          {
            id: own.variants[0]!.id,
            title: "CD",
            options: { Format: "CD" },
          },
          {
            title: "LP",
            thumbnail,
            options: { Format: "LP" },
            manage_inventory: false,
            prices: [{ amount: 5.25, currency_code: "usd" }],
          },
        ],
      }
      const key = `catalog:product-media:${own.id}`
      const updateOriginal = products.updateProducts.bind(products)
      const upsertOriginal = products.upsertProducts.bind(products)
      let protectedWrites = 0
      const assertLease = async () => {
        await expect(
          locking.acquire(key, { ownerId: "disposable-http-probe", expire: 1 })
        ).rejects.toThrow()
        protectedWrites += 1
      }
      const write =
        kind === "single"
          ? jest.spyOn(products, "updateProducts").mockImplementation((async (
              ...args: Parameters<typeof products.updateProducts>
            ) => {
              await assertLease()
              return updateOriginal(...args)
            }) as typeof products.updateProducts)
          : jest.spyOn(products, "upsertProducts").mockImplementation((async (
              ...args: Parameters<typeof products.upsertProducts>
            ) => {
              await assertLease()
              return upsertOriginal(...args)
            }) as typeof products.upsertProducts)
      try {
        const response = await api.post(
          kind === "single"
            ? `/admin/products/${own.id}`
            : "/admin/products/batch",
          kind === "single" ? update : { update: [{ id: own.id, ...update }] },
          { headers, validateStatus: () => true }
        )
        expect(response.status).toBe(200)
        expect(protectedWrites).toBeGreaterThan(0)
        const variants = await products.listProductVariants({
          product_id: own.id,
        })
        expect(variants).toHaveLength(2)
        expect(variants).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: own.variants[0]!.id,
              product_id: own.id,
              title: "CD",
            }),
            expect.objectContaining({
              product_id: own.id,
              title: "LP",
              thumbnail,
            }),
          ])
        )
      } finally {
        write.mockRestore()
      }
    }
  )
}
