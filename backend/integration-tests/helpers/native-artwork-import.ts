import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import type {
  IFulfillmentModuleService,
  ILockingModule,
  IProductModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { asValue } from "awilix"
import { createClient } from "redis"

import { POST as confirmProductImport } from "../../src/api/admin/products/imports/[transaction_id]/confirm/route"
import { createProductImportPlan } from "../../src/lib/catalog/product-import-contract"
import { mutateCatalogProductProfileWorkflow } from "../../src/workflows/catalog/mutate-product-profile"

const importFixture = (
  container: MedusaContainer,
  update: unknown[],
  create: unknown[] = []
) => {
  const plan = createProductImportPlan({
    create,
    update,
    filename: "owned-disposable-artwork.csv",
  })
  const transactionId = `file_import_${randomUUID()}`
  const content = Buffer.from(JSON.stringify(plan))
  const files = new Map([[transactionId, content]])
  const fileService = {
    getAsBuffer: jest.fn(async (id: string) => {
      const buffer = files.get(id)
      if (!buffer)
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          "Import plan missing"
        )
      return buffer
    }),
    deleteFiles: jest.fn(async (ids: string | string[]) => {
      for (const id of Array.isArray(ids) ? ids : [ids]) files.delete(id)
    }),
  }
  // Only uploaded file storage is synthetic. Parsing, ownership Query, Catalog,
  // locks and the awaited batch/update/create workflows remain installed native.
  const scope = container.createScope()
  scope.register({ [Modules.FILE]: asValue(fileService) })
  const req = {
    headers: {},
    params: { transaction_id: transactionId },
    path: `/admin/products/imports/${transactionId}/confirm`,
    scope,
  } as unknown as MedusaRequest
  const state = { status: 200, body: null as unknown }
  let res: MedusaResponse
  res = Object.assign(new EventEmitter(), {
    setHeader: jest.fn(),
    type: jest.fn(() => res),
    status: jest.fn((status: number) => {
      state.status = status
      return res
    }),
    json: jest.fn((body: unknown) => {
      state.body = body
      return res
    }),
  }) as unknown as MedusaResponse
  return { content, fileService, files, plan, req, res, state, transactionId }
}

const adoptManagedProduct = async (
  container: MedusaContainer,
  productId: string,
  title: string
) => {
  await mutateCatalogProductProfileWorkflow(container).run({
    input: {
      actorId: "user_disposable_catalog_audit",
      aggregateId: productId,
      command: "catalog.product-profile.upsert",
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      requestSha256: "a".repeat(64),
      patch: { releaseTitle: title },
    },
  })
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
          () => reject(new Error("Owned import lease milestone timed out")),
          5_000
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const registerNativeArtworkImportIntegration = (
  getContainer: () => MedusaContainer
) => {
  describe("native parsed product import artwork boundary", () => {
    it("keeps a second actual import's Redis lease after an expired prior import releases late", async () => {
      const container = getContainer()
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const locking = container.resolve<ILockingModule>(Modules.LOCKING)
      const product = await products.createProducts({
        title: "Disposable import late lease owner",
      })
      const first = importFixture(container, [
        {
          id: product.id,
          thumbnail: "https://media.example.com/first-import-owner.webp",
        },
      ])
      const second = importFixture(container, [
        {
          id: product.id,
          thumbnail: "https://media.example.com/second-import-owner.webp",
        },
      ])
      if (
        process.env.INTEGRATION_TESTS_ENABLED !== "1" ||
        !process.env.REDIS_URL
      )
        throw new Error("Import lease expiry requires isolated Redis")
      const redis = createClient({
        url: process.env.REDIS_URL,
        disableOfflineQueue: true,
        socket: { connectTimeout: 2_000, reconnectStrategy: false },
      })
      redis.on("error", () => undefined)
      const key = `catalog:product-media:${product.id}`
      const redisKey = `medusa_lock:${key}`
      const releaseOriginal = locking.release.bind(locking)
      const upsertOriginal = products.upsertProducts.bind(products)
      const firstReleaseEntered = signal()
      const finishFirstRelease = signal()
      const firstReleaseCompleted = signal()
      const secondWriteEntered = signal()
      const finishSecondWrite = signal()
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
          return releaseOriginal(keys, args, context)
        })
      const upsert = jest
        .spyOn(products, "upsertProducts")
        .mockImplementation((async (
          ...args: Parameters<typeof products.upsertProducts>
        ) => {
          if (++writes === 2) {
            secondWriteEntered.resolve()
            await finishSecondWrite.promise
          }
          return upsertOriginal(...args)
        }) as typeof products.upsertProducts)
      let firstConfirmation: Promise<void> | undefined
      let secondConfirmation: Promise<void> | undefined
      try {
        await redis.connect()
        firstConfirmation = confirmProductImport(first.req, first.res)
        await awaitSignal(firstReleaseEntered.promise)
        expect(firstOwner).toMatch(/^[0-9a-f-]{36}$/u)
        expect(await redis.get(redisKey)).toBe(firstOwner)
        expect(await redis.ttl(redisKey)).toBeGreaterThan(110)
        expect(first.files.size).toBe(0)
        // Only this disposable Product's key expires faster; the guard's
        // installed acquisition above retains its real 120-second lease.
        expect(await redis.pExpire(redisKey, 1)).toBe(1)
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        expect(await redis.get(redisKey)).toBeNull()
        secondConfirmation = confirmProductImport(second.req, second.res)
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
            ownerId: "disposable-late-import-probe",
            expire: 1,
          })
        ).rejects.toThrow()
        await firstConfirmation
        expect(first.state).toEqual({
          status: 202,
          body: { summary: { toCreate: 0, toUpdate: 1 } },
        })
        expect(second.fileService.deleteFiles).not.toHaveBeenCalled()
        finishSecondWrite.resolve()
        await secondConfirmation
        expect(second.state).toEqual({
          status: 202,
          body: { summary: { toCreate: 0, toUpdate: 1 } },
        })
        expect(first.fileService.deleteFiles).toHaveBeenCalledWith(
          first.transactionId
        )
        expect(second.fileService.deleteFiles).toHaveBeenCalledWith(
          second.transactionId
        )
        expect(first.files.size).toBe(0)
        expect(second.files.size).toBe(0)
        expect(await products.retrieveProduct(product.id)).toMatchObject({
          thumbnail: "https://media.example.com/second-import-owner.webp",
        })
        expect(await redis.get(redisKey)).toBeNull()
      } finally {
        finishFirstRelease.resolve()
        finishSecondWrite.resolve()
        await Promise.allSettled(
          [firstConfirmation, secondConfirmation].filter(
            (pending): pending is Promise<void> => !!pending
          )
        )
        release.mockRestore()
        upsert.mockRestore()
        if (redis.isOpen) {
          await redis.del(redisKey)
          await redis.quit()
        }
      }
    })

    it("rejects mixed managed artwork before native batch partial writes or file consumption", async () => {
      const container = getContainer()
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const managed = await products.createProducts({ title: "Managed import" })
      const unmanaged = await products.createProducts({
        title: "Unmanaged import",
        thumbnail: "https://media.example.com/unchanged.webp",
      })
      await adoptManagedProduct(container, managed.id, managed.title)
      const handle = `disposable-blocked-import-${randomUUID()}`
      const fixture = importFixture(
        container,
        [
          { id: unmanaged.id, title: "Must remain unchanged", thumbnail: null },
          {
            id: managed.id,
            thumbnail: "https://media.example.com/bypass.webp",
          },
        ],
        [{ title: "Must not be created", handle }]
      )
      await confirmProductImport(fixture.req, fixture.res)
      expect(fixture.state).toMatchObject({
        status: 409,
        body: { code: "catalog_media_authoring_required" },
      })
      expect(await products.retrieveProduct(managed.id)).toMatchObject({
        thumbnail: null,
      })
      expect(await products.retrieveProduct(unmanaged.id)).toMatchObject({
        title: unmanaged.title,
        thumbnail: unmanaged.thumbnail,
      })
      expect(await products.listProducts({ handle })).toEqual([])
      expect(fixture.fileService.deleteFiles).not.toHaveBeenCalled()
      expect(fixture.files.get(fixture.transactionId)).toEqual(fixture.content)
    })

    it("runs real unmanaged create/update imports under the media lock and consumes the exact acknowledged plan", async () => {
      const container = getContainer()
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const locking = container.resolve<ILockingModule>(Modules.LOCKING)
      const profile = await container
        .resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
        .createShippingProfiles({
          name: "Disposable CSV import",
          type: "default",
        })
      const unmanaged = await products.createProducts({
        title: "Native unmanaged import",
      })
      const handle = `disposable-unmanaged-import-${randomUUID()}`
      const fixture = importFixture(
        container,
        [
          {
            id: unmanaged.id,
            title: "Native updated title",
            thumbnail: "https://media.example.com/updated.webp",
          },
        ],
        [
          {
            title: "Native created title",
            handle,
            thumbnail: "https://media.example.com/created.webp",
            shipping_profile_id: profile.id,
            options: [{ title: "Format", values: ["CD"] }],
            variants: [
              {
                title: "CD",
                options: { Format: "CD" },
                prices: [],
                manage_inventory: false,
              },
            ],
          },
        ]
      )
      const key = `catalog:product-media:${unmanaged.id}`
      const original = products.upsertProducts.bind(products)
      let protectedWrites = 0
      const upsert = jest
        .spyOn(products, "upsertProducts")
        .mockImplementation((async (
          ...args: Parameters<typeof products.upsertProducts>
        ) => {
          await expect(
            locking.acquire(key, {
              ownerId: "disposable-import-probe",
              expire: 1,
            })
          ).rejects.toThrow()
          protectedWrites += 1
          return original(...args)
        }) as typeof products.upsertProducts)
      try {
        await confirmProductImport(fixture.req, fixture.res)
      } finally {
        upsert.mockRestore()
      }
      expect(protectedWrites).toBeGreaterThan(0)
      expect(fixture.state).toEqual({
        status: 202,
        body: { summary: { toCreate: 1, toUpdate: 1 } },
      })
      expect(await products.retrieveProduct(unmanaged.id)).toMatchObject({
        title: "Native updated title",
        thumbnail: "https://media.example.com/updated.webp",
      })
      expect(await products.listProducts({ handle })).toMatchObject([
        {
          title: "Native created title",
          thumbnail: "https://media.example.com/created.webp",
        },
      ])
      expect(fixture.fileService.deleteFiles).toHaveBeenCalledTimes(1)
      expect(fixture.fileService.deleteFiles).toHaveBeenCalledWith(
        fixture.transactionId
      )
      expect(fixture.files.size).toBe(0)
      await expect(
        confirmProductImport(fixture.req, fixture.res)
      ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
      await locking.acquire(key, {
        ownerId: "disposable-import-probe",
        expire: 1,
      })
      await locking.release(key, { ownerId: "disposable-import-probe" })
    })

    it("retains managed ordinary imported fields without changing owned artwork", async () => {
      const container = getContainer()
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const managed = await products.createProducts({
        title: "Managed ordinary import",
      })
      await adoptManagedProduct(container, managed.id, managed.title)
      const fixture = importFixture(container, [
        {
          id: managed.id,
          title: "Ordinary native title",
          description: "Ordinary native copy",
        },
      ])
      await confirmProductImport(fixture.req, fixture.res)
      expect(fixture.state).toEqual({
        status: 202,
        body: { summary: { toCreate: 0, toUpdate: 1 } },
      })
      expect(await products.retrieveProduct(managed.id)).toMatchObject({
        title: "Ordinary native title",
        description: "Ordinary native copy",
        thumbnail: null,
      })
      expect(fixture.files.size).toBe(0)
    })
  })
}
