import { randomUUID } from "node:crypto"

import type {
  ConfigModule,
  ICartModuleService,
  IOrderModuleService,
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
import type { FailedCreationRepairIdentity } from "../../src/lib/catalog/failed-creation-repair"
import { readIsoTimestamp } from "../../src/lib/provider-boundary/primitives"
import { hashCatalogCommand } from "../../src/modules/catalog/catalog-command"

type Reply = {
  status: number
  data: unknown
  headers: Record<string, unknown>
}
type Options = {
  headers?: Record<string, string>
  validateStatus?: (status: number) => boolean
}
type HttpApi = {
  get: (path: string, options?: Options) => Promise<Reply>
  post: (path: string, body: unknown, options?: Options) => Promise<Reply>
}
type Fixture = {
  container: MedusaContainer
  catalog: CatalogService
  identity: FailedCreationRepairIdentity
  snapshot: () => Promise<unknown>
}
const sha = "c".repeat(40)
const target = {
  RAILWAY_PROJECT_ID: "1f39263a-25e4-4d69-abc2-f0287b331d1e",
  RAILWAY_ENVIRONMENT_ID: "799a2f98-f819-495d-b8b6-12e71af86568",
  RAILWAY_SERVICE_ID: "99d4fd5e-955b-416a-9078-0266bcf949d2",
  RAILWAY_GIT_COMMIT_SHA: sha,
}
const template = "/admin/catalog/failed-creations/:creation_operation_id"
let fixtureClientNumber = 0
const policiesFor = (method: "GET" | "POST") => {
  const entry = adminAuthorizationManifest.find(
    (entry) => entry.template === template && entry.method === method
  )
  if (!entry) throw new Error("Failed-creation HTTP policy inventory is absent")
  return entry.policies
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Failed-creation HTTP fixture expected a response object")
  return value as Record<string, unknown>
}

const caller = async (
  container: MedusaContainer,
  grants: ReturnType<typeof policiesFor>
) => {
  if (process.env.INTEGRATION_TESTS_ENABLED !== "1")
    throw new Error("Repair HTTP fixtures require the disposable runner")
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
      "Repair HTTP fixtures require synthetic authentication and native RBAC"
    )
  const user = await container
    .resolve<IUserModuleService>(Modules.USER)
    .createUsers({
      email: `repair-http-${randomUUID()}@example.invalid`,
    })
  const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)
  const role = await rbac.createRbacRoles({
    name: `Disposable repair ${randomUUID()}`,
  })
  for (const grant of grants) {
    const existing = await rbac.listRbacPolicies(grant, { take: 2 })
    if (existing.length > 1)
      throw new Error("Disposable native policy identity is ambiguous")
    const policy =
      existing[0] ??
      (await rbac.createRbacPolicies({
        key: `${grant.resource}:${grant.operation}`,
        ...grant,
      }))
    await rbac.createRbacRolePolicies({
      role_id: role.id,
      policy_id: policy.id,
    })
  }
  // Synthetic persisted fixture user only; the actual HTTP server still runs
  // native authenticate/session/JWT verification and conjunctive policy checks.
  const token = generateJwtToken(
    {
      actor_id: user.id,
      actor_type: "user",
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
      // The exact target fixture enables the Railway proxy-IP contract. Use
      // distinct documentation-range clients, preserving the real limiter;
      // this is not evidence of the live proxy transport or a limiter waiver.
      "x-real-ip": `192.0.2.${++fixtureClientNumber}`,
    },
    validateStatus: () => true,
  }
}

const unrelatedBusinessRows = async (container: MedusaContainer) => {
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
  const carts = container.resolve<ICartModuleService>(Modules.CART)
  return {
    products: await products.listProducts(
      {},
      { select: ["id", "title", "thumbnail"], take: 1000, order: { id: "ASC" } }
    ),
    variants: await products.listProductVariants(
      {},
      {
        select: ["id", "product_id", "title", "thumbnail"],
        take: 1000,
        order: { id: "ASC" },
      }
    ),
    orders: await orders.listOrders(
      {},
      { select: ["id"], take: 1000, order: { id: "ASC" } }
    ),
    carts: await carts.listCarts(
      {},
      { select: ["id"], take: 1000, order: { id: "ASC" } }
    ),
  }
}

export const registerFailedCreationRepairHttpTests = (
  api: HttpApi,
  createFixture: () => Promise<Fixture>
): void => {
  describe("initialized native Admin failed-creation HTTP repair", () => {
    let originalEnvironment: Record<string, string | undefined>
    beforeEach(() => {
      if (process.env.INTEGRATION_TESTS_ENABLED !== "1")
        throw new Error("Repair target fixtures require the disposable runner")
      originalEnvironment = Object.fromEntries(
        Object.keys(target).map((key) => [key, process.env[key]])
      )
      // These are fixture preconditions, never live deployment identity proof.
      Object.assign(process.env, target)
    })
    afterEach(() => {
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })

    it("traverses native authentication and denies each missing preview/apply grant without writes", async () => {
      const { container, catalog, identity, snapshot } = await createFixture()
      const before = await snapshot()
      const business = await unrelatedBusinessRows(container)
      const path = `/admin/catalog/failed-creations/${identity.creationOperationId}`
      const query = `?productId=${identity.productId}&sha=${sha}`
      expect(
        (await api.get(path + query, { validateStatus: () => true })).status
      ).toBe(401)
      for (const method of ["GET", "POST"] as const) {
        const policies = policiesFor(method)
        for (const missing of policies) {
          const actor = await caller(
            container,
            policies.filter(
              (policy) => policy !== missing
            ) as unknown as typeof policies
          )
          const reply =
            method === "GET"
              ? await api.get(path + query, actor)
              : await api.post(
                  path,
                  {
                    productId: identity.productId,
                    sha,
                    expectedActorId: actor.actorId,
                    expectedManifestSha256: "f".repeat(64),
                    idempotencyKey: randomUUID(),
                  },
                  actor
                )
          expect(reply.status).toBe(403)
        }
      }
      const reader = await caller(container, policiesFor("GET"))
      const preview = await api.get(path + query, reader)
      expect(preview.status).toBe(200)
      expect(preview.headers["cache-control"]).toBe("private, no-store")
      expect(object(preview.data).actorId).toBe(reader.actorId)
      expect(
        (
          await api.post(
            path,
            {
              productId: identity.productId,
              sha,
              expectedActorId: reader.actorId,
              expectedManifestSha256: object(preview.data).manifestSha256,
              idempotencyKey: randomUUID(),
            },
            reader
          )
        ).status
      ).toBe(403)
      expect(await snapshot()).toEqual(before)
      expect(await unrelatedBusinessRows(container)).toEqual(business)
      expect(
        await catalog.listCatalogAuthoringOperations({
          command: "catalog.failed-creation.repair",
        })
      ).toHaveLength(0)
    })

    it("checks exact target, actor and reviewed manifest before first-use mutation then replays only the same actor/body", async () => {
      const { container, catalog, identity, snapshot } = await createFixture()
      const actor = await caller(container, policiesFor("POST"))
      const other = await caller(container, policiesFor("POST"))
      const before = object(await snapshot())
      const business = await unrelatedBusinessRows(container)
      const path = `/admin/catalog/failed-creations/${identity.creationOperationId}`
      const preview = await api.get(
        `${path}?productId=${identity.productId}&sha=${sha}`,
        actor
      )
      expect(preview.status).toBe(200)
      const data = object(preview.data)
      const body = {
        productId: identity.productId,
        sha,
        expectedActorId: data.actorId,
        expectedManifestSha256: data.manifestSha256,
        idempotencyKey: randomUUID(),
      }
      expect((await api.post(path, body, other)).status).toBe(409)
      for (const key of Object.keys(target)) {
        const original = process.env[key]
        try {
          process.env[key] = "changed"
          expect((await api.post(path, body, actor)).status).toBe(409)
        } finally {
          process.env[key] = original
        }
      }
      expect(
        (await api.post(path, { ...body, actorId: other.actorId }, actor))
          .status
      ).toBe(400)
      expect(
        (
          await api.post(
            path,
            { ...body, expectedManifestSha256: "f".repeat(64) },
            actor
          )
        ).status
      ).toBe(409)
      expect(await snapshot()).toEqual(before)
      const repaired = await api.post(path, body, actor)
      expect(repaired.status).toBe(200)
      expect(object(repaired.data).replayed).toBe(false)
      const after = object(await snapshot())
      expect(after.assets).toEqual(before.assets)
      expect(after.history).toEqual(before.history)
      for (const rows of [after.profiles, after.variants, after.media]) {
        expect(Array.isArray(rows)).toBe(true)
        expect(rows).toHaveLength(1)
        expect(
          readIsoTimestamp(object((rows as unknown[])[0]).deleted_at)
        ).not.toBeNull()
      }
      expect(await unrelatedBusinessRows(container)).toEqual(business)
      const replay = await api.post(path, body, actor)
      expect(replay.status).toBe(200)
      expect(replay.data).toEqual({ ...object(repaired.data), replayed: true })
      expect(
        (
          await api.post(
            path,
            { ...body, expectedActorId: other.actorId },
            other
          )
        ).status
      ).toBe(409)
      expect(await snapshot()).toEqual(after)
      const operations = await catalog.listCatalogAuthoringOperations({
        idempotency_key: body.idempotencyKey,
      })
      expect(operations).toHaveLength(1)
      expect(operations[0]).toMatchObject({
        actor_id: actor.actorId,
        metadata: {
          source: "admin_http",
          creation_operation_id: identity.creationOperationId,
        },
        request_sha256: hashCatalogCommand({
          command: {
            ...identity,
            expectedManifestSha256: body.expectedManifestSha256,
            idempotencyKey: body.idempotencyKey,
          },
          authority: { actorId: actor.actorId, source: "admin_http" },
        }),
      })
      // A lost acknowledgment is recovered by exact POST, not a new preview:
      // successful repair intentionally removes the rows needed for preview.
      expect(
        (
          await api.get(
            `${path}?productId=${identity.productId}&sha=${sha}`,
            actor
          )
        ).status
      ).toBe(409)
    })

    it("rolls back soft-deletion and audit completion failure before exact-body retry", async () => {
      const { container, catalog, identity, snapshot } = await createFixture()
      const actor = await caller(container, policiesFor("POST"))
      const before = await snapshot()
      const business = await unrelatedBusinessRows(container)
      const path = `/admin/catalog/failed-creations/${identity.creationOperationId}`
      const preview = await api.get(
        `${path}?productId=${identity.productId}&sha=${sha}`,
        actor
      )
      expect(preview.status).toBe(200)
      const body = {
        productId: identity.productId,
        sha,
        expectedActorId: actor.actorId,
        expectedManifestSha256: object(preview.data).manifestSha256,
        idempotencyKey: randomUUID(),
      }
      const completion = jest
        .spyOn(catalog, "completeCatalogAuthoringOperation")
        .mockRejectedValue(
          new Error("Injected owned HTTP repair completion failure")
        )
      try {
        expect((await api.post(path, body, actor)).status).toBe(500)
        expect(await snapshot()).toEqual(before)
        expect(await unrelatedBusinessRows(container)).toEqual(business)
        expect(
          await catalog.listCatalogAuthoringOperations({
            idempotency_key: body.idempotencyKey,
          })
        ).toHaveLength(0)
      } finally {
        completion.mockRestore()
      }
      const retried = await api.post(path, body, actor)
      expect(retried.status).toBe(200)
      expect(object(retried.data).replayed).toBe(false)
      expect(await unrelatedBusinessRows(container)).toEqual(business)
    })
  })
}
