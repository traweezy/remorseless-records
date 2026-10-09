import { randomUUID } from "node:crypto"

import type {
  ConfigModule,
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

import type { CatalogService } from "../../src/api/admin/catalog/utils"
import { adminAuthorizationManifest } from "../../src/lib/admin-authorization-manifest"
import { hashCatalogCommand } from "../../src/modules/catalog/catalog-command"

type Reply = { status: number; data: unknown }
type Options = {
  headers?: Record<string, string>
  validateStatus?: (status: number) => boolean
}
type HttpApi = {
  get: (path: string, options?: Options) => Promise<Reply>
  put: (path: string, body: unknown, options?: Options) => Promise<Reply>
}
type Fixture = {
  catalog: CatalogService
  container: MedusaContainer
  mediaAssetId: string
  component: { productId: string; variantIds: string[] }
}
const template = "/admin/catalog/products/:product_id/media"
const policiesFor = (method: "GET" | "PUT") => {
  const entry = adminAuthorizationManifest.find(
    (entry) => entry.template === template && entry.method === method
  )
  if (!entry) throw new Error("Product gallery HTTP policy inventory is absent")
  return entry.policies
}
const allPolicies = () =>
  [...policiesFor("GET"), ...policiesFor("PUT")].filter(
    (policy, index, array) =>
      array.findIndex(
        (other) =>
          other.resource === policy.resource &&
          other.operation === policy.operation
      ) === index
  )
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Product gallery HTTP fixture expected an object")
  return value as Record<string, unknown>
}
let clientNumber = 100
const caller = async (
  container: MedusaContainer,
  grants: ReadonlyArray<ReturnType<typeof policiesFor>[number]>,
  actorType = "user"
) => {
  if (process.env.INTEGRATION_TESTS_ENABLED !== "1")
    throw new Error("Gallery HTTP fixtures require the disposable runner")
  const config = container.resolve<ConfigModule>(
    ContainerRegistrationKeys.CONFIG_MODULE
  )
  const http = config.projectConfig.http
  const flags = container.resolve<{
    isFeatureEnabled: (name: string) => boolean
  }>(ContainerRegistrationKeys.FEATURE_FLAG_ROUTER)
  if (
    http.jwtSecret !== "disposable_jwt_secret" ||
    !flags.isFeatureEnabled("rbac")
  )
    throw new Error(
      "Gallery HTTP fixtures require synthetic authentication and native RBAC"
    )
  const user = await container
    .resolve<IUserModuleService>(Modules.USER)
    .createUsers({ email: `gallery-http-${randomUUID()}@example.invalid` })
  const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)
  const role = await rbac.createRbacRoles({
    name: `Disposable gallery ${randomUUID()}`,
  })
  for (const grant of grants) {
    const policies = await rbac.listRbacPolicies(grant, { take: 2 })
    if (policies.length > 1)
      throw new Error("Disposable native policy identity is ambiguous")
    const policy =
      policies[0] ??
      (await rbac.createRbacPolicies({
        key: `${grant.resource}:${grant.operation}`,
        ...grant,
      }))
    await rbac.createRbacRolePolicies({
      role_id: role.id,
      policy_id: policy.id,
    })
  }
  const token = generateJwtToken(
    {
      actor_id: user.id,
      actor_type: actorType,
      auth_identity_id: "",
      app_metadata: { user_id: user.id, roles: [role.id] },
      user_metadata: {},
    },
    {
      secret: http.jwtSecret,
      expiresIn: "5m",
      ...(http.jwtOptions ? { jwtOptions: http.jwtOptions } : {}),
    }
  )
  return {
    actorId: user.id,
    headers: {
      authorization: `Bearer ${token}`,
      // Real limiter, distinct synthetic proxy clients. Neither a limiter
      // waiver nor evidence of the production proxy/session transport.
      "x-real-ip": `192.0.2.${++clientNumber}`,
    },
    validateStatus: () => true,
  }
}
const nativeState = async (fixture: Fixture) => {
  const products = fixture.container.resolve<IProductModuleService>(
    Modules.PRODUCT
  )
  return {
    product: await products.retrieveProduct(fixture.component.productId, {
      select: ["id", "title", "thumbnail"],
    }),
    variants: await products.listProductVariants(
      { product_id: fixture.component.productId },
      {
        select: ["id", "product_id", "title", "thumbnail"],
        take: 100,
        order: { id: "ASC" },
      }
    ),
  }
}
const snapshot = async (fixture: Fixture) => ({
  native: await nativeState(fixture),
  assets: await fixture.catalog.listCatalogMediaAssets(
    { id: fixture.mediaAssetId },
    { take: 2 }
  ),
  profiles: await fixture.catalog.listCatalogProductProfiles(
    { product_id: fixture.component.productId },
    { withDeleted: true, take: 2 }
  ),
  variantProfiles: await fixture.catalog.listCatalogVariantProfiles(
    { variant_id: fixture.component.variantIds },
    { withDeleted: true, take: 100, order: { id: "ASC" } }
  ),
  media: await fixture.catalog.listCatalogProductMediaItems(
    { product_id: fixture.component.productId },
    { withDeleted: true, take: 101, order: { id: "ASC" } }
  ),
  operations: await fixture.catalog.listCatalogAuthoringOperations(
    {
      aggregate_id: fixture.component.productId,
      command: "catalog.product-media.replace",
    },
    { take: 100, order: { id: "ASC" } }
  ),
})

export const registerCatalogProductMediaHttpTests = (
  api: HttpApi,
  createFixture: () => Promise<Fixture>
): void => {
  describe("initialized native Admin Product gallery HTTP mutation", () => {
    const proxyIdentity = {
      RAILWAY_PROJECT_ID: "disposable-gallery-project",
      RAILWAY_ENVIRONMENT_ID: "disposable-gallery-environment",
      RAILWAY_SERVICE_ID: "disposable-gallery-service",
    }
    let previousEnvironment: Record<string, string | undefined>
    beforeEach(() => {
      if (process.env.INTEGRATION_TESTS_ENABLED !== "1")
        throw new Error("Gallery proxy fixtures require the disposable runner")
      previousEnvironment = Object.fromEntries(
        Object.keys(proxyIdentity).map((key) => [key, process.env[key]])
      )
      // Enable the existing trusted-proxy contract only in the owned fixture.
      // These markers are not staging identity or permission evidence.
      Object.assign(process.env, proxyIdentity)
    })
    afterEach(() => {
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })

    it("enforces native grants and the reviewed actor before first-use writes", async () => {
      const fixture = await createFixture()
      const actor = await caller(fixture.container, allPolicies())
      const other = await caller(fixture.container, allPolicies())
      const nonUser = await caller(fixture.container, allPolicies(), "customer")
      const path = `/admin/catalog/products/${fixture.component.productId}/media`
      const initial = await api.get(path, actor)
      expect(initial.status).toBe(200)
      const before = await snapshot(fixture)
      const body = {
        expectedVersion: object(initial.data).version,
        expectedActorId: actor.actorId,
        idempotencyKey: randomUUID(),
        media: [{ mediaAssetId: fixture.mediaAssetId }],
      }
      expect(
        (await api.put(path, body, { validateStatus: () => true })).status
      ).toBe(401)
      for (const missing of policiesFor("PUT")) {
        const denied = await caller(
          fixture.container,
          policiesFor("PUT").filter((grant) => grant !== missing)
        )
        expect(
          (
            await api.put(
              path,
              { ...body, expectedActorId: denied.actorId },
              denied
            )
          ).status
        ).toBe(403)
      }
      expect((await api.put(path, body, nonUser)).status).toBe(401)
      expect((await api.put(path, body, other)).status).toBe(409)
      expect(
        (await api.put(path, { ...body, expectedActorId: "customer_1" }, actor))
          .status
      ).toBe(400)
      expect(
        (
          await api.put(
            path,
            { ...body, expectedVersion: Number(body.expectedVersion) + 1 },
            actor
          )
        ).status
      ).toBe(409)
      expect(await snapshot(fixture)).toEqual(before)
      expect((await api.get(path, actor)).data).toEqual(initial.data)
      expect(
        await fixture.catalog.listCatalogAuthoringOperations({
          idempotency_key: body.idempotencyKey,
        })
      ).toHaveLength(0)
    })

    it("binds native artwork and immutable actor replay while returning the current gallery", async () => {
      const fixture = await createFixture()
      const actor = await caller(fixture.container, allPolicies())
      const other = await caller(fixture.container, allPolicies())
      const path = `/admin/catalog/products/${fixture.component.productId}/media`
      const initial = await api.get(path, actor)
      expect(initial.status).toBe(200)
      const seedVersion = Number(object(initial.data).version)
      expect(Number.isSafeInteger(seedVersion)).toBe(true)
      const empty = await snapshot(fixture)
      expect(empty.profiles).toHaveLength(1)
      const variantId = fixture.component.variantIds[0]!
      const productProfileId = empty.profiles[0]!.id
      // Seed an actual mixed gallery, then re-save its exact seven authored
      // fields. Native drift is injected only through the owned test module.
      const media = [
        {
          mediaAssetId: fixture.mediaAssetId,
          variantId: null,
          productProfileId,
          role: "primary",
          sortOrder: 3,
          isPrimary: true,
          metadata: {
            source: "owned-product",
            opaque: { flags: [true, null, 2] },
          },
        },
        {
          mediaAssetId: fixture.mediaAssetId,
          variantId,
          productProfileId,
          role: "primary",
          sortOrder: 11,
          isPrimary: true,
          metadata: {
            source: "owned-variant",
            opaque: { note: "Retain exactly" },
          },
        },
      ]
      const seeded = await api.put(
        path,
        {
          expectedVersion: seedVersion,
          expectedActorId: actor.actorId,
          idempotencyKey: randomUUID(),
          media,
        },
        actor
      )
      expect(seeded.status).toBe(200)
      const expectedVersion = seedVersion + 1
      expect(object(seeded.data).version).toBe(expectedVersion)
      const sevenFields = (response: unknown) => {
        const links = object(response).media
        if (!Array.isArray(links))
          throw new Error("Gallery response links absent")
        return links
          .map((entry) => {
            const item = object(entry)
            return Object.fromEntries(
              [
                "mediaAssetId",
                "variantId",
                "productProfileId",
                "role",
                "sortOrder",
                "isPrimary",
                "metadata",
              ].map((key) => [key, item[key]])
            )
          })
          .sort(
            (left, right) =>
              String(left.variantId ?? "").localeCompare(
                String(right.variantId ?? "")
              ) ||
              Number(left.sortOrder) - Number(right.sortOrder) ||
              String(left.mediaAssetId).localeCompare(
                String(right.mediaAssetId)
              )
          )
      }
      expect(sevenFields(seeded.data)).toEqual(media)
      const products = fixture.container.resolve<IProductModuleService>(
        Modules.PRODUCT
      )
      const driftedThumbnail =
        "https://media.example.com/owned-native-drift.webp"
      await products.updateProducts(fixture.component.productId, {
        thumbnail: driftedThumbnail,
      })
      await products.updateProductVariants(variantId, {
        thumbnail: driftedThumbnail,
      })
      const before = await snapshot(fixture)
      expect(before.native.product.thumbnail).toBe(driftedThumbnail)
      expect(
        before.native.variants.find((row) => row.id === variantId)?.thumbnail
      ).toBe(driftedThumbnail)
      const observed = await api.get(path, actor)
      expect(observed.status).toBe(200)
      expect(sevenFields(observed.data)).toEqual(media)
      expect(object(observed.data).version).toBe(expectedVersion)
      const body = {
        expectedVersion,
        expectedActorId: actor.actorId,
        idempotencyKey: randomUUID(),
        media,
      }
      const written = await api.put(path, body, actor)
      expect(written.status).toBe(200)
      expect(written.data).toMatchObject({
        productId: fixture.component.productId,
        version: expectedVersion + 1,
      })
      expect(sevenFields(written.data)).toEqual(media)
      expect((await api.get(path, actor)).data).toEqual(written.data)
      const after = await snapshot(fixture)
      expect(after.assets).toEqual(before.assets)
      expect(after.profiles).toEqual(before.profiles)
      expect(after.variantProfiles).toEqual(before.variantProfiles)
      expect(after.media.filter((row) => !row.deleted_at)).toHaveLength(2)
      expect(after.assets[0]!.version).toBe(before.assets[0]!.version)
      expect(after.native.product.thumbnail).toBe(before.assets[0]!.source_url)
      expect(
        after.native.variants.find((row) => row.id === variantId)?.thumbnail
      ).toBe(before.assets[0]!.source_url)
      const originalOperations =
        await fixture.catalog.listCatalogAuthoringOperations({
          idempotency_key: body.idempotencyKey,
        })
      expect(originalOperations).toHaveLength(1)
      expect(originalOperations[0]).toMatchObject({
        actor_id: actor.actorId,
        expected_version: expectedVersion,
        status: "succeeded",
        result: {
          productId: fixture.component.productId,
          version: expectedVersion + 1,
        },
        request_sha256: hashCatalogCommand({
          command: "catalog.product-media.replace",
          expectedVersion,
          media: body.media,
          productId: fixture.component.productId,
        }),
      })
      expect((await api.put(path, body, actor)).data).toEqual(written.data)
      const { expectedActorId: _precondition, ...legacyBody } = body
      expect((await api.put(path, legacyBody, actor)).data).toEqual(
        written.data
      )
      expect((await api.put(path, { ...body, media: [] }, actor)).status).toBe(
        409
      )
      expect(
        (
          await api.put(
            path,
            { ...body, expectedActorId: other.actorId },
            other
          )
        ).status
      ).toBe(409)
      expect(await snapshot(fixture)).toEqual(after)

      const later = await api.put(
        path,
        {
          expectedActorId: actor.actorId,
          expectedVersion: expectedVersion + 1,
          idempotencyKey: randomUUID(),
          media: [],
        },
        actor
      )
      expect(later.status).toBe(200)
      expect(later.data).toEqual({
        productId: fixture.component.productId,
        version: expectedVersion + 2,
        media: [],
      })
      const laterState = await snapshot(fixture)
      expect(laterState.assets).toEqual(before.assets)
      expect(laterState.profiles).toEqual(before.profiles)
      expect(laterState.variantProfiles).toEqual(before.variantProfiles)
      expect(laterState.native.product.thumbnail).toBeNull()
      expect(
        laterState.native.variants.find((row) => row.id === variantId)
          ?.thumbnail
      ).toBeNull()
      const replay = await api.put(path, body, actor)
      expect(replay.status).toBe(200)
      // An immutable successful operation does not restore its old projection
      // over a later legitimate writer. UI acknowledgement must preserve this.
      expect(replay.data).toEqual(later.data)
      expect(await snapshot(fixture)).toEqual(laterState)
      expect(
        await fixture.catalog.listCatalogAuthoringOperations({
          idempotency_key: body.idempotencyKey,
        })
      ).toEqual(originalOperations)
    })
  })
}
