import { randomUUID } from "node:crypto"
import type {
  FileTypes,
  ILockingModule,
  IProductModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import type CatalogModuleService from "../../src/modules/catalog/service"
import { catalogMediaAssetState } from "../../src/lib/catalog/product-media-state"
import {
  readCatalogMediaAsset,
  readCatalogMediaAssets,
} from "../../src/lib/catalog/transaction-persistence-contracts"
import { performCatalogMediaUpload } from "../../src/lib/catalog/product-media-upload"
import { mutateCatalogProductMediaWorkflow } from "../../src/workflows/catalog/mutate-product-media"
import { mutateCatalogProductProfileWorkflow } from "../../src/workflows/catalog/mutate-product-profile"
import { mutateCatalogMediaLifecycleWorkflow } from "../../src/workflows/catalog/mutate-media-lifecycle"

type CatalogService = InstanceType<typeof CatalogModuleService>

export const registerCatalogSharedMediaIntegration = (
  getContainer: () => MedusaContainer,
  creationFixture: () => Promise<{
    catalog: CatalogService
    container: MedusaContainer
    mediaAssetId: string
  }>
): void => {
  it("holds an implicitly selected source asset while cloning metadata for another Product", async () => {
    const { catalog, container, mediaAssetId } = await creationFixture()
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const product = await products.createProducts({
      title: "Owned implicit source clone",
    })
    const source = readCatalogMediaAsset(
      await catalog.retrieveCatalogMediaAsset(mediaAssetId),
      mediaAssetId
    )
    const before = catalogMediaAssetState(source)
    const locking = container.resolve<ILockingModule>(Modules.LOCKING)
    const original = catalog.listCatalogMediaAssets.bind(catalog)
    let protectedCopies = 0
    const lookup = jest
      .spyOn(catalog, "listCatalogMediaAssets")
      .mockImplementation(async (filters, options, context) => {
        if (
          context?.transactionManager &&
          filters?.source_url === source.source_url
        ) {
          await expect(
            locking.acquire(`catalog:media-asset:${mediaAssetId}`, {
              ownerId: "disposable-implicit-source-probe",
              expire: 1,
            })
          ).rejects.toThrow()
          protectedCopies += 1
        }
        return original(filters, options, context)
      })
    try {
      const command = {
        actorId: "user_disposable_catalog_audit",
        aggregateId: product.id,
        command: "catalog.product-media.replace" as const,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        requestSha256: "c".repeat(64),
        media: [
          {
            sourceUrl: source.source_url,
            altText: "Only the cloned asset changes",
            isPrimary: true,
          },
        ],
      }
      await mutateCatalogProductMediaWorkflow(container).run({ input: command })
      expect(protectedCopies).toBe(1)
      expect(
        catalogMediaAssetState(
          readCatalogMediaAsset(
            await catalog.retrieveCatalogMediaAsset(mediaAssetId),
            mediaAssetId
          )
        )
      ).toEqual(before)
      const links = await catalog.listCatalogProductMediaItems({
        product_id: product.id,
      })
      expect(links).toHaveLength(1)
      expect(links[0]!.media_asset_id).not.toBe(mediaAssetId)
      expect(
        await catalog.retrieveCatalogMediaAsset(links[0]!.media_asset_id)
      ).toMatchObject({
        alt_text: "Only the cloned asset changes",
        version: 1,
        source_url: source.source_url,
      })
      expect(await products.retrieveProduct(product.id)).toMatchObject({
        thumbnail: source.source_url,
      })
      expect(
        await catalog.listCatalogMediaAssets({ source_url: source.source_url })
      ).toHaveLength(2)
      const replay = await mutateCatalogProductMediaWorkflow(container).run({
        input: command,
      })
      expect(replay.result).toMatchObject({ replayed: true, version: 1 })
      expect(protectedCopies).toBe(1)
      expect(
        await catalog.listCatalogMediaAssets({ source_url: source.source_url })
      ).toHaveLength(2)
      await expect(
        mutateCatalogProductMediaWorkflow(container).run({
          input: {
            ...command,
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
          },
        })
      ).rejects.toMatchObject({
        message:
          "The catalog transaction persistence boundary returned invalid structured data.",
      })
    } finally {
      lookup.mockRestore()
    }
  })

  it("replays committed media after unlink, quarantine and native Variant removal without restoring current art", async () => {
    const { catalog, container, mediaAssetId } = await creationFixture()
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const product = await products.createProducts({
      title: "Owned replay after state change",
      options: [{ title: "Format", values: ["CD"] }],
      variants: [{ title: "CD", options: { Format: "CD" } }],
    })
    const input = {
      actorId: "user_disposable_catalog_audit",
      aggregateId: product.id,
      command: "catalog.product-media.replace" as const,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      requestSha256: "e".repeat(64),
      media: [{ mediaAssetId, variantId: product.variants[0]!.id }],
    }
    await mutateCatalogProductMediaWorkflow(container).run({ input })
    await mutateCatalogProductMediaWorkflow(container).run({
      input: {
        ...input,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        media: [],
      },
    })
    const asset = readCatalogMediaAsset(
      await catalog.retrieveCatalogMediaAsset(mediaAssetId),
      mediaAssetId
    )
    await mutateCatalogMediaLifecycleWorkflow(container).run({
      input: {
        actorId: input.actorId,
        assetId: mediaAssetId,
        command: "catalog.media.quarantine",
        expectedVersion: asset.version,
        idempotencyKey: randomUUID(),
        requestSha256: "f".repeat(64),
      },
    })
    await products.softDeleteProductVariants([product.variants[0]!.id])
    expect(
      (await mutateCatalogProductMediaWorkflow(container).run({ input })).result
    ).toMatchObject({ replayed: true, version: 1 })
    expect(await products.retrieveProduct(product.id)).toMatchObject({
      thumbnail: null,
    })
    expect(
      await catalog.listCatalogProductMediaItems({ product_id: product.id })
    ).toEqual([])
    expect(await catalog.retrieveCatalogMediaAsset(mediaAssetId)).toMatchObject(
      { lifecycle_status: "quarantined" }
    )
    await expect(
      mutateCatalogProductMediaWorkflow(container).run({
        input: { ...input, expectedVersion: 0, idempotencyKey: randomUUID() },
      })
    ).rejects.toMatchObject({
      message: "The selected media variant does not belong to this product.",
    })
  })

  it("replays an exact retained profile after its native Product is removed without running a new projection", async () => {
    const container = getContainer()
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const product = await products.createProducts({
      title: "Owned retained profile replay",
    })
    const input = {
      actorId: "user_disposable_catalog_audit",
      aggregateId: product.id,
      command: "catalog.product-profile.upsert" as const,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      requestSha256: "b".repeat(64),
      patch: { releaseTitle: product.title },
    }
    const original = (
      await mutateCatalogProductProfileWorkflow(container).run({ input })
    ).result
    await products.softDeleteProducts([product.id])
    expect(
      (await mutateCatalogProductProfileWorkflow(container).run({ input }))
        .result
    ).toMatchObject({
      replayed: true,
      profileId: original.profileId,
      version: 1,
    })
    expect(await products.listProducts({ id: product.id })).toEqual([])
    await expect(
      mutateCatalogProductProfileWorkflow(container).run({
        input: { ...input, expectedVersion: 1, idempotencyKey: randomUUID() },
      })
    ).rejects.toMatchObject({
      message:
        "The native catalog media projection returned inconsistent data.",
    })
  })

  it("rejects an implicit source appearing after lock planning inside the actual transaction", async () => {
    const container = getContainer()
    const catalog = container.resolve<CatalogService>("catalog")
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const product = await products.createProducts({
      title: "Owned implicit source drift",
    })
    const suffix = randomUUID()
    const sourceUrl = `https://media.example.com/transaction-drift-${suffix}.webp`
    const idempotencyKey = randomUUID()
    const original = catalog.runCatalogTransaction.bind(catalog)
    let uploaded = false
    const transaction = jest
      .spyOn(catalog, "runCatalogTransaction")
      .mockImplementation(async (callback) => {
        if (!uploaded) {
          uploaded = true
          await performCatalogMediaUpload(
            catalog,
            {
              createFiles: jest.fn().mockResolvedValue({
                id: `catalog/transaction-drift-${suffix}.webp`,
                url: sourceUrl,
              }),
            } as unknown as FileTypes.IFileModuleService,
            {
              actorId: "user_disposable_catalog_audit",
              idempotencyKey: randomUUID(),
              requestSha256: "d".repeat(64),
              files: [
                {
                  content: "owned-provider-fixture",
                  filename: "drift.png",
                  remoteFilename: `${suffix}.webp`,
                  height: 20,
                  width: 40,
                  size: 100,
                  mimeType: "image/webp",
                  sha256: "d".repeat(64),
                  source: {
                    channels: 3,
                    filename: "drift.png",
                    format: "png",
                    frames: 1,
                    height: 20,
                    width: 40,
                    mimeType: "image/png",
                    size: 120,
                    sha256: "e".repeat(64),
                  },
                },
              ],
            }
          )
        }
        return original(callback)
      })
    try {
      await expect(
        mutateCatalogProductMediaWorkflow(container).run({
          input: {
            actorId: "user_disposable_catalog_audit",
            aggregateId: product.id,
            command: "catalog.product-media.replace",
            expectedVersion: 0,
            idempotencyKey,
            requestSha256: "a".repeat(64),
            media: [
              { sourceUrl, altText: "An unleased source must not be copied" },
            ],
          },
        })
      ).rejects.toMatchObject({
        message:
          "The catalog media changed while acquiring its locks. Refresh before saving.",
      })
      expect(uploaded).toBe(true)
      expect(
        await catalog.listCatalogMediaAssets({ source_url: sourceUrl })
      ).toHaveLength(1)
      expect(
        await catalog.listCatalogProductMediaItems({ product_id: product.id })
      ).toHaveLength(0)
      expect(
        await catalog.listCatalogAuthoringOperations({
          idempotency_key: idempotencyKey,
        })
      ).toHaveLength(0)
      expect(await products.retrieveProduct(product.id)).toMatchObject({
        thumbnail: null,
      })
    } finally {
      transaction.mockRestore()
    }
  })

  it("restores the complete200-asset snapshot when a100-to100 media replacement fails late", async () => {
    const container = getContainer()
    const catalog = container.resolve<CatalogService>("catalog")
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const product = await products.createProducts({
      title: "Owned maximum media rollback",
    })
    const prefix = randomUUID()
    const assets = await catalog.createCatalogMediaAssets(
      Array.from({ length: 200 }, (_, index) => ({
        source_url: `https://media.example.com/${prefix}-${index}.webp`,
        alt_text: `Original asset ${index}`,
      }))
    )
    const originalAssets = assets.slice(0, 100)
    const desiredAssets = assets.slice(100)
    const ids = assets.map(({ id }) => id)
    const media = (rows: typeof assets, suffix: string) =>
      rows.map((asset, index) => ({
        mediaAssetId: asset.id,
        altText: `${suffix} ${index}`,
        sortOrder: index,
        isPrimary: index === 0,
      }))
    await mutateCatalogProductMediaWorkflow(container).run({
      input: {
        actorId: "user_disposable_catalog_audit",
        aggregateId: product.id,
        command: "catalog.product-media.replace",
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        requestSha256: "b".repeat(64),
        media: media(originalAssets, "Prior cover"),
      },
    })
    const snapshot = async () =>
      readCatalogMediaAssets(
        await catalog.listCatalogMediaAssets(
          { id: ids },
          { take: 201, order: { id: "ASC" } }
        ),
        { expectedIds: ids, maximumRows: 200, requireExactIds: true }
      ).map(catalogMediaAssetState)
    const before = await snapshot()
    const priorLinks = await catalog.listCatalogProductMediaItems(
      { product_id: product.id },
      { take: 101, order: { id: "ASC" } }
    )
    const original = catalog.completeCatalogAuthoringOperation.bind(catalog)
    const failure = new Error("Owned maximum media audit completion failure")
    const complete = jest
      .spyOn(catalog, "completeCatalogAuthoringOperation")
      .mockImplementation(async (id, result, context) => {
        const operation = (
          await catalog.listCatalogAuthoringOperations(
            { id },
            { take: 1 },
            context
          )
        )[0]
        if (
          operation?.command === "catalog.product-media.replace" &&
          operation.aggregate_id === product.id
        )
          throw failure
        return original(id, result, context)
      })
    try {
      await expect(
        mutateCatalogProductMediaWorkflow(container).run({
          input: {
            actorId: "user_disposable_catalog_audit",
            aggregateId: product.id,
            command: "catalog.product-media.replace",
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
            requestSha256: "c".repeat(64),
            media: media(desiredAssets, "New cover"),
          },
        })
      ).rejects.toMatchObject({ message: failure.message })
      expect(await snapshot()).toEqual(before)
      const restored = await catalog.listCatalogProductMediaItems(
        { product_id: product.id },
        { take: 101, order: { id: "ASC" } }
      )
      expect(
        restored.map(({ id, media_asset_id }) => ({ id, media_asset_id }))
      ).toEqual(
        priorLinks.map(({ id, media_asset_id }) => ({ id, media_asset_id }))
      )
      expect(restored).toHaveLength(100)
      expect(await products.retrieveProduct(product.id)).toMatchObject({
        thumbnail: originalAssets[0]!.source_url,
      })
    } finally {
      complete.mockRestore()
    }
  })
}
