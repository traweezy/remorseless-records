import {
  createOrderFulfillmentWorkflow,
  createShippingOptionsWorkflow,
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  refundPaymentsWorkflow,
  updateOrderTaxLinesWorkflow,
  beginReturnOrderWorkflow,
  requestItemReturnWorkflow,
  confirmReturnRequestWorkflow,
  beginReceiveReturnWorkflow,
  receiveItemReturnRequestWorkflow,
  dismissItemReturnRequestWorkflow,
  confirmReturnReceiveWorkflow,
  beginClaimOrderWorkflow,
  orderClaimRequestItemReturnWorkflow,
  confirmClaimRequestWorkflow,
  beginExchangeOrderWorkflow,
  orderExchangeRequestItemReturnWorkflow,
  orderExchangeAddNewItemWorkflow,
  confirmExchangeRequestWorkflow,
  createPaymentCollectionForCartWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/core-flows"
import { loadStoreCatalogPresentations } from "../src/lib/catalog/store-presentation"
import { loadProductAuthoringView } from "../src/lib/catalog/product-authoring-view"
import type {
  FileTypes,
  ICartModuleService,
  ILockingModule,
  IFulfillmentModuleService,
  IStoreModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
  IProductModuleService,
  IPaymentModuleService,
  IEventBusModuleService,
  IOrderModuleService,
  IInventoryService,
  IRegionModuleService,
  ITaxModuleService,
  CreateNotificationDTO,
  Logger,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  PaymentEvents,
} from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  TransactionHandlerType,
  TransactionState,
} from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { knex, type Knex } from "@mikro-orm/knex"
import { createClient } from "redis"
import { randomUUID } from "node:crypto"
import type { MedusaRequest } from "@medusajs/framework"
import { GET as nativeProductList } from "@medusajs/medusa/api/admin/products/route"
import { GET as nativeVariantList } from "@medusajs/medusa/api/admin/products/[id]/variants/route"
import { POST as guardedNativeProductUpdate } from "../src/api/admin/products/[id]/route"
import { POST as guardedNativeVariantUpdate } from "../src/api/admin/products/[id]/variants/[variant_id]/route"

import {
  setShelfArchived,
  upsertShelf,
} from "../src/api/admin/catalog/shelves/helpers"
import type { CatalogService } from "../src/api/admin/catalog/utils"
import { mutateCatalogProductProfile } from "../src/lib/catalog/product-profile-authoring"
import { mutateCatalogVariantProfile } from "../src/lib/catalog/variant-profile-authoring"
import {
  readCatalogProductProfile,
  readCatalogVariantProfiles,
} from "../src/lib/catalog/profile-persistence-contracts"
import { normalizeLegacyCatalogDescriptions } from "../src/lib/catalog/normalize-legacy-descriptions"
import { performCatalogMediaUpload } from "../src/lib/catalog/product-media-upload"
import { mutateCatalogProductMedia } from "../src/lib/catalog/product-media-authoring"
import {
  readCatalogMediaAsset,
  readCatalogBundleStateProfiles,
  readCatalogBundleComponentStates,
  readCatalogBundleInventoryLinks,
} from "../src/lib/catalog/transaction-persistence-contracts"
import { createCatalogProductWorkflow } from "../src/workflows/catalog/create-product"
import { mutateCatalogBundleWorkflow } from "../src/workflows/catalog/mutate-bundle"
import { mutateCatalogProductMediaWorkflow } from "../src/workflows/catalog/mutate-product-media"
import { mutateCatalogMediaLifecycleWorkflow } from "../src/workflows/catalog/mutate-media-lifecycle"
import { mutateCatalogProductProfileWorkflow } from "../src/workflows/catalog/mutate-product-profile"
import { releaseCommittedCatalogMediaLease } from "../src/workflows/catalog/media-lease"
import type { CatalogProductMediaMutationInput } from "../src/lib/catalog/product-media-authoring"
import { taxQuoteIdentityFromCart } from "../src/lib/tax-control/quote"
import { installDisposableStripeTransport } from "./helpers/native-artwork-checkout"
import { registerNativeCatalogBatchHttpTests } from "./helpers/native-catalog-batch-http"
import { registerNativeArtworkImportIntegration } from "./helpers/native-artwork-import"
import { registerCatalogSharedMediaIntegration } from "./helpers/catalog-shared-media"
import { registerFailedCreationRepairHttpTests } from "./helpers/failed-creation-repair-http"
import { catalogProductCreateSchema } from "../src/lib/catalog/product-create-contract"
import {
  inspectFailedCatalogCreation,
  repairFailedCatalogCreation,
} from "../src/lib/catalog/failed-creation-repair"
import {
  deriveCatalogCommandIdempotencyKey,
  hashCatalogCommand,
} from "../src/modules/catalog/catalog-command"

import {
  createBackendReadinessProbes,
  runReadinessChecks,
} from "../src/lib/health/readiness"
import {
  observeDatabaseDiagnostics,
  withSearchDatabaseWorkload,
} from "../src/lib/observability/database-diagnostics"
import { PAYMENT_LIFECYCLE_MODULE } from "../src/modules/payment-lifecycle/constants"
import type PaymentLifecycleModuleService from "../src/modules/payment-lifecycle/service"
import type TaxControlModuleService from "../src/modules/tax-control/service"
import { buildRefundNotificationPayloads } from "../src/lib/refund-operations/notification"
import fulfillmentStatusHandler from "../src/subscribers/fulfillment-status"
import afterSalesStatusHandler from "../src/subscribers/after-sales-status"

const databaseName = "rr_disposable_integration"
const redisUrl = process.env.REDIS_URL?.trim()

if (process.env.INTEGRATION_TESTS_ENABLED !== "1") {
  throw new Error(
    "Disposable integration tests require INTEGRATION_TESTS_ENABLED=1."
  )
}
if (!redisUrl) {
  throw new Error("Disposable integration tests require REDIS_URL.")
}

const recordFrom = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

const assertDatabaseReadinessTiming = (checks: unknown): void => {
  if (!Array.isArray(checks)) {
    throw new TypeError("Readiness checks must be an array.")
  }
  const database = checks
    .map((check) => recordFrom(check, "Readiness check"))
    .find((check) => check.name === "database")
  expect(database?.status).toBe("ok")
  const duration = database?.duration_ms
  if (typeof duration !== "number") {
    throw new TypeError("Database readiness duration must be numeric.")
  }
  expect(Number.isSafeInteger(duration)).toBe(true)
  for (const field of ["pool_acquire_ms", "query_ms"] as const) {
    const phase = database?.[field]
    if (typeof phase !== "number") {
      throw new TypeError("Database readiness phase must be numeric.")
    }
    expect(Number.isSafeInteger(phase)).toBe(true)
    expect(phase).toBeGreaterThanOrEqual(0)
    expect(phase).toBeLessThanOrEqual(duration)
  }
  const pool = recordFrom(database?.pool_observation, "Pool observation")
  expect(["created", "reused", "unknown"]).toContain(pool.connection_source)
  for (const field of [
    "free_before",
    "used_before",
    "pending_acquires_before",
    "pending_creates_before",
  ]) {
    expect(Number.isSafeInteger(pool[field])).toBe(true)
    expect(pool[field]).toBeGreaterThanOrEqual(0)
  }
  if (pool.connection_create_ms !== null) {
    if (typeof database?.pool_acquire_ms !== "number")
      throw new TypeError("Database acquisition duration must be numeric.")
    expect(pool.connection_source).toBe("created")
    expect(pool.connection_create_ms).toBeLessThanOrEqual(
      database?.pool_acquire_ms
    )
  }
}

medusaIntegrationTestRunner({
  cwd: process.cwd(),
  dbName: databaseName,
  env: {
    INTEGRATION_TESTS_ENABLED: "1",
    NODE_ENV: "test",
    REDIS_URL: redisUrl,
  },
  moduleName: "RemorselessDisposableInfrastructure",
  testSuite: ({ api, dbConfig, getContainer }) => {
    const catalogCreationFixture = async () => {
      const container = getContainer()
      const catalog = container.resolve<CatalogService>("catalog")
      const fulfillment = container.resolve<IFulfillmentModuleService>(
        Modules.FULFILLMENT
      )
      const shippingProfile = await fulfillment.createShippingProfiles({
        name: "Disposable bundle shipping",
        type: "default",
      })
      const channels = container.resolve<ISalesChannelModuleService>(
        Modules.SALES_CHANNEL
      )
      const channel = await channels.createSalesChannels({
        name: "Disposable bundle catalog",
      })
      const stores = container.resolve<IStoreModuleService>(Modules.STORE)
      const store = (await stores.listStores())[0]!
      await stores.updateStores(store.id, {
        default_sales_channel_id: channel.id,
      })
      const location = await container
        .resolve<IStockLocationService>(Modules.STOCK_LOCATION)
        .createStockLocations({ name: "HQ" })
      const componentCommand = catalogProductCreateSchema.parse({
        idempotencyKey: randomUUID(),
        kind: "music_release",
        title: "Disposable bundle component",
        handle: "disposable-bundle-component",
        options: [{ title: "Format", values: ["CD"] }],
        variants: [
          {
            key: "cd",
            title: "CD",
            sku: "DISPOSABLE-BUNDLE-CD",
            options: { Format: "CD" },
            prices: [{ amount: 1.23, currencyCode: "usd" }],
            stockQuantity: 20,
          },
        ],
        profile: { artists: [{ name: "Disposable bundle artist" }] },
      })
      const component = (
        await createCatalogProductWorkflow(container).run({
          input: {
            ...componentCommand,
            actorId: "user_disposable_catalog_audit",
            requestSha256: hashCatalogCommand(componentCommand),
          },
        })
      ).result
      const uploadKey = randomUUID()
      const uploaded = await performCatalogMediaUpload(
        catalog,
        {
          createFiles: jest.fn().mockResolvedValue({
            id: `catalog/disposable-${uploadKey}.webp`,
            url: `https://media.example.com/disposable-${uploadKey}.webp`,
          }),
        } as unknown as FileTypes.IFileModuleService,
        {
          actorId: "user_disposable_catalog_audit",
          idempotencyKey: uploadKey,
          requestSha256: "c".repeat(64),
          files: [
            {
              content: "isolated-provider-fixture",
              filename: "disposable.png",
              remoteFilename: `${uploadKey}-00.webp`,
              height: 20,
              width: 40,
              size: 100,
              mimeType: "image/webp",
              sha256: "d".repeat(64),
              source: {
                channels: 3,
                filename: "disposable.png",
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
      const mediaAssetId = uploaded.mutation.files[0]!.mediaAssetId
      const command = (
        kind: "fixed_bundle" | "mystery_bundle" | "merch",
        suffix: string = kind
      ) =>
        catalogProductCreateSchema.parse({
          idempotencyKey: randomUUID(),
          kind,
          title: `Disposable ${suffix}`,
          handle: `disposable-${suffix.replaceAll("_", "-")}`,
          description: "Owned disposable creation regression.",
          options: [{ title: "Offering", values: ["Standard"] }],
          variants: [
            {
              key: "standard",
              title: "Standard",
              sku: `DISPOSABLE-${suffix.toUpperCase()}`,
              options: { Offering: "Standard" },
              prices: [{ amount: 3.57, currencyCode: "usd" }],
              ...(kind === "fixed_bundle" ? {} : { stockQuantity: 3 }),
            },
          ],
          profile:
            kind === "merch" ? { productType: { label: "T-shirt" } } : {},
          media: [
            {
              mediaAssetId,
              altText: "Owned disposable artwork",
              isPrimary: true,
              role: "primary",
              sortOrder: 0,
            },
          ],
          ...(kind === "merch"
            ? {}
            : {
                bundle: {
                  components:
                    kind === "fixed_bundle"
                      ? [
                          {
                            componentProductId: component.productId,
                            componentVariantId: component.variantIds[0]!,
                            bundleVariantKeys: ["standard"],
                            quantity: 2,
                          },
                        ]
                      : [],
                },
              }),
        })
      return {
        catalog,
        command,
        component,
        container,
        mediaAssetId,
        channel,
        location,
        shippingProfile,
      }
    }

    // Persist the historical early-completion footprint through native model
    // APIs. This deliberately differs from the corrected creation workflow.
    const failedCreationFixture = async () => {
      const fixture = await catalogCreationFixture()
      const { catalog, container, mediaAssetId } = fixture
      const productId = `prod_${randomUUID().replaceAll("-", "")}`
      const variantId = `variant_${randomUUID().replaceAll("-", "")}`
      const key = randomUUID()
      const [profile] = await catalog.createCatalogProductProfiles([
        { product_id: productId },
      ])
      const [variant] = await catalog.createCatalogVariantProfiles([
        { variant_id: variantId, product_profile_id: profile!.id },
      ])
      const [media] = await catalog.createCatalogProductMediaItems([
        {
          product_id: productId,
          product_profile_id: profile!.id,
          media_asset_id: mediaAssetId,
          role: "primary",
          is_primary: true,
        },
      ])
      const [creation] = await catalog.createCatalogAuthoringOperations([
        {
          actor_id: "user_disposable_catalog_audit",
          aggregate_id: `catalog-product-create:${key}`,
          command: "catalog.product.create",
          expected_version: 0,
          idempotency_key: key,
          request_sha256: "a".repeat(64),
          status: "compensated",
          result: {},
          error_code: "workflow_compensated",
          error_detail: "Owned historical creation failure",
          completed_at: new Date(),
          metadata: { kind: "fixed_bundle" },
        },
      ])
      const children = await catalog.createCatalogAuthoringOperations(
        [
          {
            scope: "product-profile",
            command: "catalog.product-profile.upsert",
            aggregate_id: productId,
            result: {
              productId,
              profileId: profile!.id,
              version: 1,
              created: true,
            },
          },
          {
            scope: "variant:0:standard",
            command: "catalog.variant-profile.upsert",
            aggregate_id: variantId,
            result: {
              variantId,
              profileId: variant!.id,
              version: 1,
              created: true,
            },
          },
          {
            scope: "product-media",
            command: "catalog.product-media.replace",
            aggregate_id: productId,
            result: { productId, version: 1 },
          },
        ].map(({ scope, ...operation }) => ({
          ...operation,
          actor_id: "user_disposable_catalog_audit",
          expected_version: 0,
          idempotency_key: deriveCatalogCommandIdempotencyKey(key, scope),
          request_sha256: "b".repeat(64),
          status: "succeeded" as const,
          error_code: null,
          error_detail: null,
          completed_at: new Date(),
          metadata: {},
        }))
      )
      const identity = { creationOperationId: creation!.id, productId }
      const snapshot = async () => ({
        profiles: await catalog.listCatalogProductProfiles(
          { product_id: productId },
          { withDeleted: true }
        ),
        variants: await catalog.listCatalogVariantProfiles(
          { product_profile_id: profile!.id },
          { withDeleted: true }
        ),
        media: await catalog.listCatalogProductMediaItems(
          { product_id: productId },
          { withDeleted: true }
        ),
        assets: await catalog.listCatalogMediaAssets({ id: mediaAssetId }),
        history: await catalog.listCatalogAuthoringOperations(
          { id: [creation!.id, ...children.map((row) => row.id)] },
          { order: { id: "ASC" } }
        ),
      })
      return {
        ...fixture,
        identity,
        profile: profile!,
        variant: variant!,
        media: media!,
        children,
        snapshot,
      }
    }

    describe("disposable PostgreSQL and Redis integration", () => {
      registerNativeCatalogBatchHttpTests(api, getContainer)
      registerNativeArtworkImportIntegration(getContainer)
      registerFailedCreationRepairHttpTests(api, failedCreationFixture)
      registerCatalogSharedMediaIntegration(
        getContainer,
        catalogCreationFixture
      )
      it("preserves a second Product's shared-asset edit across creation compensation", async () => {
        const { catalog, command, component, container, mediaAssetId } =
          await catalogCreationFixture()
        const locking = container.resolve<ILockingModule>(Modules.LOCKING)
        const assetKey = `catalog:media-asset:${mediaAssetId}`
        const mutateExisting = (expectedVersion: number, altText: string) =>
          mutateCatalogProductMediaWorkflow(container).run({
            input: {
              actorId: "user_disposable_catalog_audit",
              aggregateId: component.productId,
              command: "catalog.product-media.replace",
              expectedVersion,
              idempotencyKey: randomUUID(),
              requestSha256: "a".repeat(64),
              media: [{ mediaAssetId, altText, isPrimary: true }],
            },
          })
        await mutateExisting(0, "Shared asset before creation")
        const baseline = readCatalogMediaAsset(
          await catalog.retrieveCatalogMediaAsset(mediaAssetId),
          mediaAssetId
        )
        const parsed = command("merch", "shared-asset-rollback")
        const completeOriginal =
          catalog.completeCatalogAuthoringOperation.bind(catalog)
        const updateOriginal = catalog.updateCatalogMediaAssets.bind(catalog)
        let paused: () => void = () => undefined
        const creationPaused = new Promise<void>((resolve) => {
          paused = resolve
        })
        let failCreation: () => void = () => undefined
        const failureAllowed = new Promise<void>((resolve) => {
          failCreation = resolve
        })
        const failure = new Error(
          "Owned shared-asset creation completion failure"
        )
        const writes: string[] = []
        const leaseEvents: Array<{
          action: string
          owner: unknown
          keys: unknown
        }> = []
        const acquireOriginal = locking.acquire.bind(locking)
        const releaseOriginal = locking.release.bind(locking)
        const acquireDiagnostic = jest
          .spyOn(locking, "acquire")
          .mockImplementation(async (keys, options) => {
            leaseEvents.push({
              action: "acquire",
              owner: options?.ownerId,
              keys,
            })
            return acquireOriginal(keys, options)
          })
        const releaseDiagnostic = jest
          .spyOn(locking, "release")
          .mockImplementation(async (keys, options) => {
            leaseEvents.push({
              action: "release",
              owner: options?.ownerId,
              keys,
            })
            return releaseOriginal(keys, options)
          })
        const update = jest
          .spyOn(catalog, "updateCatalogMediaAssets")
          .mockImplementation(async (rows, context) => {
            for (const row of Array.isArray(rows) ? rows : [rows]) {
              if (
                "id" in row &&
                row.id === mediaAssetId &&
                "alt_text" in row &&
                typeof row.alt_text === "string"
              )
                writes.push(row.alt_text)
            }
            return updateOriginal(rows, context)
          })
        const completion = jest
          .spyOn(catalog, "completeCatalogAuthoringOperation")
          .mockImplementation(async (id, result, context) => {
            const operation = (
              await catalog.listCatalogAuthoringOperations(
                { id },
                { take: 1 },
                context
              )
            )[0]
            if (operation?.command === "catalog.product.create") {
              paused()
              await failureAllowed
              throw failure
            }
            return completeOriginal(id, result, context)
          })
        let creation:
          | ReturnType<ReturnType<typeof createCatalogProductWorkflow>["run"]>
          | undefined
        let later: ReturnType<typeof mutateExisting> | undefined
        try {
          creation = createCatalogProductWorkflow(container).run({
            input: {
              ...parsed,
              actorId: "user_disposable_catalog_audit",
              requestSha256: hashCatalogCommand(parsed),
            },
            throwOnError: false,
          })
          await creationPaused
          expect(
            await catalog.retrieveCatalogMediaAsset(mediaAssetId)
          ).toMatchObject({ alt_text: "Owned disposable artwork" })
          let parentOwnsSharedAsset = false
          try {
            await locking.acquire(assetKey, {
              ownerId: "disposable-shared-asset-probe",
              expire: 1,
            })
            await locking.release(assetKey, {
              ownerId: "disposable-shared-asset-probe",
            })
          } catch {
            parentOwnsSharedAsset = true
          }
          later = mutateExisting(1, "Later edit from Product A")
          if (parentOwnsSharedAsset) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100))
            expect(writes).not.toContain("Later edit from Product A")
          } else {
            // Preserve the concrete pre-fix interleaving: another Product can
            // commit before this creation rolls its shared snapshot back.
            await later
          }
          failCreation()
          const failed = await creation
          expect(failed.transaction.getState()).toBe(TransactionState.REVERTED)
          expect(
            failed.transaction.getErrors(TransactionHandlerType.COMPENSATE)
          ).toEqual([])
          const parentLease = leaseEvents.find(
            ({ action, keys }) =>
              action === "acquire" &&
              Array.isArray(keys) &&
              keys.includes(assetKey)
          )
          expect(parentLease?.owner).toMatch(/^[0-9a-f-]{36}$/u)
          expect(leaseEvents).toContainEqual({
            action: "release",
            keys: parentLease!.keys,
            owner: parentLease!.owner,
          })
          expect(
            failed.errors.some(
              ({ error }) => error?.message === failure.message
            )
          ).toBe(true)
          await later
          expect(
            await catalog.retrieveCatalogMediaAsset(mediaAssetId)
          ).toMatchObject({
            alt_text: "Later edit from Product A",
            version: baseline.version + 1,
          })
          expect(parentOwnsSharedAsset).toBe(true)
          expect(writes).toEqual([
            "Owned disposable artwork",
            "Shared asset before creation",
            "Later edit from Product A",
          ])
          expect(
            await container
              .resolve<IProductModuleService>(Modules.PRODUCT)
              .listProducts({ handle: parsed.handle! })
          ).toHaveLength(0)
          const links = await catalog.listCatalogProductMediaItems({
            media_asset_id: mediaAssetId,
          })
          expect(links).toHaveLength(1)
          expect(links[0]!.product_id).toBe(component.productId)
          await locking.acquire(assetKey, {
            ownerId: "disposable-shared-asset-probe",
            expire: 1,
          })
          await locking.release(assetKey, {
            ownerId: "disposable-shared-asset-probe",
          })
        } finally {
          failCreation()
          await Promise.allSettled(
            [creation, later].filter((pending) => !!pending)
          )
          completion.mockRestore()
          update.mockRestore()
          acquireDiagnostic.mockRestore()
          releaseDiagnostic.mockRestore()
        }
      })

      it("repairs only owned failed-creation links and retains assets/history on replay", async () => {
        const { catalog, container, identity, snapshot } =
          await failedCreationFixture()
        const before = await snapshot()
        const preview = await inspectFailedCatalogCreation(container, identity)
        const input = {
          ...identity,
          expectedManifestSha256: preview.manifestSha256,
          idempotencyKey: randomUUID(),
        }
        const repaired = await repairFailedCatalogCreation(container, input)
        expect(repaired.replayed).toBe(false)
        const after = await snapshot()
        expect(after.assets).toEqual(before.assets)
        expect(after.history).toEqual(before.history)
        for (const rows of [after.profiles, after.variants, after.media]) {
          expect(rows).toHaveLength(1)
          expect(rows[0]!.deleted_at).not.toBeNull()
        }
        expect(await repairFailedCatalogCreation(container, input)).toEqual({
          ...repaired,
          replayed: true,
        })
        expect(
          await catalog.listCatalogAuthoringOperations({
            command: "catalog.failed-creation.repair",
          })
        ).toHaveLength(1)
        await expect(
          repairFailedCatalogCreation(container, {
            ...input,
            expectedManifestSha256: "f".repeat(64),
          })
        ).rejects.toThrow("exclusive ownership")
      })

      it("rolls back every repair write when final audit completion fails", async () => {
        const { catalog, container, identity, snapshot } =
          await failedCreationFixture()
        const before = await snapshot()
        const preview = await inspectFailedCatalogCreation(container, identity)
        const input = {
          ...identity,
          expectedManifestSha256: preview.manifestSha256,
          idempotencyKey: randomUUID(),
        }
        const injected = jest
          .spyOn(catalog, "completeCatalogAuthoringOperation")
          .mockRejectedValue(
            new Error("Injected failed-creation repair completion failure")
          )
        try {
          await expect(
            repairFailedCatalogCreation(container, input)
          ).rejects.toThrow("Injected failed-creation")
          expect(await snapshot()).toEqual(before)
          expect(
            await catalog.listCatalogAuthoringOperations({
              idempotency_key: input.idempotencyKey,
            })
          ).toHaveLength(0)
        } finally {
          injected.mockRestore()
        }
        expect(
          (await inspectFailedCatalogCreation(container, identity))
            .manifestSha256
        ).toBe(preview.manifestSha256)
        expect(
          (await repairFailedCatalogCreation(container, input)).replayed
        ).toBe(false)
      })

      it.each([
        "manifest",
        "profile-version",
        "native-product",
        "child-actor",
        "child-key",
        "extra-operation",
        "media-owner",
      ] as const)(
        "rejects changed or ambiguous failed-creation ownership: %s",
        async (change) => {
          const {
            catalog,
            container,
            identity,
            profile,
            media,
            children,
            snapshot,
            component,
          } = await failedCreationFixture()
          const preview = await inspectFailedCatalogCreation(
            container,
            identity
          )
          if (change === "profile-version")
            await catalog.updateCatalogProductProfiles([
              { id: profile.id, version: 2 },
            ])
          if (change === "native-product")
            await container
              .resolve<IProductModuleService>(Modules.PRODUCT)
              .createProducts({
                id: identity.productId,
                title: "Owned restored product",
              })
          if (change === "child-actor")
            await catalog.updateCatalogAuthoringOperations([
              { id: children[0]!.id, actor_id: "user_other" },
            ])
          if (change === "child-key")
            await catalog.updateCatalogAuthoringOperations([
              { id: children[0]!.id, idempotency_key: randomUUID() },
            ])
          if (change === "extra-operation")
            await catalog.createCatalogAuthoringOperations([
              {
                command: "catalog.unrelated",
                aggregate_id: identity.productId,
                idempotency_key: randomUUID(),
                request_sha256: "e".repeat(64),
                expected_version: 0,
              },
            ])
          if (change === "media-owner")
            await catalog.updateCatalogProductMediaItems([
              { id: media.id, product_profile_id: component.profileId },
            ])
          const before = await snapshot()
          await expect(
            repairFailedCatalogCreation(container, {
              ...identity,
              expectedManifestSha256:
                change === "manifest" ? "f".repeat(64) : preview.manifestSha256,
              idempotencyKey: randomUUID(),
            })
          ).rejects.toThrow("exclusive ownership")
          expect(await snapshot()).toEqual(before)
          expect(
            await catalog.listCatalogAuthoringOperations({
              command: "catalog.failed-creation.repair",
            })
          ).toHaveLength(0)
        }
      )

      it("creates and replays fixed, mystery and merchandise drafts with real media and inventory", async () => {
        const { catalog, command, container, mediaAssetId } =
          await catalogCreationFixture()
        const products = container.resolve<IProductModuleService>(
          Modules.PRODUCT
        )
        for (const kind of [
          "fixed_bundle",
          "mystery_bundle",
          "merch",
        ] as const) {
          const parsed = command(kind)
          const input = {
            ...parsed,
            actorId: "user_disposable_catalog_audit",
            requestSha256: hashCatalogCommand(parsed),
          }
          const created = (
            await createCatalogProductWorkflow(container).run({ input })
          ).result
          expect(created).toMatchObject({ kind, replayed: false })
          expect(
            await products.retrieveProduct(created.productId)
          ).toMatchObject({
            status: "draft",
            handle: parsed.handle,
            thumbnail: (await catalog.retrieveCatalogMediaAsset(mediaAssetId))
              .source_url,
          })
          expect(
            await products.retrieveProductVariant(created.variantIds[0]!)
          ).toMatchObject({ thumbnail: null })
          const media = await catalog.listCatalogProductMediaItems({
            product_id: created.productId,
          })
          expect(media).toHaveLength(1)
          expect(media[0]).toMatchObject({
            media_asset_id: mediaAssetId,
            is_primary: true,
            sort_order: 0,
          })
          let computedVariants: unknown
          await nativeVariantList(
            {
              scope: container,
              params: { id: created.productId },
              filterableFields: {},
              queryConfig: {
                fields: ["id", "manage_inventory", "inventory_quantity"],
                pagination: { skip: 0, take: 200 },
              },
            } as unknown as Parameters<typeof nativeVariantList>[0],
            {
              json: (data: unknown) => {
                computedVariants = data
              },
            } as unknown as Parameters<typeof nativeVariantList>[1]
          )
          expect(computedVariants).toMatchObject({
            count: 1,
            variants: [
              {
                id: created.variantIds[0],
                manage_inventory: true,
                inventory_quantity: kind === "fixed_bundle" ? 10 : 3,
              },
            ],
          })
          const bundle = await catalog.listCatalogBundleProfiles({
            product_id: created.productId,
          })
          expect(bundle).toHaveLength(kind === "merch" ? 0 : 1)
          if (kind === "fixed_bundle") {
            expect(
              await catalog.listCatalogBundleComponents({
                bundle_profile_id: bundle[0]!.id,
              })
            ).toMatchObject([{ quantity: 2 }])
          }
          expect(
            (await createCatalogProductWorkflow(container).run({ input }))
              .result
          ).toEqual({ ...created, replayed: true })
          expect(
            await products.listProducts({ handle: parsed.handle! })
          ).toHaveLength(1)
          expect(
            await catalog.listCatalogProductMediaItems({
              product_id: created.productId,
            })
          ).toHaveLength(1)
          const operations = await catalog.listCatalogAuthoringOperations({
            aggregate_id: [
              created.productId,
              ...created.variantIds,
              `catalog-product-create:${parsed.idempotencyKey}`,
            ],
          })
          expect(operations.length).toBeGreaterThanOrEqual(4)
          expect(
            operations.every((operation) => operation.status === "succeeded")
          ).toBe(true)
        }
      })

      it("projects variant art, replays it, and clears native art before quarantine without restoring links", async () => {
        const { catalog, command, container, mediaAssetId } =
          await catalogCreationFixture()
        const products = container.resolve<IProductModuleService>(
          Modules.PRODUCT
        )
        const parsed = command("merch", "native-media-lifecycle")
        const created = (
          await createCatalogProductWorkflow(container).run({
            input: {
              ...parsed,
              actorId: "user_disposable_catalog_audit",
              requestSha256: hashCatalogCommand(parsed),
            },
          })
        ).result
        const replacement = {
          actorId: "user_disposable_catalog_audit",
          aggregateId: created.productId,
          command: "catalog.product-media.replace" as const,
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          requestSha256: "f".repeat(64),
          media: [
            {
              sourceUrl: "https://media.example.com/native-variant.webp",
              variantId: created.variantIds[0]!,
              isPrimary: true,
            },
          ],
        }
        const changed = (
          await mutateCatalogProductMediaWorkflow(container).run({
            input: replacement,
          })
        ).result
        expect(changed).toMatchObject({ version: 2, replayed: false })
        expect(await products.retrieveProduct(created.productId)).toMatchObject(
          { thumbnail: replacement.media[0]!.sourceUrl }
        )
        expect(
          await products.retrieveProductVariant(created.variantIds[0]!)
        ).toMatchObject({ thumbnail: replacement.media[0]!.sourceUrl })
        const updateProduct = jest.spyOn(products, "updateProducts")
        const updateVariant = jest.spyOn(products, "updateProductVariants")
        try {
          expect(
            (
              await mutateCatalogProductMediaWorkflow(container).run({
                input: replacement,
              })
            ).result
          ).toMatchObject({ replayed: true, version: 2 })
          expect(updateProduct).not.toHaveBeenCalled()
          expect(updateVariant).not.toHaveBeenCalled()
        } finally {
          updateProduct.mockRestore()
          updateVariant.mockRestore()
        }
        const linked = (
          await catalog.listCatalogProductMediaItems({
            product_id: created.productId,
          })
        )[0]!
        const empty: CatalogProductMediaMutationInput = {
          ...replacement,
          expectedVersion: 2,
          idempotencyKey: randomUUID(),
          requestSha256: "a".repeat(64),
          media: [],
        }
        await mutateCatalogProductMediaWorkflow(container).run({ input: empty })
        expect(await products.retrieveProduct(created.productId)).toMatchObject(
          { thumbnail: null }
        )
        expect(
          await products.retrieveProductVariant(created.variantIds[0]!)
        ).toMatchObject({ thumbnail: null })
        for (const assetId of [mediaAssetId, linked.media_asset_id]) {
          const asset = readCatalogMediaAsset(
            await catalog.retrieveCatalogMediaAsset(assetId),
            assetId
          )
          const quarantined = (
            await mutateCatalogMediaLifecycleWorkflow(container).run({
              input: {
                actorId: "user_disposable_catalog_audit",
                assetId,
                command: "catalog.media.quarantine",
                expectedVersion: asset.version,
                idempotencyKey: randomUUID(),
                requestSha256: "b".repeat(64),
              },
            })
          ).result
          await mutateCatalogMediaLifecycleWorkflow(container).run({
            input: {
              actorId: "user_disposable_catalog_audit",
              assetId,
              command: "catalog.media.restore",
              expectedVersion: quarantined.version,
              idempotencyKey: randomUUID(),
              requestSha256: "c".repeat(64),
            },
          })
        }
        expect(
          await catalog.listCatalogProductMediaItems({
            product_id: created.productId,
          })
        ).toEqual([])
        expect(await products.retrieveProduct(created.productId)).toMatchObject(
          { thumbnail: null }
        )
        expect(
          await products.retrieveProductVariant(created.variantIds[0]!)
        ).toMatchObject({ thumbnail: null })
      })

      it.each([
        "before-native-write",
        "after-native-write",
        "operation-completion",
      ] as const)(
        "restores persisted native art and exact Catalog links when %s fails",
        async (failureBoundary) => {
          const { catalog, command, container } = await catalogCreationFixture()
          const products = container.resolve<IProductModuleService>(
            Modules.PRODUCT
          )
          const parsed = command("merch", `artwork-${failureBoundary}`)
          const created = (
            await createCatalogProductWorkflow(container).run({
              input: {
                ...parsed,
                actorId: "user_disposable_catalog_audit",
                requestSha256: hashCatalogCommand(parsed),
              },
            })
          ).result
          const priorProduct = await products.retrieveProduct(created.productId)
          const priorVariant = await products.retrieveProductVariant(
            created.variantIds[0]!
          )
          const priorLinks = await catalog.listCatalogProductMediaItems({
            product_id: created.productId,
          })
          const failure = new Error(
            `Injected disposable artwork ${failureBoundary}`
          )
          const replacement: CatalogProductMediaMutationInput = {
            actorId: "user_disposable_catalog_audit",
            aggregateId: created.productId,
            command: "catalog.product-media.replace",
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
            requestSha256: "f".repeat(64),
            media: [
              {
                sourceUrl: "https://media.example.com/replacement.webp",
                isPrimary: true,
                sortOrder: 0,
              },
              {
                sourceUrl: "https://media.example.com/variant.webp",
                variantId: created.variantIds[0]!,
                isPrimary: true,
                sortOrder: 1,
              },
            ],
          }
          const originalVariant = products.updateProductVariants.bind(products)
          const originalComplete =
            catalog.completeCatalogAuthoringOperation.bind(catalog)
          const locking = container.resolve<ILockingModule>(Modules.LOCKING)
          const productMediaKey = `catalog:product-media:${created.productId}`
          const originalProductUpdate = products.updateProducts.bind(products)
          const originalMediaDelete =
            catalog.deleteCatalogProductMediaItems.bind(catalog)
          const protectedRestoration: string[] = []
          const nativeRestoration = jest
            .spyOn(products, "updateProducts")
            .mockImplementation((async (
              ...args: Parameters<typeof products.updateProducts>
            ) => {
              if (
                args[1] &&
                "thumbnail" in args[1] &&
                args[1].thumbnail === priorProduct.thumbnail
              ) {
                await expect(
                  locking.acquire(productMediaKey, {
                    ownerId: "disposable-probe",
                    expire: 1,
                  })
                ).rejects.toThrow()
                protectedRestoration.push("native")
              }
              return originalProductUpdate(...args)
            }) as typeof products.updateProducts)
          const canonicalRestoration = jest
            .spyOn(catalog, "deleteCatalogProductMediaItems")
            .mockImplementation(async (ids, context) => {
              await expect(
                locking.acquire(productMediaKey, {
                  ownerId: "disposable-probe",
                  expire: 1,
                })
              ).rejects.toThrow()
              protectedRestoration.push("canonical")
              return originalMediaDelete(ids, context)
            })
          const injected =
            failureBoundary === "operation-completion"
              ? jest
                  .spyOn(catalog, "completeCatalogAuthoringOperation")
                  .mockImplementation(async (id, result, context) => {
                    const operation = (
                      await catalog.listCatalogAuthoringOperations(
                        { id },
                        { take: 1 },
                        context
                      )
                    )[0]
                    if (operation?.command === "catalog.product-media.replace")
                      throw failure
                    return originalComplete(id, result, context)
                  })
              : jest
                  .spyOn(products, "updateProductVariants")
                  .mockImplementation((async (
                    ...args: Parameters<typeof products.updateProductVariants>
                  ) => {
                    if (
                      args[1] &&
                      "thumbnail" in args[1] &&
                      args[1].thumbnail === replacement.media[1]!.sourceUrl
                    ) {
                      if (failureBoundary === "after-native-write")
                        await originalVariant(...args)
                      throw failure
                    }
                    return originalVariant(...args)
                  }) as typeof products.updateProductVariants)
          try {
            const execution = await mutateCatalogProductMediaWorkflow(
              container
            ).run({ input: replacement, throwOnError: false })
            expect(
              execution.errors.some(
                ({ error }) => error?.message === failure.message
              )
            ).toBe(true)
            expect(
              await products.retrieveProduct(created.productId)
            ).toMatchObject({
              thumbnail: priorProduct.thumbnail,
              title: priorProduct.title,
            })
            expect(
              await products.retrieveProductVariant(created.variantIds[0]!)
            ).toMatchObject({
              thumbnail: priorVariant.thumbnail,
              sku: priorVariant.sku,
            })
            expect(
              (
                await catalog.listCatalogProductMediaItems({
                  product_id: created.productId,
                })
              ).map(
                ({
                  created_at: _createdAt,
                  updated_at: _updatedAt,
                  ...state
                }) => state
              )
            ).toEqual(
              priorLinks.map(
                ({
                  created_at: _createdAt,
                  updated_at: _updatedAt,
                  ...state
                }) => state
              )
            )
            expect(
              await catalog.listCatalogMediaAssets({
                source_url: replacement.media.map(
                  ({ sourceUrl }) => sourceUrl!
                ),
              })
            ).toEqual([])
            expect(
              await catalog.listCatalogAuthoringOperations({
                idempotency_key: replacement.idempotencyKey,
              })
            ).toMatchObject([{ status: "compensated" }])
            expect(protectedRestoration).toEqual([
              "canonical",
              "native",
              "canonical",
            ])
            await locking.acquire(productMediaKey, {
              ownerId: "disposable-probe",
              expire: 1,
            })
            await locking.release(productMediaKey, {
              ownerId: "disposable-probe",
            })
          } finally {
            injected.mockRestore()
            nativeRestoration.mockRestore()
            canonicalRestoration.mockRestore()
          }
        }
      )

      it("clears legacy native overrides when an empty managed profile is adopted", async () => {
        const container = getContainer()
        const products = container.resolve<IProductModuleService>(
          Modules.PRODUCT
        )
        const legacy = await products.createProducts({
          title: "Legacy native art",
          thumbnail: "https://media.example.com/legacy.webp",
          options: [{ title: "Format", values: ["CD"] }],
          variants: [
            {
              title: "CD",
              options: { Format: "CD" },
            },
          ],
        })
        await products.updateProductVariants(legacy.variants[0]!.id, {
          thumbnail: "https://media.example.com/legacy-variant.webp",
        })
        await mutateCatalogProductProfileWorkflow(container).run({
          input: {
            actorId: "user_disposable_catalog_audit",
            aggregateId: legacy.id,
            command: "catalog.product-profile.upsert",
            expectedVersion: 0,
            idempotencyKey: randomUUID(),
            requestSha256: "a".repeat(64),
            patch: { releaseTitle: legacy.title },
          },
        })
        expect(await products.retrieveProduct(legacy.id)).toMatchObject({
          thumbnail: null,
        })
        expect(
          await products.retrieveProductVariant(legacy.variants[0]!.id)
        ).toMatchObject({ thumbnail: null })
        for (const [handler, params] of [
          [guardedNativeProductUpdate, { id: legacy.id }],
          [
            guardedNativeVariantUpdate,
            { id: legacy.id, variant_id: legacy.variants[0]!.id },
          ],
        ] as const) {
          let status: number | undefined
          let response: unknown
          const res = {
            setHeader: jest.fn(),
            type: jest.fn(),
            status: (value: number) => {
              status = value
              return res
            },
            json: (value: unknown) => {
              response = value
            },
          }
          await handler(
            {
              scope: container,
              params,
              path: "/admin/products/disposable-artwork",
              validatedBody: {
                thumbnail: "https://media.example.com/bypass.webp",
              },
            } as unknown as Parameters<typeof handler>[0],
            res as unknown as Parameters<typeof handler>[1]
          )
          expect(status).toBe(409)
          expect(response).toMatchObject({
            code: "catalog_media_authoring_required",
          })
        }
        expect(await products.retrieveProduct(legacy.id)).toMatchObject({
          thumbnail: null,
        })
        expect(
          await products.retrieveProductVariant(legacy.variants[0]!.id)
        ).toMatchObject({ thumbnail: null })
      })

      it("holds the real media lease through failed profile completion and both restorations", async () => {
        const container = getContainer()
        const catalog = container.resolve<CatalogService>("catalog")
        const products = container.resolve<IProductModuleService>(
          Modules.PRODUCT
        )
        const locking = container.resolve<ILockingModule>(Modules.LOCKING)
        const legacy = await products.createProducts({
          title: "Failed native artwork adoption",
          thumbnail: "https://media.example.com/legacy.webp",
        })
        const key = `catalog:product-media:${legacy.id}`
        const command = {
          actorId: "user_disposable_catalog_audit",
          aggregateId: legacy.id,
          command: "catalog.product-profile.upsert" as const,
          expectedVersion: 0,
          idempotencyKey: randomUUID(),
          requestSha256: "a".repeat(64),
          patch: { releaseTitle: legacy.title },
        }
        const failure = new Error(
          "Injected disposable profile completion failure"
        )
        const originalUpdate = products.updateProducts.bind(products)
        const originalDelete =
          catalog.deleteCatalogProductProfiles.bind(catalog)
        const restored: string[] = []
        const native = jest
          .spyOn(products, "updateProducts")
          .mockImplementation((async (
            ...args: Parameters<typeof products.updateProducts>
          ) => {
            if (
              args[1] &&
              "thumbnail" in args[1] &&
              args[1].thumbnail === legacy.thumbnail
            ) {
              await expect(
                locking.acquire(key, { ownerId: "disposable-probe", expire: 1 })
              ).rejects.toThrow()
              restored.push("native")
            }
            return originalUpdate(...args)
          }) as typeof products.updateProducts)
        const canonical = jest
          .spyOn(catalog, "deleteCatalogProductProfiles")
          .mockImplementation(async (ids, context) => {
            await expect(
              locking.acquire(key, { ownerId: "disposable-probe", expire: 1 })
            ).rejects.toThrow()
            restored.push("canonical")
            return originalDelete(ids, context)
          })
        const persistence = jest
          .spyOn(catalog, "completeCatalogAuthoringOperation")
          .mockRejectedValue(failure)
        try {
          const result = await mutateCatalogProductProfileWorkflow(
            container
          ).run({ input: command, throwOnError: false })
          expect(
            result.errors.some(
              ({ error }) => error?.message === failure.message
            )
          ).toBe(true)
          expect(await products.retrieveProduct(legacy.id)).toMatchObject({
            thumbnail: legacy.thumbnail,
          })
          expect(
            await catalog.listCatalogProductProfiles({ product_id: legacy.id })
          ).toEqual([])
          expect(
            await catalog.listCatalogAuthoringOperations({
              idempotency_key: command.idempotencyKey,
            })
          ).toMatchObject([{ status: "compensated" }])
          expect(restored).toEqual(["native", "canonical"])
          await locking.acquire(key, { ownerId: "disposable-probe", expire: 1 })
          await locking.release(key, { ownerId: "disposable-probe" })
        } finally {
          native.mockRestore()
          canonical.mockRestore()
          persistence.mockRestore()
        }
      })

      it("retains committed native and Catalog artwork when successful-operation lease cleanup fails", async () => {
        const { catalog, command, container } = await catalogCreationFixture()
        const parsed = command("merch", "committed-artwork-cleanup")
        const created = (
          await createCatalogProductWorkflow(container).run({
            input: {
              ...parsed,
              actorId: "user_disposable_catalog_audit",
              requestSha256: hashCatalogCommand(parsed),
            },
          })
        ).result
        const locking = container.resolve<ILockingModule>(Modules.LOCKING)
        const originalRelease = locking.release.bind(locking)
        let failedLease:
          | { keys: string | string[]; ownerId: string }
          | undefined
        const release = jest
          .spyOn(locking, "release")
          .mockImplementation(async (keys, options) => {
            const list = Array.isArray(keys) ? keys : [keys]
            if (
              list.includes(`catalog:product-media:${created.productId}`) &&
              options?.ownerId
            ) {
              failedLease = { keys, ownerId: options.ownerId }
              throw new Error("Injected disposable committed release failure")
            }
            return originalRelease(keys, options)
          })
        const warning = jest.spyOn(
          container.resolve<Logger>(ContainerRegistrationKeys.LOGGER),
          "warn"
        )
        const replacement: CatalogProductMediaMutationInput = {
          actorId: "user_disposable_catalog_audit",
          aggregateId: created.productId,
          command: "catalog.product-media.replace",
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          requestSha256: "d".repeat(64),
          media: [
            {
              sourceUrl: "https://media.example.com/committed.webp",
              isPrimary: true,
            },
          ],
        }
        try {
          const result = await mutateCatalogProductMediaWorkflow(container).run(
            { input: replacement }
          )
          expect(result.errors).toEqual([])
          expect(result.result).toMatchObject({ version: 2, replayed: false })
          expect(
            await container
              .resolve<IProductModuleService>(Modules.PRODUCT)
              .retrieveProduct(created.productId)
          ).toMatchObject({ thumbnail: replacement.media[0]!.sourceUrl })
          expect(
            await catalog.listCatalogProductMediaItems({
              product_id: created.productId,
            })
          ).toHaveLength(1)
          expect(
            await catalog.listCatalogAuthoringOperations({
              idempotency_key: replacement.idempotencyKey,
            })
          ).toMatchObject([{ status: "succeeded" }])
          expect(warning).toHaveBeenCalledWith(
            expect.stringContaining("120-second lease")
          )
          expect(failedLease).toBeDefined()
        } finally {
          release.mockRestore()
          warning.mockRestore()
          if (failedLease)
            await originalRelease(failedLease.keys, {
              ownerId: failedLease.ownerId,
            })
        }
      })

      it("does not release a subsequent owner's real Redis lease after cleanup times out", async () => {
        const container = getContainer()
        const locking = container.resolve<ILockingModule>(Modules.LOCKING)
        const key = `catalog:product-media:prod_disposable_${randomUUID().replaceAll("-", "")}`
        const oldOwner = randomUUID()
        const nextOwner = randomUUID()
        await locking.acquire(key, { ownerId: oldOwner, expire: 1 })
        const originalRelease = locking.release.bind(locking)
        let unblock: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          unblock = resolve
        })
        let late: Promise<boolean> | undefined
        const release = jest
          .spyOn(locking, "release")
          .mockImplementation((keys, options) => {
            if (options?.ownerId === oldOwner) {
              late = gate.then(() => originalRelease(keys, options))
              return late
            }
            return originalRelease(keys, options)
          })
        try {
          await releaseCommittedCatalogMediaLease(container, {
            keys: [key],
            ownerId: oldOwner,
          })
          await locking.acquire(key, { ownerId: nextOwner, expire: 120 })
          unblock()
          await expect(late).resolves.toBe(false)
          await expect(
            locking.acquire(key, { ownerId: "disposable-probe", expire: 1 })
          ).rejects.toThrow()
        } finally {
          unblock()
          await late?.catch(() => false)
          release.mockRestore()
          await originalRelease(key, { ownerId: nextOwner })
          await originalRelease(key, { ownerId: oldOwner })
        }
      })

      it("snapshots managed art through native Store cart completion and preserves completed and historical order artwork", async () => {
        const {
          catalog,
          command,
          container,
          channel,
          location,
          shippingProfile,
        } = await catalogCreationFixture()
        const products = container.resolve<IProductModuleService>(
          Modules.PRODUCT
        )
        const parsed = command("merch", "artwork-checkout")
        const created = (
          await createCatalogProductWorkflow(container).run({
            input: {
              ...parsed,
              actorId: "user_disposable_catalog_audit",
              requestSha256: hashCatalogCommand(parsed),
            },
          })
        ).result
        const originalArtwork = (
          await products.retrieveProduct(created.productId)
        ).thumbnail
        expect(originalArtwork).toMatch(/^https:\/\/media\.example\.com\//u)
        await products.updateProducts(created.productId, {
          status: "published",
        })
        const region = await container
          .resolve<IRegionModuleService>(Modules.REGION)
          .createRegions({
            name: "Disposable artwork checkout",
            currency_code: "usd",
            countries: ["us"],
          })
        const fulfillment = container.resolve<IFulfillmentModuleService>(
          Modules.FULFILLMENT
        )
        const set = await fulfillment.createFulfillmentSets({
          name: "Disposable artwork delivery",
          type: "shipping",
          service_zones: [
            {
              name: "US",
              geo_zones: [{ country_code: "us", type: "country" }],
            },
          ],
        })
        const link = container.resolve(ContainerRegistrationKeys.LINK)
        await linkSalesChannelsToStockLocationWorkflow(container).run({
          input: {
            id: location.id,
            add: [channel.id],
          },
        })
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
        })
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: {
            fulfillment_provider_id: "per_item_standard",
          },
        })
        const { result: options } = await createShippingOptionsWorkflow(
          container
        ).run({
          input: [
            {
              name: "Disposable artwork shipping",
              price_type: "calculated",
              provider_id: "per_item_standard",
              service_zone_id: set.service_zones![0]!.id,
              shipping_profile_id: shippingProfile.id,
              type: {
                label: "Standard",
                code: "standard",
                description: "Disposable delivery",
              },
              data: {
                base_amount: 1,
                additional_amount: 0,
                currency_code: "usd",
              },
            },
          ],
        })
        const taxes = container.resolve<ITaxModuleService>(Modules.TAX)
        const taxProvider = (await taxes.listTaxProviders()).find(({ id }) =>
          id.includes("rate_lookup")
        )!
        await taxes.createTaxRegions({
          country_code: "us",
          provider_id: taxProvider.id,
        })
        expect(
          (
            await container
              .resolve<TaxControlModuleService>("tax_control")
              .ensureTaxProviderControl()
          ).collection_mode
        ).toBe("disabled")
        const { result: keys } = await createApiKeysWorkflow(container).run({
          input: {
            api_keys: [
              {
                type: "publishable",
                title: "Disposable artwork Store",
                created_by: "user_disposable_catalog_audit",
              },
            ],
          },
        })
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: keys[0]!.id, add: [channel.id] },
        })
        const headers = { "x-publishable-api-key": keys[0]!.token }
        const started = await api.post(
          "/store/carts",
          {
            region_id: region.id,
            sales_channel_id: channel.id,
            email: "artwork-checkout@example.test",
            shipping_address: {
              first_name: "Disposable",
              last_name: "Artwork",
              address_1: "123 Test Street",
              city: "Los Angeles",
              province: "ca",
              postal_code: "90001",
              country_code: "us",
            },
          },
          { headers }
        )
        const cartId = started.data.cart.id as string
        const added = await api.post(
          `/store/carts/${cartId}/line-items`,
          { variant_id: created.variantIds[0]!, quantity: 1 },
          { headers }
        )
        expect(added.data.cart.items).toMatchObject([
          { thumbnail: originalArtwork, variant_id: created.variantIds[0]! },
        ])
        await api.post(
          `/store/carts/${cartId}/shipping-methods`,
          { option_id: options[0]!.id },
          { headers }
        )
        // Like checkout payment binding, refresh every tax subject together
        // after delivery selection so item and shipping fingerprints agree.
        await api.post(`/store/carts/${cartId}/taxes`, {}, { headers })
        const cart = (
          await api.get(
            `/store/carts/${cartId}?fields=+items.tax_lines.data,+shipping_methods.tax_lines.data`,
            { headers }
          )
        ).data.cart
        const quote = taxQuoteIdentityFromCart(cart)
        const payments = container.resolve<IPaymentModuleService>(
          Modules.PAYMENT
        )
        const transport = await installDisposableStripeTransport(payments)
        try {
          const { result: collection } =
            await createPaymentCollectionForCartWorkflow(container).run({
              input: { cart_id: cartId },
            })
          const session = await payments.createPaymentSession(collection.id, {
            provider_id: "pp_stripe_stripe",
            currency_code: "usd",
            amount: cart.total,
            data: {
              metadata: {
                medusa_cart_id: cartId,
                rr_tax_collection_mode: quote.collectionMode,
                rr_tax_generation: String(quote.generation),
                rr_tax_fingerprint: quote.fingerprint,
                rr_tax_provider: quote.provider ?? "",
                rr_tax_calculation_id: quote.calculationId ?? "",
              },
            },
          })
          transport.confirm(session.data.id)
          const completed = await api.post(
            `/store/carts/${cartId}/complete`,
            {},
            { headers }
          )
          expect(completed.data.type).toBe("order")
          const orderId = completed.data.order.id as string
          expect(completed.data.order.items).toMatchObject([
            { thumbnail: originalArtwork, variant_id: created.variantIds[0]! },
          ])
          const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
          const order = await orders.retrieveOrder(orderId, {
            relations: ["items"],
          })
          expect(order.items).toMatchObject([{ thumbnail: originalArtwork }])
          expect(
            (
              await payments.retrievePaymentCollection(collection.id, {
                relations: ["payments", "payments.captures"],
              })
            ).payments
          ).toMatchObject([
            {
              captured_at: expect.any(Date),
              captures: [expect.objectContaining({ amount: cart.total })],
            },
          ])
          const historical = await orders.createOrders({
            currency_code: "usd",
            email: "historical-artwork@example.test",
            items: [
              {
                title: "Historical missing art",
                quantity: 1,
                unit_price: 3.57,
                variant_id: created.variantIds[0]!,
                product_id: created.productId,
              },
            ],
          })
          await mutateCatalogProductMediaWorkflow(container).run({
            input: {
              actorId: "user_disposable_catalog_audit",
              aggregateId: created.productId,
              command: "catalog.product-media.replace",
              expectedVersion: 1,
              idempotencyKey: randomUUID(),
              requestSha256: "d".repeat(64),
              media: [
                {
                  sourceUrl: "https://media.example.com/new-current-cover.webp",
                  isPrimary: true,
                },
              ],
            },
          })
          expect(
            await products.retrieveProduct(created.productId)
          ).toMatchObject({
            thumbnail: "https://media.example.com/new-current-cover.webp",
          })
          expect(
            (await orders.retrieveOrder(orderId, { relations: ["items"] }))
              .items
          ).toMatchObject([{ thumbnail: originalArtwork }])
          expect(
            (
              await orders.retrieveOrder(historical.id, {
                relations: ["items"],
              })
            ).items
          ).toMatchObject([{ thumbnail: null }])
          expect(
            (
              await container
                .resolve<ICartModuleService>(Modules.CART)
                .retrieveCart(cartId, { relations: ["items"] })
            ).items
          ).toMatchObject([{ thumbnail: originalArtwork }])
          const replay = await api.post(
            `/store/carts/${cartId}/complete`,
            {},
            { headers }
          )
          expect(replay.data).toMatchObject({
            type: "order",
            order: { id: orderId },
          })
          expect(transport.unexpectedRequests).toEqual([])
          expect(transport.requests).toContainEqual({
            method: "POST",
            path: "/v1/payment_intents",
          })
          expect(transport.requests).toContainEqual({
            method: "GET",
            path: "/v1/payment_intents/pi_disposable_1",
          })
        } finally {
          transport.restore()
        }
      })

      it.each(["bundle-inventory", "outer-completion"] as const)(
        "rolls back native draft, profiles and media when %s fails",
        async (failureBoundary) => {
          const { catalog, command, container, mediaAssetId } =
            await catalogCreationFixture()
          const parsed = command("fixed_bundle", `failed-${failureBoundary}`)
          const database = knex({
            client: "pg",
            connection: dbConfig.clientUrl,
          })
          const originalComplete =
            catalog.completeCatalogAuthoringOperation.bind(catalog)
          const originalInventory =
            catalog.replaceBundleInventoryLinks.bind(catalog)
          const products = container.resolve<IProductModuleService>(
            Modules.PRODUCT
          )
          const locking = container.resolve<ILockingModule>(Modules.LOCKING)
          const originalProductUpdate = products.updateProducts.bind(products)
          const originalMediaDelete =
            catalog.deleteCatalogProductMediaItems.bind(catalog)
          const protectedRollback: string[] = []
          const nativeRollback = jest
            .spyOn(products, "updateProducts")
            .mockImplementation((async (
              ...args: Parameters<typeof products.updateProducts>
            ) => {
              if (
                typeof args[0] === "string" &&
                args[1] &&
                "thumbnail" in args[1] &&
                args[1].thumbnail === null
              ) {
                await expect(
                  locking.acquire(`catalog:product-media:${args[0]}`, {
                    ownerId: "disposable-probe",
                    expire: 1,
                  })
                ).rejects.toThrow()
                protectedRollback.push("native")
              }
              return originalProductUpdate(...args)
            }) as typeof products.updateProducts)
          const canonicalRollback = jest
            .spyOn(catalog, "deleteCatalogProductMediaItems")
            .mockImplementation(async (ids, context) => {
              const rows = await catalog.listCatalogProductMediaItems(
                { id: Array.isArray(ids) ? ids : [ids] },
                {},
                context
              )
              for (const productId of new Set(
                rows.map(({ product_id }) => product_id)
              )) {
                await expect(
                  locking.acquire(`catalog:product-media:${productId}`, {
                    ownerId: "disposable-probe",
                    expire: 1,
                  })
                ).rejects.toThrow()
              }
              protectedRollback.push("canonical")
              return originalMediaDelete(ids, context)
            })
          const failure = new Error(
            `Injected disposable ${failureBoundary} failure`
          )
          const injected =
            failureBoundary === "bundle-inventory"
              ? jest
                  .spyOn(catalog, "replaceBundleInventoryLinks")
                  .mockImplementation(async (id, links, context) => {
                    // Exhaust the injected boundary deliberately; retain the real
                    // workflow's retry configuration for ordinary transient errors.
                    if (links.length)
                      StepResponse.permanentFailure(failure.message)
                    return originalInventory(id, links, context)
                  })
              : jest
                  .spyOn(catalog, "completeCatalogAuthoringOperation")
                  .mockImplementation(async (id, result, context) => {
                    const operation = (
                      await catalog.listCatalogAuthoringOperations(
                        { id },
                        { take: 1 },
                        context
                      )
                    )[0]
                    if (operation?.command === "catalog.product.create")
                      throw failure
                    return originalComplete(id, result, context)
                  })
          try {
            const execution = await createCatalogProductWorkflow(container).run(
              {
                input: {
                  ...parsed,
                  actorId: "user_disposable_catalog_audit",
                  requestSha256: hashCatalogCommand(parsed),
                },
                throwOnError: false,
              }
            )
            expect(
              execution.errors.some(
                ({ error }) => error?.message === failure.message
              )
            ).toBe(true)
            expect(
              await container
                .resolve<IProductModuleService>(Modules.PRODUCT)
                .listProducts({ handle: parsed.handle! })
            ).toHaveLength(0)
            // These are real PostgreSQL rows, not mocked step acknowledgements.
            expect(
              await database("catalog_product_media")
                .where({ media_asset_id: mediaAssetId })
                .whereNull("deleted_at")
            ).toHaveLength(0)
            expect(
              await database("catalog_bundle_profiles")
                .where({ display_title: parsed.title })
                .whereNull("deleted_at")
            ).toHaveLength(0)
            expect(
              await database("catalog_product_profiles")
                .where({ release_title: parsed.title })
                .whereNull("deleted_at")
            ).toHaveLength(0)
            const profileOperation = await database(
              "catalog_authoring_operations"
            )
              .where({
                idempotency_key: deriveCatalogCommandIdempotencyKey(
                  parsed.idempotencyKey,
                  "product-profile"
                ),
              })
              .first()
            expect(typeof profileOperation?.aggregate_id).toBe("string")
            expect(
              await database("catalog_variant_profiles")
                .whereIn(
                  "product_profile_id",
                  database("catalog_product_profiles")
                    .select("id")
                    .where({ product_id: profileOperation.aggregate_id })
                )
                .whereNull("deleted_at")
            ).toHaveLength(0)
            const creation = await database("catalog_authoring_operations")
              .where({ idempotency_key: parsed.idempotencyKey })
              .first()
            expect(creation).toMatchObject({ status: "compensated" })
            expect(
              await catalog.retrieveCatalogMediaAsset(mediaAssetId)
            ).toMatchObject({ lifecycle_status: "active" })
            expect(protectedRollback).toEqual(["native", "canonical"])
          } finally {
            injected.mockRestore()
            nativeRollback.mockRestore()
            canonicalRollback.mockRestore()
            await database.destroy()
          }
        }
      )

      it("restores an existing bundle without deleting its inventory provenance", async () => {
        const { catalog, command, container } = await catalogCreationFixture()
        const parsed = command("fixed_bundle")
        const created = (
          await createCatalogProductWorkflow(container).run({
            input: {
              ...parsed,
              actorId: "user_disposable_catalog_audit",
              requestSha256: hashCatalogCommand(parsed),
            },
          })
        ).result
        const previous = readCatalogBundleStateProfiles(
          await catalog.listCatalogBundleProfiles({
            product_id: created.productId,
          }),
          created.productId
        )[0]!
        const components = readCatalogBundleComponentStates(
          await catalog.listCatalogBundleComponents({
            bundle_profile_id: previous.id,
          }),
          previous.id,
          100
        )
        const provenance = await catalog.listCatalogBundleInventoryLinks({
          bundle_profile_id: previous.id,
        })
        expect(provenance).toHaveLength(1)
        const { id: _id, version: _version, ...profile } = previous
        const changed = await catalog.mutateBundle({
          actorId: "user_disposable_catalog_audit",
          aggregateId: created.productId,
          command: "catalog.bundle.upsert",
          expectedVersion: previous.version,
          idempotencyKey: randomUUID(),
          requestSha256: "a".repeat(64),
          profile: { ...profile, display_title: "Disposable changed bundle" },
          components: components.map(
            ({
              id: _componentId,
              bundle_profile_id: _profileId,
              ...component
            }) => ({ ...component, quantity: 3 })
          ),
        })
        expect(changed.version).toBe(2)
        await catalog.compensateBundleMutation({
          aggregateId: created.productId,
          operationId: changed.operationId,
          previous: changed.previous,
        })
        expect(
          readCatalogBundleStateProfiles(
            await catalog.listCatalogBundleProfiles({
              product_id: created.productId,
            }),
            created.productId
          )
        ).toEqual([previous])
        expect(
          readCatalogBundleComponentStates(
            await catalog.listCatalogBundleComponents({
              bundle_profile_id: previous.id,
            }),
            previous.id,
            100
          )
        ).toEqual(components)
        expect(
          await catalog.listCatalogBundleInventoryLinks({
            bundle_profile_id: previous.id,
          })
        ).toEqual(provenance)
      })

      it.each([true, false])(
        "preserves bundle ownership through deletion (completion failure=%s)",
        async (failCompletion) => {
          const { catalog, command, container } = await catalogCreationFixture()
          const parsed = command("fixed_bundle")
          const created = (
            await createCatalogProductWorkflow(container).run({
              input: {
                ...parsed,
                actorId: "user_disposable_catalog_audit",
                requestSha256: hashCatalogCommand(parsed),
              },
            })
          ).result
          const profiles = await catalog.listCatalogBundleProfiles({
            product_id: created.productId,
          })
          const profile = profiles[0]!
          const components = await catalog.listCatalogBundleComponents({
            bundle_profile_id: profile.id,
          })
          const provenance = await catalog.listCatalogBundleInventoryLinks({
            bundle_profile_id: profile.id,
          })
          expect(provenance).toHaveLength(1)
          const query = container.resolve(ContainerRegistrationKeys.QUERY)
          const nativeLinks = async () =>
            (
              await query.graph({
                entity: "product_variant",
                fields: [
                  "id",
                  "inventory_items.inventory_item_id",
                  "inventory_items.required_quantity",
                ],
                filters: { id: created.variantIds },
              })
            ).data
          const originalNativeLinks = await nativeLinks()
          const input = {
            actorId: "user_disposable_catalog_audit",
            aggregateId: created.productId,
            command: "catalog.bundle.delete" as const,
            expectedVersion: profile.version,
            idempotencyKey: randomUUID(),
            requestSha256: "b".repeat(64),
            profile: null,
            components: [],
          }
          const failure = new Error(
            "Injected disposable bundle-delete completion failure"
          )
          const originalComplete =
            catalog.completeCatalogAuthoringOperation.bind(catalog)
          const injected = failCompletion
            ? jest
                .spyOn(catalog, "completeCatalogAuthoringOperation")
                .mockImplementation(async (id, result, context) => {
                  if (result.deleted === true) throw failure
                  return originalComplete(id, result, context)
                })
            : null
          try {
            const execution = await mutateCatalogBundleWorkflow(container).run({
              input,
              throwOnError: false,
            })
            if (failCompletion) {
              expect(
                execution.errors.some(
                  ({ error }) => error?.message === failure.message
                )
              ).toBe(true)
              expect(
                readCatalogBundleStateProfiles(
                  await catalog.listCatalogBundleProfiles({
                    product_id: created.productId,
                  }),
                  created.productId
                )
              ).toEqual(
                readCatalogBundleStateProfiles(profiles, created.productId)
              )
              expect(
                readCatalogBundleComponentStates(
                  await catalog.listCatalogBundleComponents({
                    bundle_profile_id: profile.id,
                  }),
                  profile.id,
                  100
                )
              ).toEqual(
                readCatalogBundleComponentStates(components, profile.id, 100)
              )
              expect(
                readCatalogBundleInventoryLinks(
                  await catalog.listCatalogBundleInventoryLinks({
                    bundle_profile_id: profile.id,
                  }),
                  profile.id
                )
              ).toEqual(readCatalogBundleInventoryLinks(provenance, profile.id))
              expect(await nativeLinks()).toEqual(originalNativeLinks)
              expect(
                await catalog.listCatalogAuthoringOperations({
                  idempotency_key: input.idempotencyKey,
                })
              ).toMatchObject([{ status: "compensated" }])
            } else {
              expect(execution.errors).toHaveLength(0)
              expect(execution.result.result).toMatchObject({
                deleted: true,
                productId: created.productId,
              })
              expect(
                await catalog.listCatalogBundleProfiles({
                  product_id: created.productId,
                })
              ).toHaveLength(0)
              expect(
                await catalog.listCatalogBundleInventoryLinks({
                  bundle_profile_id: profile.id,
                })
              ).toHaveLength(0)
              expect(await nativeLinks()).toMatchObject([
                { id: created.variantIds[0], inventory_items: [] },
              ])
              expect(
                (await mutateCatalogBundleWorkflow(container).run({ input }))
                  .result
              ).toMatchObject({ replayed: true })
            }
          } finally {
            injected?.mockRestore()
          }
        }
      )

      it("persists and replays native tax evidence for every collection mode", async () => {
        const service =
          getContainer().resolve<TaxControlModuleService>("tax_control")
        for (const provider of ["stripe_tax", "taxrate_io", null] as const) {
          const suffix = randomUUID().replaceAll("-", "")
          const input = {
            amountMinor: 623,
            calculationId:
              provider === "stripe_tax" ? `taxcalc_${suffix}` : null,
            cartId: `cart_${suffix}`,
            collectionMode:
              provider === null ? ("disabled" as const) : ("collect" as const),
            currencyCode: "usd",
            fingerprint: "native_tax_evidence_0123456789abcdef0123456789",
            generation: 2,
            paymentIntentId: `pi_${suffix}`,
            provider,
            status: "prepared" as const,
          }
          const created = await service.recordTaxQuoteEvidence(input)
          expect(created.replayed).toBe(false)
          expect(created.evidence).toMatchObject({
            association_status: null,
            order_id: null,
            tax_transaction_id: null,
            amount_minor: 623,
            collection_mode: input.collectionMode,
            provider,
          })
          const replayed = await service.recordTaxQuoteEvidence(input)
          expect(replayed.replayed).toBe(true)
          expect(replayed.evidence.id).toBe(created.evidence.id)
          await expect(
            service.recordTaxQuoteEvidence({ ...input, amountMinor: 624 })
          ).rejects.toThrow("already bound to different tax evidence")
          const stored = await service.listTaxQuoteEvidences({
            payment_intent_id: input.paymentIntentId,
          })
          expect(stored).toHaveLength(1)
          expect(stored[0]).toMatchObject({ amount_minor: 623 })
        }
      })

      it("initializes complete native tax controls and reuses the singleton", async () => {
        const service =
          getContainer().resolve<TaxControlModuleService>("tax_control")
        // Only this guarded disposable database is in scope for singleton reset.
        await service.deleteTaxProviderControls("taxctrl_default")
        const control = await service.ensureTaxProviderControl()
        expect(control).toMatchObject({
          id: "taxctrl_default",
          collection_mode: "disabled",
          generation: 1,
          last_switch_reason: null,
          last_switched_by: null,
        })
        await expect(service.ensureTaxProviderControl()).resolves.toEqual(
          control
        )
      })

      it("taxes an unattached native order line before its exchange quantity exists", async () => {
        const container = getContainer()
        const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
        const taxes = container.resolve<ITaxModuleService>(Modules.TAX)
        const control = await container
          .resolve<TaxControlModuleService>("tax_control")
          .ensureTaxProviderControl()
        expect(control.collection_mode).toBe("disabled")
        const providers = await taxes.listTaxProviders()
        const provider = providers.find((row) => row.id.includes("rate_lookup"))
        expect(provider).toBeDefined()
        await taxes.createTaxRegions({
          country_code: "us",
          provider_id: provider!.id,
        })
        for (const historical of [
          { code: "rr_tax:disabled:g99:decision", rate: 0 },
          { code: "rr_tax:taxrate_io:g98:quote", rate: 6.35 },
          { code: "rr_tax:stripe_tax:g97:taxcalc_disposable", rate: 6.35 },
        ]) {
          const order = await orders.createOrders({
            currency_code: "usd",
            items: [
              {
                title: "Original synthetic line",
                quantity: 2,
                unit_price: 2.34,
                tax_lines: [
                  {
                    ...historical,
                    description: "Synthetic historical tax",
                    provider_id: provider!.id,
                  },
                ],
              },
            ],
            shipping_address: {
              address_1: "Synthetic fixture",
              city: "Hartford",
              postal_code: "06103",
              province: "ct",
              country_code: "us",
            },
          })
          const [line] = await orders.createOrderLineItems([
            {
              title: "Replacement synthetic line",
              quantity: 3,
              unit_price: 2.34,
            },
          ])
          expect(line).toBeDefined()
          const query = container.resolve(ContainerRegistrationKeys.QUERY)
          const native = await query.graph({
            entity: "order_line_item",
            fields: ["id", "unit_price", "quantity"],
            filters: { id: line!.id },
          })
          expect(native.data).toHaveLength(1)
          expect(native.data[0].quantity).toBeUndefined()
          const execution = await updateOrderTaxLinesWorkflow(container).run({
            input: {
              order_id: order.id,
              item_ids: [line!.id],
              force_tax_calculation: true,
            },
            throwOnError: false,
          })
          const stored = await orders.retrieveOrderLineItem(line!.id, {
            relations: ["tax_lines"],
          })
          if (historical.code.includes("stripe_tax")) {
            expect(execution.errors).toHaveLength(1)
            expect(execution.errors[0]?.error).toMatchObject({
              message: expect.stringContaining(
                "Stripe Tax order changes cannot add or reprice taxable items."
              ),
            })
            expect(stored.tax_lines).toEqual([])
          } else {
            expect(execution.errors).toHaveLength(0)
            expect(execution.result.itemTaxLines).toMatchObject([
              {
                line_item_id: line!.id,
                rate: historical.rate,
                code: historical.code,
              },
            ])
            expect(stored.tax_lines).toMatchObject([historical])
          }
          const unchanged = await orders.retrieveOrder(order.id, {
            relations: ["items"],
          })
          expect(unchanged.items).toHaveLength(1)
          expect(unchanged.items?.[0]?.quantity).toBe(2)
        }
      })

      it("creates and replays a complete native product with priced stocked variants", async () => {
        const container = getContainer()
        const fulfillment = container.resolve<IFulfillmentModuleService>(
          Modules.FULFILLMENT
        )
        const stores = container.resolve<IStoreModuleService>(Modules.STORE)
        const channels = container.resolve<ISalesChannelModuleService>(
          Modules.SALES_CHANNEL
        )
        const locations = container.resolve<IStockLocationService>(
          Modules.STOCK_LOCATION
        )
        const products = container.resolve<IProductModuleService>(
          Modules.PRODUCT
        )
        const shippingProfile = await fulfillment.createShippingProfiles({
          name: "Disposable shipping",
          type: "default",
        })
        const channel = await channels.createSalesChannels({
          name: "Disposable catalog",
        })
        const store = (await stores.listStores())[0]
        expect(store).toBeDefined()
        await stores.updateStores(store!.id, {
          default_sales_channel_id: channel.id,
        })
        const location = await locations.createStockLocations({ name: "HQ" })
        const command = catalogProductCreateSchema.parse({
          idempotencyKey: randomUUID(),
          kind: "music_release",
          title: "Disposable native release",
          handle: "disposable-native-release",
          description: "Native catalog creation regression.",
          options: [{ title: "Format", values: ["CD", "Vinyl"] }],
          variants: ["CD", "Vinyl"].map((format, index) => ({
            key: format.toLowerCase(),
            title: format,
            sku: `DISPOSABLE-${format}`,
            options: { Format: format },
            prices: [{ amount: index ? 12.34 : 1.23, currencyCode: "usd" }],
            stockQuantity: 20,
            profile: { format: { label: format } },
          })),
          profile: {
            artists: [{ name: "Disposable artist", role: "primary" }],
            label: { label: "Disposable label" },
          },
        })
        const input = {
          ...command,
          actorId: "user_disposable_catalog_audit",
          requestSha256: hashCatalogCommand(command),
        }
        const created = (
          await createCatalogProductWorkflow(container).run({ input })
        ).result
        expect(created).toMatchObject({
          kind: "music_release",
          replayed: false,
        })
        expect(created.variantIds).toHaveLength(2)
        expect(await products.retrieveProduct(created.productId)).toMatchObject(
          {
            status: "draft",
            title: command.title,
            handle: command.handle,
          }
        )
        const authoring = await loadProductAuthoringView(
          container,
          created.productId
        )
        expect(authoring.commerce.id).toBe(created.productId)
        expect(authoring.catalog.variants).toHaveLength(2)
        // The creation picker cannot read computed stock from *variants on
        // the native product list. Its selected-product request must use the
        // variants handler, which calculates real inventory availability.
        let listedProducts: unknown
        await nativeProductList(
          {
            scope: container,
            filterableFields: { id: created.productId },
            queryConfig: {
              fields: ["id", "title", "variants.*"],
              pagination: { skip: 0, take: 200 },
            },
          } as unknown as Parameters<typeof nativeProductList>[0],
          {
            json: (data: unknown) => {
              listedProducts = data
            },
          } as unknown as Parameters<typeof nativeProductList>[1]
        )
        const listed = recordFrom(
          listedProducts,
          "Native product list"
        ).products
        expect(Array.isArray(listed)).toBe(true)
        const listedProduct = recordFrom(
          (listed as unknown[])[0],
          "Native product"
        )
        for (const variant of listedProduct.variants as unknown[]) {
          expect(variant).not.toHaveProperty("inventory_quantity")
        }
        let computedVariants: unknown
        await nativeVariantList(
          {
            scope: container,
            params: { id: created.productId },
            filterableFields: {},
            queryConfig: {
              fields: ["id", "manage_inventory", "inventory_quantity"],
              pagination: { skip: 0, take: 200 },
            },
          } as unknown as Parameters<typeof nativeVariantList>[0],
          {
            json: (data: unknown) => {
              computedVariants = data
            },
          } as unknown as Parameters<typeof nativeVariantList>[1]
        )
        expect(computedVariants).toMatchObject({ count: 2 })
        for (const variant of recordFrom(computedVariants, "Native variants")
          .variants as unknown[]) {
          expect(variant).toMatchObject({
            manage_inventory: true,
            inventory_quantity: 20,
          })
        }
        const presentation = await loadStoreCatalogPresentations(
          container.resolve<CatalogService>("catalog"),
          [created.productId]
        )
        expect(presentation).toMatchObject([
          {
            productId: created.productId,
            managedMedia: true,
            images: [],
            profile: {
              artists: ["Disposable artist"],
              label: "Disposable label",
            },
          },
        ])
        expect(JSON.stringify(presentation)).not.toMatch(
          /stockQuantity|prices|source_file_key/
        )

        const { result: keys } = await createApiKeysWorkflow(container).run({
          input: {
            api_keys: [
              {
                type: "publishable",
                title: "Disposable Store",
                created_by: "user_disposable_catalog_audit",
              },
            ],
          },
        })
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: keys[0]!.id, add: [channel.id] },
        })
        const url = `/store/catalog/presentation?product_ids=${created.productId}`
        const headers = { "x-publishable-api-key": keys[0]!.token }
        expect((await api.get(url, { headers })).data).toEqual({
          presentations: [],
        })
        await products.updateProducts(created.productId, {
          status: "published",
        })
        const publicRead = await api.get(url, { headers })
        expect(publicRead.status).toBe(200)
        expect(publicRead.headers["cache-control"]).toBe("private, no-store")
        expect(publicRead.data).toEqual({ presentations: presentation })
        const set = await fulfillment.createFulfillmentSets({
          name: "Disposable delivery",
          type: "shipping",
          service_zones: [
            {
              name: "US",
              geo_zones: [{ country_code: "us", type: "country" }],
            },
          ],
        })
        const link = container.resolve(ContainerRegistrationKeys.LINK)
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
        })
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: {
            fulfillment_provider_id: "per_item_standard",
          },
        })
        const { result: shippingOptions } = await createShippingOptionsWorkflow(
          container
        ).run({
          input: [
            {
              name: "Disposable calculated shipping",
              price_type: "calculated",
              provider_id: "per_item_standard",
              service_zone_id: set.service_zones![0]!.id,
              shipping_profile_id: shippingProfile.id,
              type: {
                label: "Standard",
                code: "standard",
                description: "Test delivery",
              },
              data: {
                base_amount: 5,
                additional_amount: 0.5,
                currency_code: "usd",
              },
            },
          ],
        })
        const carts = container.resolve<ICartModuleService>(Modules.CART)
        const variants = await products.listProductVariants({
          product_id: created.productId,
        })
        const cart = await carts.createCarts({
          currency_code: "usd",
          sales_channel_id: channel.id,
          items: [
            {
              title: "Disposable cart line",
              quantity: 2,
              unit_price: 1.23,
              variant_id: variants[0]!.id,
              product_id: created.productId,
            },
          ],
        })
        const calculateUrl = `/store/shipping-options/${shippingOptions[0]!.id}/calculate`
        const quote = await api.post(
          calculateUrl,
          { cart_id: cart.id, data: {} },
          { headers }
        )
        expect(quote.status).toBe(200)
        expect(quote.data.shipping_option).toMatchObject({
          amount: 5.5,
          is_tax_inclusive: false,
        })
        await carts.updateCarts(cart.id, { currency_code: "eur" })
        const unsupported = await api.post(
          calculateUrl,
          { cart_id: cart.id, data: {} },
          { headers, validateStatus: () => true }
        )
        expect(unsupported.status).toBe(400)
        expect(unsupported.data).toMatchObject({ type: "invalid_data" })

        const other = await channels.createSalesChannels({
          name: "Unrelated catalog",
        })
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: keys[0]!.id, remove: [channel.id], add: [other.id] },
        })
        expect((await api.get(url, { headers })).data).toEqual({
          presentations: [],
        })
        await products.updateProducts(created.productId, { status: "draft" })
        const replayed = (
          await createCatalogProductWorkflow(container).run({ input })
        ).result
        expect(replayed).toEqual({ ...created, replayed: true })
        expect(
          await products.listProducts({ handle: "disposable-native-release" })
        ).toHaveLength(1)
      })

      it("creates and replays an Admin shelf using native persistence responses", async () => {
        const container = getContainer()
        const catalog = container.resolve<CatalogService>("catalog")
        const req = {
          scope: container,
          auth_context: { actor_id: "user_disposable_catalog_audit" },
        } as unknown as MedusaRequest
        const input = {
          idempotencyKey: randomUUID(),
          expectedVersion: 0,
          title: "Disposable shelf",
          handle: "disposable-native-shelf",
          mode: "manual" as const,
          automationType: "none" as const,
          isActive: false,
          productLimit: 2,
          products: [],
        }
        const created = await upsertShelf(req, catalog, input)
        expect(created.status).toBe(201)
        expect(created.body.shelf).toMatchObject({
          handle: input.handle,
          title: input.title,
          version: 1,
          isActive: false,
        })
        const replayed = await upsertShelf(req, catalog, input)
        expect(replayed.body).toEqual(created.body)
        const updated = await upsertShelf(
          req,
          catalog,
          {
            idempotencyKey: randomUUID(),
            expectedVersion: 1,
            title: "Updated disposable shelf",
          },
          created.body.shelf.id
        )
        expect(updated.body.shelf).toMatchObject({
          version: 2,
          productLimit: 2,
        })
        await expect(
          upsertShelf(
            req,
            catalog,
            {
              idempotencyKey: randomUUID(),
              expectedVersion: 1,
              title: "Stale title",
            },
            created.body.shelf.id
          )
        ).rejects.toThrow("changed after it was loaded")
        const archived = await setShelfArchived(
          req,
          catalog,
          created.body.shelf.id,
          {
            idempotencyKey: randomUUID(),
            expectedVersion: 2,
          },
          true
        )
        expect(archived.shelf).toMatchObject({ version: 3, isActive: false })
      })

      it("creates minimal catalog profiles without missing nullable fields", async () => {
        const catalog = getContainer().resolve<CatalogService>("catalog")
        const profile = await mutateCatalogProductProfile(catalog, {
          actorId: "user_disposable_catalog_audit",
          aggregateId: "prod_disposable_catalog_audit",
          command: "catalog.product-profile.upsert",
          expectedVersion: 0,
          idempotencyKey: randomUUID(),
          requestSha256: "a".repeat(64),
          patch: { descriptionHtml: "<script>discard()</script>" },
        })
        expect(profile).toMatchObject({ created: true, version: 1 })
        const saved = readCatalogProductProfile(
          await catalog.retrieveCatalogProductProfile(profile.profileId)
        )
        expect(saved).toMatchObject({
          description_html: null,
          release_title: null,
        })
        const variant = await mutateCatalogVariantProfile(catalog, {
          actorId: "user_disposable_catalog_audit",
          aggregateId: "variant_disposable_catalog_audit",
          command: "catalog.variant-profile.upsert",
          expectedVersion: 0,
          idempotencyKey: randomUUID(),
          requestSha256: "b".repeat(64),
          patch: {},
        })
        expect(variant).toMatchObject({ created: true, version: 1 })
        expect(
          readCatalogVariantProfiles(
            await catalog.listCatalogVariantProfiles({
              variant_id: "variant_disposable_catalog_audit",
            }),
            "variant_disposable_catalog_audit"
          )
        ).toHaveLength(1)
      })

      it("persists new artist and vocabulary links in the profile transaction", async () => {
        const catalog = getContainer().resolve<CatalogService>("catalog")
        const result = await mutateCatalogProductProfile(catalog, {
          actorId: "user_disposable_catalog_audit",
          aggregateId: "prod_disposable_artist_profile",
          command: "catalog.product-profile.upsert",
          expectedVersion: 0,
          idempotencyKey: randomUUID(),
          requestSha256: "a".repeat(64),
          patch: {
            artists: [{ name: "Disposable Native Artist" }],
            label: { label: "Disposable Native Label" },
            references: [{ kind: "genre", label: "Disposable Native Genre" }],
          },
        })
        expect(result.createdArtistIds).toHaveLength(1)
        expect(result.createdReferenceValueIds).toHaveLength(2)
        expect(
          await catalog.listCatalogProductArtists({
            product_profile_id: result.profileId,
          })
        ).toHaveLength(1)
        expect(
          await catalog.listCatalogProductReferences({
            product_profile_id: result.profileId,
          })
        ).toHaveLength(1)
      })

      it("normalizes imported descriptions transactionally without changing safe rows", async () => {
        const database = knex({ client: "pg", connection: dbConfig.clientUrl })
        const table = "catalog_product_profiles"
        try {
          await database(table).insert([
            {
              id: "cprof_disposable_legacy",
              product_id: "prod_disposable_legacy",
              description_html:
                '<p style="color:red">Keep the release notes.</p><iframe src="https://example.com/embed"></iframe>',
              version: 4,
            },
            {
              id: "cprof_disposable_safe",
              product_id: "prod_disposable_safe",
              description_html: "<p>Already safe.</p>",
              version: 7,
            },
          ])
          const normalize = () =>
            database.transaction(async (transaction) =>
              normalizeLegacyCatalogDescriptions(
                async (sql, parameters) =>
                  (await transaction.raw(sql, parameters)).rows
              )
            )
          expect((await normalize()).changed).toBe(1)
          const changed = await database(table)
            .where({ id: "cprof_disposable_legacy" })
            .first()
          expect(readCatalogProductProfile(changed)).toMatchObject({
            description_html: "<p>Keep the release notes.</p>",
            version: 5,
          })
          expect(
            await database(table).where({ id: "cprof_disposable_safe" }).first()
          ).toMatchObject({
            description_html: "<p>Already safe.</p>",
            version: 7,
          })
          expect((await normalize()).changed).toBe(0)
        } finally {
          await database.destroy()
        }
      })

      it("persists a complete native catalog asset after a provider upload", async () => {
        const catalog = getContainer().resolve<CatalogService>("catalog")
        // This case tests the native catalog write boundary. The provider is
        // isolated; real object-store uploads are a separate staging check.
        const fileService = {
          createFiles: jest.fn().mockResolvedValue({
            id: "catalog/disposable-audit-01M41ZFAY2ZZEZXWSDQMSPE1BX.webp",
            url: "https://media.example.com/disposable.webp",
          }),
        } as unknown as FileTypes.IFileModuleService
        const idempotencyKey = randomUUID()
        const result = await performCatalogMediaUpload(catalog, fileService, {
          actorId: "user_disposable_catalog_audit",
          idempotencyKey,
          requestSha256: "c".repeat(64),
          files: [
            {
              content: "isolated-provider-fixture",
              filename: "disposable.png",
              remoteFilename: `${idempotencyKey}-00.webp`,
              height: 20,
              width: 40,
              size: 100,
              mimeType: "image/webp",
              sha256: "d".repeat(64),
              source: {
                channels: 3,
                filename: "disposable.png",
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
        })
        expect(result.mutation.files).toHaveLength(1)
        const id = result.mutation.files[0]!.mediaAssetId
        expect(
          readCatalogMediaAsset(await catalog.retrieveCatalogMediaAsset(id))
        ).toMatchObject({
          lifecycle_status: "active",
          version: 1,
          width: 40,
          height: 20,
          alt_text: null,
          quarantined_at: null,
        })
      })

      it("links a source URL and reuses its metadata with native media records", async () => {
        const catalog = getContainer().resolve<CatalogService>("catalog")
        for (const suffix of ["first", "reused"]) {
          const result = await mutateCatalogProductMedia(catalog, {
            actorId: "user_disposable_catalog_audit",
            aggregateId: `prod_disposable_media_${suffix}`,
            command: "catalog.product-media.replace",
            expectedVersion: 0,
            idempotencyKey: randomUUID(),
            requestSha256: "f".repeat(64),
            media: [
              {
                sourceUrl: "https://media.example.com/source-only.webp",
                altText: "Owned fixture artwork",
              },
            ],
          })
          expect(result).toMatchObject({ version: 1, replayed: false })
          expect(result.createdAssetIds).toHaveLength(1)
          expect(
            readCatalogMediaAsset(
              await catalog.retrieveCatalogMediaAsset(
                result.createdAssetIds[0]!
              )
            )
          ).toMatchObject({
            alt_text: "Owned fixture artwork",
            byte_size: null,
            lifecycle_status: "active",
            quarantined_at: null,
            version: 1,
          })
        }
      })

      it("rolls back catalog parents and audit records when a dependent link fails", async () => {
        const catalog = getContainer().resolve<CatalogService>("catalog")
        const idempotencyKey = randomUUID()
        await expect(
          mutateCatalogProductProfile(catalog, {
            actorId: "user_disposable_catalog_audit",
            aggregateId: "prod_disposable_rollback",
            command: "catalog.product-profile.upsert",
            expectedVersion: 0,
            idempotencyKey,
            requestSha256: "b".repeat(64),
            patch: {
              label: { label: "Disposable Rollback Label" },
              artists: [{ artistId: "artist_disposable_missing" }],
            },
          })
        ).rejects.toThrow()
        expect(
          await catalog.listCatalogProductProfiles({
            product_id: "prod_disposable_rollback",
          })
        ).toHaveLength(0)
        expect(
          await catalog.listCatalogReferenceValues({
            value: "disposable-rollback-label",
          })
        ).toHaveLength(0)
        expect(
          await catalog.listCatalogAuthoringOperations({
            idempotency_key: idempotencyKey,
          })
        ).toHaveLength(0)
      })

      it("observes real pool contention, slow SQL, failure and cleanup without retaining query data", async () => {
        const database = knex({
          client: "pg",
          connection: dbConfig.clientUrl,
          pool: { min: 0, max: 1 },
        })
        const events: Array<Record<string, unknown>> = []
        const observer = observeDatabaseDiagnostics(database, (event) =>
          events.push(event)
        )
        let held: unknown
        try {
          held = await database.client.acquireConnection()
          const work = withSearchDatabaseWorkload(() =>
            database
              .raw("select pg_sleep(1.05), ?::text", [
                "private-diagnostic-canary",
              ])
              .then(() => undefined)
          )
          await new Promise<void>((resolve) => setImmediate(resolve))
          expect(database.client.pool?.numPendingAcquires()).toBe(1)
          await new Promise((resolve) => setTimeout(resolve, 1_050))
          await database.client.releaseConnection(held)
          held = undefined
          await work
          await expect(database.raw("select 1 / 0")).rejects.toThrow()
          observer.close()
          expect(events).toHaveLength(1)
          expect(events[0]).toMatchObject({
            in_flight_acquires: 0,
            in_flight_queries: 0,
            unobserved: 0,
            pending_acquires_peak: 1,
            workloads: {
              search_index: {
                acquire: { completed: 1, slow: 1, failed: 0 },
                query: { completed: 1, slow: 1, failed: 0 },
              },
              application: { query: { completed: 1, failed: 1 } },
            },
          })
          expect(JSON.stringify(events)).not.toMatch(
            /private-diagnostic|pg_sleep|select|division|clientUrl/
          )
        } finally {
          if (held) await database.client.releaseConnection(held)
          observer.close()
          await database.destroy()
        }
      })

      it("distinguishes cold creation from waiting for an occupied connection", async () => {
        const database = knex({
          client: "pg",
          connection: dbConfig.clientUrl,
          pool: { min: 0, max: 1 },
        })
        let held: unknown
        try {
          const probes = createBackendReadinessProbes({
            database,
            environment: { NODE_ENV: "test" },
          })
          const cold = await runReadinessChecks(probes)
          assertDatabaseReadinessTiming(cold)
          expect(cold[0]?.pool_observation).toMatchObject({
            connection_source: "created",
            connection_create_ms: expect.any(Number),
            used_before: 0,
            free_before: 0,
          })
          held = await database.client.acquireConnection()
          const waiting = runReadinessChecks(probes)
          await new Promise<void>((resolve) => setImmediate(resolve))
          expect(database.client.pool?.numPendingAcquires()).toBe(1)
          await database.client.releaseConnection(held)
          held = undefined
          const warm = await waiting
          assertDatabaseReadinessTiming(warm)
          expect(warm[0]?.pool_observation).toMatchObject({
            connection_source: "reused",
            connection_create_ms: null,
            used_before: 1,
            free_before: 0,
          })
        } finally {
          if (held) await database.client.releaseConnection(held)
          await database.destroy()
        }
      })

      it("boots the real API with healthy disposable dependencies", async () => {
        const responses: unknown[] = await Promise.all([
          api.get("/live"),
          api.get("/ready"),
          api.get("/api/health"),
        ])

        for (const response of responses) {
          expect(recordFrom(response, "HTTP response").status).toBe(200)
        }
        const readinessResponse = recordFrom(responses[1], "Readiness response")
        const readiness = recordFrom(readinessResponse.data, "Readiness body")
        expect(readiness.status).toBe("ok")
        if (!Array.isArray(readiness.checks)) {
          throw new TypeError("Readiness checks must be an array.")
        }
        const checks = readiness.checks.map((check) => {
          const record = recordFrom(check, "Readiness check")
          return { name: record.name, status: record.status }
        })
        expect(checks).toEqual(
          expect.arrayContaining([
            { name: "database", status: "ok" },
            { name: "redis", status: "ok" },
          ])
        )
        assertDatabaseReadinessTiming(readiness.checks)

        for (let attempt = 0; attempt < 3; attempt += 1) {
          const repeatedResponse = recordFrom(
            await api.get("/ready"),
            "Repeated readiness response"
          )
          expect(repeatedResponse.status).toBe(200)
          const repeatedReadiness = recordFrom(
            repeatedResponse.data,
            "Repeated readiness body"
          )
          expect(repeatedReadiness.status).toBe("ok")
          assertDatabaseReadinessTiming(repeatedReadiness.checks)
        }
      })

      it("abandons a timed-out pool request and can reuse a late-created connection", async () => {
        const database = knex({
          client: "pg",
          connection: dbConfig.clientUrl,
          pool: { min: 0, max: 1 },
        })
        const pool = database.client.pool
        if (!pool) {
          throw new Error("Disposable PostgreSQL pool is unavailable.")
        }
        let allowCreation: () => void = () => undefined
        const creationGate = new Promise<void>((resolve) => {
          allowCreation = resolve
        })
        const originalAcquire = database.client.acquireRawConnection.bind(
          database.client
        )
        const delayedAcquire = jest
          .spyOn(database.client, "acquireRawConnection")
          .mockImplementation(async () => {
            await creationGate
            return originalAcquire()
          })
        const probes = createBackendReadinessProbes({
          database,
          environment: { NODE_ENV: "test" },
        })
        try {
          const checks = await runReadinessChecks(probes)
          expect(checks).toEqual([
            {
              duration_ms: expect.any(Number),
              name: "database",
              status: "error",
            },
          ])
          expect(delayedAcquire).toHaveBeenCalledTimes(1)
          expect(pool.numPendingAcquires()).toBe(0)
          expect(pool.numUsed()).toBe(0)

          allowCreation()
          const deadline = Date.now() + 5_000
          while (pool.numPendingCreates() > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20))
          }
          expect(pool.numPendingCreates()).toBe(0)
          expect(pool.numPendingAcquires()).toBe(0)
          expect(pool.numUsed()).toBe(0)
          expect(pool.numFree()).toBe(1)

          const recovered = await runReadinessChecks(probes)
          expect(recovered[0]?.status).toBe("ok")
          expect(pool.numUsed()).toBe(0)
          expect(pool.numPendingAcquires()).toBe(0)
        } finally {
          allowCreation()
          delayedAcquire.mockRestore()
          await database.destroy()
        }
      })

      it("applies custom migrations and preserves the safe tax default", async () => {
        const database = getContainer().resolve<Knex>(
          ContainerRegistrationKeys.PG_CONNECTION
        )
        const tableResult = await database.raw<{
          rows: Array<{ table_name: string }>
        }>(
          `select table_name
           from information_schema.tables
           where table_schema = 'public'
             and table_name = any (?)
           order by table_name`,
          [
            [
              "stripe_lifecycle_events",
              "tax_provider_audits",
              "tax_provider_controls",
              "tax_quote_evidences",
            ],
          ]
        )
        expect(tableResult.rows.map(({ table_name }) => table_name)).toEqual([
          "stripe_lifecycle_events",
          "tax_provider_audits",
          "tax_provider_controls",
          "tax_quote_evidences",
        ])

        const controlResult = await database.raw<{
          rows: Array<{
            collection_mode: string
            generation: number
            last_switched_by: string | null
          }>
        }>(
          `select collection_mode, generation, last_switched_by
           from tax_provider_controls
           where id = 'taxctrl_default'`
        )
        expect(controlResult.rows).toEqual([
          {
            collection_mode: "disabled",
            generation: 2,
            last_switched_by: "system:migration",
          },
        ])

        const defaultResult = await database.raw<{
          rows: Array<{ column_default: string | null }>
        }>(
          `select column_default
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'tax_provider_controls'
             and column_name = 'collection_mode'`
        )
        expect(defaultResult.rows[0]?.column_default).toContain("disabled")

        const auditResult = await database.raw<{
          rows: Array<{
            acknowledgement_version: string
            from_collection_mode: string
            to_collection_mode: string
          }>
        }>(
          `select acknowledgement_version,
                  from_collection_mode,
                  to_collection_mode
           from tax_provider_audits
           where idempotency_key = '00000000-0000-4000-8000-000000000901'`
        )
        expect(auditResult.rows).toEqual([
          {
            acknowledgement_version: "tax-collection-safe-default-2026-09-01",
            from_collection_mode: "collect",
            to_collection_mode: "disabled",
          },
        ])
      })

      it("binds native RMA confirmation preferences to persisted state before delivery", async () => {
        const container = getContainer()
        const inventory = container.resolve<IInventoryService>(
          Modules.INVENTORY
        )
        const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
        const fulfillments = container.resolve<IFulfillmentModuleService>(
          Modules.FULFILLMENT
        )
        const products = container.resolve<IProductModuleService>(
          Modules.PRODUCT
        )
        const locations = container.resolve<IStockLocationService>(
          Modules.STOCK_LOCATION
        )
        const location = await locations.createStockLocations({
          name: "After-sales fixture",
        })
        const shippingProfile = await fulfillments.createShippingProfiles({
          name: "After-sales fixture",
          type: "default",
        })
        const set = await fulfillments.createFulfillmentSets({
          name: "After-sales fixture",
          type: "shipping",
          service_zones: [
            {
              name: "US",
              geo_zones: [{ country_code: "us", type: "country" }],
            },
          ],
        })
        const link = container.resolve(ContainerRegistrationKeys.LINK)
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
        })
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: {
            fulfillment_provider_id: "per_item_standard",
          },
        })
        const { result: shippingOptions } = await createShippingOptionsWorkflow(
          container
        ).run({
          input: [
            {
              name: "After-sales fixture",
              price_type: "calculated",
              provider_id: "per_item_standard",
              service_zone_id: set.service_zones![0]!.id,
              shipping_profile_id: shippingProfile.id,
              type: {
                label: "Standard",
                code: "standard",
                description: "Synthetic delivery",
              },
              data: {
                base_amount: 5,
                additional_amount: 0.5,
                currency_code: "usd",
              },
            },
          ],
        })
        const product = await products.createProducts({
          title: "After-sales fixture",
          status: "published",
          variants: [{ title: "Synthetic", manage_inventory: true }],
        })
        await link.create({
          [Modules.PRODUCT]: { product_id: product.id },
          [Modules.FULFILLMENT]: { shipping_profile_id: shippingProfile.id },
        })
        const variant = product.variants![0]!
        const inventoryItem = await inventory.createInventoryItems({
          title: "After-sales component",
        })
        await link.create({
          [Modules.PRODUCT]: { variant_id: variant.id },
          [Modules.INVENTORY]: { inventory_item_id: inventoryItem.id },
          data: { required_quantity: 2 },
        })
        const inventoryLevel = await inventory.createInventoryLevels({
          inventory_item_id: inventoryItem.id,
          location_id: location.id,
          stocked_quantity: 40,
        })
        const stock = async () =>
          Number(
            (await inventory.retrieveInventoryLevel(inventoryLevel.id))
              .stocked_quantity
          )
        const createOrder = async () => {
          const order = await orders.createOrders({
            currency_code: "usd",
            email: "delivered@resend.dev",
            shipping_address: {
              address_1: "Synthetic fixture",
              country_code: "us",
            },
            items: [
              {
                title: "Synthetic item",
                variant_id: variant.id,
                quantity: 2,
                unit_price: 2.34,
                requires_shipping: false,
              },
            ],
          })
          await inventory.createReservationItems({
            inventory_item_id: inventoryItem.id,
            location_id: location.id,
            line_item_id: order.items![0]!.id,
            quantity: 4,
          })
          await createOrderFulfillmentWorkflow(container).run({
            input: {
              order_id: order.id,
              items: [{ id: order.items![0]!.id, quantity: 2 }],
              location_id: location.id,
              shipping_option_id: shippingOptions[0]!.id,
              no_notification: true,
            },
          })
          return order
        }
        const events = container.resolve<IEventBusModuleService>(
          Modules.EVENT_BUS
        )
        const captured: { name: string; data: Record<string, unknown> }[] = []
        const emit = jest
          .spyOn(events, "emit")
          .mockImplementation(async (input) => {
            for (const event of Array.isArray(input) ? input : [input]) {
              if (
                [
                  "order.return_requested",
                  "order.return_received",
                  "order.claim_created",
                  "order.exchange_created",
                ].includes(event.name)
              ) {
                captured.push({
                  name: event.name,
                  data: recordFrom(event.data, "Native RMA event"),
                })
              }
            }
          })
        const rows = new Map<string, Record<string, unknown>>()
        const notification = {
          createNotifications: async (payloads: CreateNotificationDTO[]) => {
            const created = []
            for (const payload of payloads) {
              if (rows.has(payload.idempotency_key!)) continue
              const row = {
                ...payload,
                id: `noti_${rows.size + 1}`,
                external_id: `email_${rows.size + 1}`,
                provider_id: "fixture_resend",
                status: "success",
                created_at: new Date(),
              }
              rows.set(payload.idempotency_key!, row)
              created.push(row)
            }
            return created
          },
          listNotifications: async ({
            idempotency_key,
          }: {
            idempotency_key: string[]
          }) =>
            idempotency_key.flatMap((key) =>
              rows.has(key) ? [rows.get(key)!] : []
            ),
          retrieveNotification: async (id: string) =>
            [...rows.values()].find((row) => row.id === id),
          updateNotifications: async () => null,
        }
        const deliver = async (event: (typeof captured)[number]) =>
          afterSalesStatusHandler({
            event,
            container: {
              resolve: (key: string) =>
                key === Modules.NOTIFICATION
                  ? notification
                  : container.resolve(key),
            },
          } as unknown as Parameters<typeof afterSalesStatusHandler>[0])
        const latest = (name: string) => {
          const event = captured.at(-1)!
          expect(event.name).toBe(name)
          expect(event.data.order_change_id).toMatch(/^ordch_/)
          expect(event.data.no_notification).toBe(false)
          return event
        }
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const receipt = async (returnId: string) => {
          const { data } = await query.graph({
            entity: "return",
            fields: [
              "status",
              "items.received_quantity",
              "items.damaged_quantity",
            ],
            filters: { id: returnId },
          })
          expect(data).toHaveLength(1)
          return data[0]!
        }
        try {
          const order = await createOrder()
          expect(await stock()).toBe(36)
          const { result: request } = await beginReturnOrderWorkflow(
            container
          ).run({
            input: { order_id: order.id, location_id: location.id },
          })
          const returnId = request.return_id!
          await requestItemReturnWorkflow(container).run({
            input: {
              return_id: returnId,
              items: [{ id: order.items![0]!.id, quantity: 2 }],
            },
          })
          await confirmReturnRequestWorkflow(container).run({
            input: { return_id: returnId, no_notification: false },
          })
          const requested = latest("order.return_requested")
          expect(requested.data.order_change_id).toBe(request.id)
          await deliver(requested)
          await deliver(requested)
          expect(rows.size).toBe(1)

          await beginReceiveReturnWorkflow(container).run({
            input: { return_id: returnId },
          })
          await receiveItemReturnRequestWorkflow(container).run({
            input: {
              return_id: returnId,
              items: [{ id: order.items![0]!.id, quantity: 1 }],
            },
          })
          await confirmReturnReceiveWorkflow(container).run({
            input: { return_id: returnId, no_notification: false },
          })
          const partial = latest("order.return_received")
          expect(partial.data.return_status).toBe("partially_received")
          expect(await receipt(returnId)).toMatchObject({
            status: "partially_received",
            items: [{ received_quantity: 1, damaged_quantity: 0 }],
          })
          expect(await stock()).toBe(38)
          await deliver(partial)
          expect(rows.size).toBe(1)

          await beginReceiveReturnWorkflow(container).run({
            input: { return_id: returnId },
          })
          await receiveItemReturnRequestWorkflow(container).run({
            input: {
              return_id: returnId,
              items: [{ id: order.items![0]!.id, quantity: 1 }],
            },
          })
          await confirmReturnReceiveWorkflow(container).run({
            input: { return_id: returnId, no_notification: false },
          })
          const received = latest("order.return_received")
          expect(received.data.return_status).toBe("received")
          expect(await receipt(returnId)).toMatchObject({
            status: "received",
            items: [{ received_quantity: 2, damaged_quantity: 0 }],
          })
          expect(await stock()).toBe(40)
          await deliver(received)
          await deliver(received)
          expect(rows.size).toBe(2)

          for (const preference of [true, undefined]) {
            const quietOrder = await createOrder()
            const { result } = await beginReturnOrderWorkflow(container).run({
              input: { order_id: quietOrder.id, location_id: location.id },
            })
            await requestItemReturnWorkflow(container).run({
              input: {
                return_id: result.return_id!,
                items: [{ id: quietOrder.items![0]!.id, quantity: 1 }],
              },
            })
            await confirmReturnRequestWorkflow(container).run({
              input: {
                return_id: result.return_id!,
                ...(preference === undefined
                  ? {}
                  : { no_notification: preference }),
              },
            })
            const event = captured.at(-1)!
            expect(event.name).toBe("order.return_requested")
            expect(event.data.no_notification).toBe(true)
            await deliver(event)
            expect(rows.size).toBe(2)
          }

          const claimedOrder = await createOrder()
          const { result: claim } = await beginClaimOrderWorkflow(
            container
          ).run({ input: { order_id: claimedOrder.id, type: "refund" } })
          const { data: nativeClaims } = await query.graph({
            entity: "order_claim",
            fields: ["id", "return_id"],
            filters: { id: claim.claim_id! },
          })
          expect(nativeClaims).toHaveLength(1)
          await orderClaimRequestItemReturnWorkflow(container).run({
            input: {
              claim_id: claim.claim_id!,
              return_id: nativeClaims[0]!.return_id,
              items: [{ id: claimedOrder.items![0]!.id, quantity: 1 }],
              location_id: location.id,
            },
          })
          await confirmClaimRequestWorkflow(container).run({
            input: { claim_id: claim.claim_id!, no_notification: false },
          })
          const claimEvent = latest("order.claim_created")
          await deliver(claimEvent)
          await deliver(claimEvent)
          expect(rows.size).toBe(3)

          const exchangedOrder = await createOrder()
          const { result: exchange } = await beginExchangeOrderWorkflow(
            container
          ).run({ input: { order_id: exchangedOrder.id } })
          const { data: nativeExchanges } = await query.graph({
            entity: "order_exchange",
            fields: ["id", "return_id"],
            filters: { id: exchange.exchange_id! },
          })
          expect(nativeExchanges).toHaveLength(1)
          await orderExchangeRequestItemReturnWorkflow(container).run({
            input: {
              exchange_id: exchange.exchange_id!,
              return_id: nativeExchanges[0]!.return_id,
              items: [{ id: exchangedOrder.items![0]!.id, quantity: 1 }],
              location_id: location.id,
            },
          })
          await orderExchangeAddNewItemWorkflow(container).run({
            input: {
              exchange_id: exchange.exchange_id!,
              items: [
                { variant_id: variant.id, quantity: 1, unit_price: 2.34 },
              ],
            },
          })
          await confirmExchangeRequestWorkflow(container).run({
            input: {
              exchange_id: exchange.exchange_id!,
              no_notification: false,
            },
          })
          const exchangeEvent = latest("order.exchange_created")
          await deliver(exchangeEvent)
          await deliver(exchangeEvent)
          expect(rows.size).toBe(4)
          const damagedOrder = await createOrder()
          const damagedStock = await stock()
          const { result: damagedRequest } = await beginReturnOrderWorkflow(
            container
          ).run({
            input: { order_id: damagedOrder.id, location_id: location.id },
          })
          const damagedReturnId = damagedRequest.return_id!
          await requestItemReturnWorkflow(container).run({
            input: {
              return_id: damagedReturnId,
              items: [{ id: damagedOrder.items![0]!.id, quantity: 2 }],
            },
          })
          await confirmReturnRequestWorkflow(container).run({
            input: { return_id: damagedReturnId, no_notification: true },
          })
          await beginReceiveReturnWorkflow(container).run({
            input: { return_id: damagedReturnId },
          })
          await dismissItemReturnRequestWorkflow(container).run({
            input: {
              return_id: damagedReturnId,
              items: [{ id: damagedOrder.items![0]!.id, quantity: 1 }],
            },
          })
          await confirmReturnReceiveWorkflow(container).run({
            input: { return_id: damagedReturnId, no_notification: false },
          })
          const damagedPartial = latest("order.return_received")
          await deliver(damagedPartial)
          expect(rows.size).toBe(4)
          expect(await receipt(damagedReturnId)).toMatchObject({
            status: "partially_received",
            items: [{ received_quantity: 1, damaged_quantity: 1 }],
          })
          expect(await stock()).toBe(damagedStock)
          await beginReceiveReturnWorkflow(container).run({
            input: { return_id: damagedReturnId },
          })
          await receiveItemReturnRequestWorkflow(container).run({
            input: {
              return_id: damagedReturnId,
              items: [{ id: damagedOrder.items![0]!.id, quantity: 1 }],
            },
          })
          await confirmReturnReceiveWorkflow(container).run({
            input: { return_id: damagedReturnId, no_notification: false },
          })
          const damagedReceived = latest("order.return_received")
          await deliver(damagedReceived)
          await deliver(damagedReceived)
          // A late partial replay still cannot send full-receipt copy.
          await deliver(damagedPartial)
          expect(rows.size).toBe(5)
          expect(await receipt(damagedReturnId)).toMatchObject({
            status: "received",
            items: [{ received_quantity: 2, damaged_quantity: 1 }],
          })
          expect(await stock()).toBe(damagedStock + 2)
          for (const row of rows.values()) {
            expect(row.template).toBe("after-sales-status")
            expect(row.to).toBe("delivered@resend.dev")
          }
          const { data: changes } = await query.graph({
            entity: "order_change",
            fields: ["id", "status", "confirmed_at"],
            filters: {
              id: captured.map((event) => event.data.order_change_id),
            },
          })
          expect(changes).toHaveLength(captured.length)
          expect(
            changes.every(
              (change) => change.status === "confirmed" && change.confirmed_at
            )
          ).toBe(true)
        } finally {
          emit.mockRestore()
        }
      })

      it("resolves the native fulfillment/order link before stage notification and replay", async () => {
        const container = getContainer()
        const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
        const fulfillments = container.resolve<IFulfillmentModuleService>(
          Modules.FULFILLMENT
        )
        const locations = container.resolve<IStockLocationService>(
          Modules.STOCK_LOCATION
        )
        const location = await locations.createStockLocations({
          name: "Notification fixture",
        })
        const order = await orders.createOrders({
          currency_code: "usd",
          email: "delivered@resend.dev",
          shipping_address: {
            address_1: "Synthetic fixture",
            country_code: "us",
          },
          items: [
            {
              title: "Synthetic shipment",
              quantity: 1,
              unit_price: 2.34,
              requires_shipping: false,
            },
          ],
        })
        const shippingProfile = await fulfillments.createShippingProfiles({
          name: "Notification fixture",
          type: "default",
        })
        const set = await fulfillments.createFulfillmentSets({
          name: "Notification fixture",
          type: "shipping",
          service_zones: [
            {
              name: "US",
              geo_zones: [{ country_code: "us", type: "country" }],
            },
          ],
        })
        const link = container.resolve(ContainerRegistrationKeys.LINK)
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
        })
        await link.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: {
            fulfillment_provider_id: "per_item_standard",
          },
        })
        const { result: shippingOptions } = await createShippingOptionsWorkflow(
          container
        ).run({
          input: [
            {
              name: "Notification fixture",
              price_type: "calculated",
              provider_id: "per_item_standard",
              service_zone_id: set.service_zones![0]!.id,
              shipping_profile_id: shippingProfile.id,
              type: {
                label: "Standard",
                code: "standard",
                description: "Synthetic delivery",
              },
              data: {
                base_amount: 5,
                additional_amount: 0.5,
                currency_code: "usd",
              },
            },
          ],
        })
        const events = container.resolve<IEventBusModuleService>(
          Modules.EVENT_BUS
        )
        let nativeCreated: Record<string, unknown> | undefined
        const emit = jest
          .spyOn(events, "emit")
          .mockImplementation(async (input) => {
            for (const event of Array.isArray(input) ? input : [input]) {
              if (event.name !== "order.fulfillment_created") continue
              expect(nativeCreated).toBeUndefined()
              nativeCreated = recordFrom(event.data, "Fulfillment event")
            }
          })
        let fulfillment: Awaited<
          ReturnType<typeof fulfillments.retrieveFulfillment>
        >
        try {
          const { result } = await createOrderFulfillmentWorkflow(
            container
          ).run({
            input: {
              order_id: order.id,
              items: [{ id: order.items![0]!.id, quantity: 1 }],
              location_id: location.id,
              shipping_option_id: shippingOptions[0]!.id,
              no_notification: false,
            },
          })
          fulfillment = result
        } finally {
          emit.mockRestore()
        }
        expect(nativeCreated).toEqual({
          order_id: order.id,
          fulfillment_id: fulfillment.id,
          no_notification: false,
        })
        // Capture the actual workflow event and stub outbound email delivery.
        // Graph, native relations and timestamps use the disposable modules.
        const rows = new Map<string, Record<string, unknown>>()
        const notification = {
          createNotifications: async (payloads: CreateNotificationDTO[]) => {
            const created = []
            for (const payload of payloads) {
              const key = payload.idempotency_key!
              if (rows.has(key)) continue
              const row = {
                ...payload,
                id: `noti_${rows.size + 1}`,
                external_id: `email_${rows.size + 1}`,
                provider_id: "fixture_resend",
                status: "success",
                created_at: new Date(),
              }
              rows.set(key, row)
              created.push(row)
            }
            return created
          },
          listNotifications: async ({
            idempotency_key: keys,
          }: {
            idempotency_key: string[]
          }) => keys.flatMap((key) => (rows.has(key) ? [rows.get(key)!] : [])),
          retrieveNotification: async (id: string) =>
            [...rows.values()].find((row) => row.id === id),
          updateNotifications: async () => null,
        }
        const invoke = async (name: string, no_notification = false) =>
          fulfillmentStatusHandler({
            container: {
              resolve: (key: string) =>
                key === Modules.NOTIFICATION
                  ? notification
                  : container.resolve(key),
            },
            event: {
              name,
              data:
                name === "order.fulfillment_created"
                  ? { ...nativeCreated, no_notification }
                  : { id: fulfillment.id, no_notification },
            },
          } as unknown as Parameters<typeof fulfillmentStatusHandler>[0])
        await invoke("order.fulfillment_created", true)
        expect(rows.size).toBe(0)
        await invoke("order.fulfillment_created")
        await invoke("order.fulfillment_created")
        expect(rows.size).toBe(1)
        await expect(invoke("shipment.created")).rejects.toThrow(
          /Fulfillment notification/
        )
        expect(rows.size).toBe(1)
        await fulfillments.updateFulfillment(fulfillment.id, {
          shipped_at: new Date(),
        })
        await invoke("shipment.created")
        await fulfillments.updateFulfillment(fulfillment.id, {
          delivered_at: new Date(),
        })
        await invoke("delivery.created")
        await invoke("delivery.created")
        expect([...rows.keys()]).toEqual(
          ["prepared", "shipped", "delivered"].map(
            (status) => `fulfillment-status:${fulfillment.id}:${status}`
          )
        )
        expect(
          [...rows.values()].every((row) => row.resource_id === order.id)
        ).toBe(true)
        await expect(
          fulfillments.cancelFulfillment(fulfillment.id)
        ).rejects.toThrow("already shipped")
        const canceled = await fulfillments.createFulfillment({
          location_id: location.id,
          provider_id: "per_item_standard",
          delivery_address: {
            address_1: "Synthetic fixture",
            country_code: "us",
          },
          items: [
            {
              title: "Canceled synthetic shipment",
              sku: "CANCEL-TEST",
              barcode: "TEST",
              quantity: 1,
            },
          ],
        })
        await container.resolve(ContainerRegistrationKeys.LINK).create({
          [Modules.ORDER]: { order_id: order.id },
          [Modules.FULFILLMENT]: { fulfillment_id: canceled.id },
        })
        await fulfillments.cancelFulfillment(canceled.id)
        await fulfillmentStatusHandler({
          container: {
            resolve: (key: string) =>
              key === Modules.NOTIFICATION
                ? notification
                : container.resolve(key),
          },
          event: {
            name: "order.fulfillment_created",
            data: {
              order_id: order.id,
              fulfillment_id: canceled.id,
              no_notification: false,
            },
          },
        } as unknown as Parameters<typeof fulfillmentStatusHandler>[0])
        expect(rows.size).toBe(3)
      })

      it("emits bulk refund events after native persistence and rejects excess refunds", async () => {
        const container = getContainer()
        const payments = container.resolve<IPaymentModuleService>(
          Modules.PAYMENT
        )
        const events = container.resolve<IEventBusModuleService>(
          Modules.EVENT_BUS
        )
        const collection = await payments.createPaymentCollections({
          amount: 6.23,
          currency_code: "usd",
        })
        const session = await payments.createPaymentSession(collection.id, {
          amount: 6.23,
          currency_code: "usd",
          provider_id: "pp_system_default",
          data: {},
          context: {},
        })
        const payment = await payments.authorizePaymentSession(session.id, {})
        if (!payment)
          throw new Error("Native fixture payment was not authorized.")
        await payments.capturePayment({ payment_id: payment.id, amount: 6.23 })
        const received: string[] = []
        const emit = jest
          .spyOn(events, "emit")
          .mockImplementation(async (input) => {
            for (const event of Array.isArray(input) ? input : [input]) {
              if (event.name !== PaymentEvents.REFUNDED) continue
              const data = recordFrom(event.data, "Refund event")
              expect(data.id).toBe(payment.id)
              const persisted = await payments.retrievePayment(payment.id, {
                relations: ["refunds"],
              })
              expect(persisted.refunds).toHaveLength(received.length + 1)
              expect(
                persisted.refunds?.every((refund) => /^ref_/.test(refund.id))
              ).toBe(true)
              received.push(payment.id)
            }
          })
        try {
          for (const amount of [1, 4, 1.23]) {
            const { result } = await refundPaymentsWorkflow(container).run({
              input: [{ payment_id: payment.id, amount }],
            })
            expect(result.map((row) => row.id)).toEqual([payment.id])
          }
          expect(received).toEqual([payment.id, payment.id, payment.id])
          const persisted = await payments.retrievePayment(payment.id, {
            relations: ["refunds"],
          })
          const payloads = buildRefundNotificationPayloads({
            context: {
              currencyCode: "usd",
              email: "customer@example.com",
              customerId: null,
              referenceLabel: "your checkout payment",
              refunds: (persisted.refunds ?? []).map((refund) => ({
                id: refund.id,
                amount: refund.amount,
              })),
              resourceId: "cart_disposable",
              resourceType: "cart",
            },
            template: "refund-issued",
          })
          expect(payloads).toHaveLength(3)
          expect(new Set(payloads.map((row) => row.idempotency_key)).size).toBe(
            3
          )
          const before = received.length
          const rejected = await refundPaymentsWorkflow(container).run({
            input: [{ payment_id: payment.id, amount: 0.02 }],
            throwOnError: false,
          })
          expect(rejected.errors).toHaveLength(1)
          expect(rejected.errors[0]?.error).toMatchObject({
            message: expect.stringContaining(
              "greater than the refundable amount"
            ),
          })
          expect(received).toHaveLength(before)
          expect(
            (
              await payments.retrievePayment(payment.id, {
                relations: ["refunds"],
              })
            ).refunds
          ).toHaveLength(3)
        } finally {
          emit.mockRestore()
        }
      })

      it("persists an idempotent payment failure and bounded retry", async () => {
        const service = getContainer().resolve<PaymentLifecycleModuleService>(
          PAYMENT_LIFECYCLE_MODULE
        )
        const receipt = {
          amountMinor: 2_500,
          chargeId: "ch_disposable",
          currencyCode: "usd" as const,
          eventCreatedAt: new Date("2026-09-01T12:00:00.000Z"),
          eventType: "refund.created" as const,
          livemode: false,
          objectId: "re_disposable",
          paymentIntentId: "pi_disposable",
          providerEventId: "evt_disposable",
          providerObjectStatus: "succeeded",
        }

        const first = await service.recordStripeLifecycleEvent(receipt)
        const replay = await service.recordStripeLifecycleEvent(receipt)
        expect(first.replayed).toBe(false)
        expect(replay).toEqual({
          lifecycleEvent: first.lifecycleEvent,
          replayed: true,
        })

        await expect(
          service.recordStripeLifecycleEvent({
            ...receipt,
            amountMinor: receipt.amountMinor + 1,
          })
        ).rejects.toThrow(
          "The Stripe event ID is already bound to different lifecycle data."
        )

        const processing = await service.markStripeLifecycleEventProcessing(
          first.lifecycleEvent.id
        )
        expect(processing).toEqual(
          expect.objectContaining({ attempt_count: 1, status: "processing" })
        )
        const failed = await service.markStripeLifecycleEventFailed(
          first.lifecycleEvent.id,
          "event_bus_unavailable"
        )
        expect(failed).toEqual(
          expect.objectContaining({
            attempt_count: 1,
            last_error_code: "event_bus_unavailable",
            status: "failed",
          })
        )
        expect(failed.next_retry_at?.getTime()).toBeGreaterThan(Date.now())
      })

      it("serializes distributed work and reacquires after release", async () => {
        const locking = getContainer().resolve<ILockingModule>(Modules.LOCKING)
        let active = 0
        let maximumActive = 0
        const runLocked = async (): Promise<void> => {
          await locking.execute(
            "integration:queue-recovery",
            async () => {
              active += 1
              maximumActive = Math.max(maximumActive, active)
              await new Promise<void>((resolve) => {
                setTimeout(resolve, 40)
              })
              active -= 1
            },
            { timeout: 5 }
          )
        }

        await Promise.all([runLocked(), runLocked()])
        expect(active).toBe(0)
        expect(maximumActive).toBe(1)

        const redis = createClient({
          disableOfflineQueue: true,
          socket: { connectTimeout: 2_000, reconnectStrategy: false },
          url: redisUrl,
        })
        redis.on("error", () => undefined)
        const key = "rr:integration:queue-recovery"
        try {
          await redis.connect()
          await redis.del(key)
          await expect(
            redis.set(key, "first", { EX: 30, NX: true })
          ).resolves.toBe("OK")
          await expect(
            redis.set(key, "duplicate", { EX: 30, NX: true })
          ).resolves.toBeNull()
          await expect(redis.get(key)).resolves.toBe("first")
          await expect(redis.ttl(key)).resolves.toBeGreaterThan(0)
          await redis.del(key)
          await expect(
            redis.set(key, "recovered", { EX: 30, NX: true })
          ).resolves.toBe("OK")
        } finally {
          if (redis.isOpen) {
            await redis.del(key)
            await redis.quit()
          }
        }
      })
    })
  },
})
