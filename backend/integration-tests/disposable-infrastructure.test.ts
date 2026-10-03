import { loadProductAuthoringView } from "../src/lib/catalog/product-authoring-view"
import type {
  FileTypes,
  ILockingModule,
  IFulfillmentModuleService,
  IStoreModuleService,
  ISalesChannelModuleService,
  IStockLocationService,
  IProductModuleService,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { knex, type Knex } from "@mikro-orm/knex"
import { createClient } from "redis"
import { randomUUID } from "node:crypto"
import type { MedusaRequest } from "@medusajs/framework"

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
import { readCatalogMediaAsset } from "../src/lib/catalog/transaction-persistence-contracts"
import { createCatalogProductWorkflow } from "../src/workflows/catalog/create-product"
import { catalogProductCreateSchema } from "../src/lib/catalog/product-create-contract"
import { hashCatalogCommand } from "../src/modules/catalog/catalog-command"

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
    describe("disposable PostgreSQL and Redis integration", () => {
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
        await fulfillment.createShippingProfiles({
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
        await locations.createStockLocations({ name: "HQ" })
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
