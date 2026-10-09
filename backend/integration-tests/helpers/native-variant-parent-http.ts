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
import { randomUUID } from "node:crypto"

import { asUnknownRecord } from "../../src/lib/provider-boundary/records"

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
const adminHeaders = async (
  container: MedusaContainer,
  grant: boolean | "read-only" = true
) => {
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
  if (!flags.isFeatureEnabled("rbac"))
    throw new Error("Parent integrity proof requires actual native RBAC")
  if (flags.isFeatureEnabled("rbac")) {
    const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)
    const role = await rbac.createRbacRoles({
      name: `Disposable native HTTP ${randomUUID()}`,
    })
    const requestedPolicies =
      grant === "read-only"
        ? [
            { resource: "product", operation: "read" },
            { resource: "product_variant", operation: "read" },
          ]
        : [{ resource: "*", operation: "*" }]
    for (const requested of requestedPolicies) {
      const policies = await rbac.listRbacPolicies(requested, { take: 2 })
      if (policies.length > 1)
        throw new Error("Disposable native policy identity is ambiguous")
      const policy =
        policies[0] ??
        (await rbac.createRbacPolicies({
          key: `${requested.resource}:${requested.operation}`,
          ...requested,
        }))
      if (grant)
        await rbac.createRbacRolePolicies({
          role_id: role.id,
          policy_id: policy.id,
        })
    }
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
      { product_id: [own.id, foreign.id] },
      {
        select: ["id", "product_id", "title", "thumbnail"],
        take: 101,
        order: { id: "ASC" },
      }
    ),
  })
  return { foreign, own, products, snapshot }
}

export const registerNativeVariantParentHttpTests = (
  api: HttpApi,
  getContainer: () => MedusaContainer
): void => {
  describe("ordinary native Variant batch Product identity boundary", () => {
    it("updates a legitimate same-parent title without changing either parent", async () => {
      const container = getContainer()
      const { own, foreign, products } = await rows(container)
      const headers = await adminHeaders(container)
      const title = "Legitimate same-parent title"
      const response = await api.post(
        `/admin/products/${own.id}/variants/batch`,
        {
          create: [
            {
              title: "Native owned LP",
              options: { Format: "LP" },
              manage_inventory: false,
              prices: [],
            },
          ],
          update: [{ id: own.variants[0]!.id, title }],
          delete: [],
        },
        { headers, validateStatus: () => true }
      )
      expect(response.status).toBe(200)
      const reply = asUnknownRecord(response.data)
      if (!reply || !Array.isArray(reply.created) || reply.created.length !== 1)
        throw new Error(
          "Native batch response must contain one created Variant"
        )
      const created = asUnknownRecord(reply.created[0])
      if (!created || typeof created.id !== "string")
        throw new Error(
          "Native batch response must identify the created Variant"
        )
      expect(await products.retrieveProductVariant(created.id)).toMatchObject({
        title: "Native owned LP",
        product_id: own.id,
      })
      expect(
        await products.retrieveProductVariant(own.variants[0]!.id)
      ).toMatchObject({ id: own.variants[0]!.id, product_id: own.id, title })
      expect(
        await products.retrieveProductVariant(foreign.variants[0]!.id)
      ).toMatchObject({
        id: foreign.variants[0]!.id,
        product_id: foreign.id,
        title: foreign.variants[0]!.title,
      })
    })
    it("rejects foreign-parent title mutation and keeps that Variant unchanged without reparenting", async () => {
      const container = getContainer()
      const { own, foreign, products, snapshot } = await rows(container)
      const before = await snapshot()
      const headers = await adminHeaders(container)
      const title = "This foreign title must never persist"
      const response = await api.post(
        `/admin/products/${own.id}/variants/batch`,
        {
          create: [
            {
              title: "Must not create",
              options: { Format: "LP" },
              manage_inventory: false,
              prices: [],
            },
          ],
          update: [{ id: foreign.variants[0]!.id, title }],
          delete: [],
        },
        { headers, validateStatus: () => true }
      )
      const after = await snapshot()
      expect(
        (await products.retrieveProductVariant(foreign.variants[0]!.id))
          .product_id
      ).toBe(foreign.id)
      expect(response.status).toBe(404)
      expect(after).toEqual(before)
      const deletion = await api.post(
        `/admin/products/${own.id}/variants/batch`,
        {
          create: [
            {
              title: "Must not create",
              options: { Format: "LP" },
              manage_inventory: false,
              prices: [],
            },
          ],
          update: [{ id: foreign.variants[0]!.id, title }],
          delete: [foreign.variants[0]!.id],
        },
        { headers, validateStatus: () => true }
      )
      expect(deletion.status).toBe(409)
      expect(deletion.data).toMatchObject({
        code: "catalog_hard_deletion_disabled",
      })
      expect(await snapshot()).toEqual(before)
    })
    it("rejects an unknown Variant ID without changing any native state", async () => {
      const container = getContainer()
      const { own, snapshot } = await rows(container)
      const before = await snapshot()
      const headers = await adminHeaders(container)
      const response = await api.post(
        `/admin/products/${own.id}/variants/batch`,
        {
          update: [
            {
              id: "variant_disposable_verified_unknown",
              title: "Unknown title",
            },
          ],
          delete: [],
        },
        { headers, validateStatus: () => true }
      )
      const after = await snapshot()
      expect(response.status).toBe(404)
      expect(after).toEqual(before)
    })
    it("retains the installed native denied policy before any title update", async () => {
      const container = getContainer()
      const { own, snapshot } = await rows(container)
      const before = await snapshot()
      const headers = await adminHeaders(container, false)
      const response = await api.post(
        `/admin/products/${own.id}/variants/batch`,
        {
          update: [{ id: own.variants[0]!.id, title: "Denied title" }],
          delete: [],
        },
        { headers, validateStatus: () => true }
      )
      const after = await snapshot()
      expect(response.status).toBe(403)
      expect(after).toEqual(before)
      const readOnly = await adminHeaders(container, "read-only")
      const denied = await api.post(
        `/admin/products/${own.id}/variants/batch`,
        {
          update: [{ id: own.variants[0]!.id, title: "Denied mutation" }],
          delete: [],
        },
        { headers: readOnly, validateStatus: () => true }
      )
      expect(denied.status).toBe(403)
      expect(await snapshot()).toEqual(before)
    })
    it("rejects a mixed legitimate and foreign title batch atomically with both parent identities unchanged", async () => {
      const container = getContainer()
      const { own, foreign, products, snapshot } = await rows(container)
      const before = await snapshot()
      const headers = await adminHeaders(container)
      const response = await api.post(
        `/admin/products/${own.id}/variants/batch`,
        {
          create: [
            {
              title: "Must not create",
              options: { Format: "LP" },
              manage_inventory: false,
              prices: [],
            },
          ],
          update: [
            {
              id: own.variants[0]!.id,
              title: "Own mixed title must not persist",
            },
            {
              id: foreign.variants[0]!.id,
              title: "Foreign mixed title must not persist",
            },
          ],
          delete: [],
        },
        { headers, validateStatus: () => true }
      )
      const after = await snapshot()
      expect(
        (await products.retrieveProductVariant(own.variants[0]!.id)).product_id
      ).toBe(own.id)
      expect(
        (await products.retrieveProductVariant(foreign.variants[0]!.id))
          .product_id
      ).toBe(foreign.id)
      expect(response.status).toBe(404)
      expect(after).toEqual(before)
    })
  })
}
