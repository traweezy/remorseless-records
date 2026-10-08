import path from "node:path"

import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { adminAuthorizationManifest } from "@/lib/admin-authorization-manifest"
import {
  inspectFailedCatalogCreation,
  repairFailedCatalogCreation,
} from "@/lib/catalog/failed-creation-repair"
import { GET, POST } from "./route"

jest.mock("@/lib/catalog/failed-creation-repair", () => ({
  ...jest.requireActual<Record<string, unknown>>(
    "@/lib/catalog/failed-creation-repair"
  ),
  inspectFailedCatalogCreation: jest.fn(),
  repairFailedCatalogCreation: jest.fn(),
}))

const inspectMock = jest.mocked(inspectFailedCatalogCreation)
const repairMock = jest.mocked(repairFailedCatalogCreation)
const sha = "a".repeat(40)
const query = { sha, productId: "prod_owned" }
const body = {
  ...query,
  expectedActorId: "user_operator",
  expectedManifestSha256: "b".repeat(64),
  idempotencyKey: "00000000-0000-4000-8000-000000000011",
}
const environment = {
  RAILWAY_PROJECT_ID: "1f39263a-25e4-4d69-abc2-f0287b331d1e",
  RAILWAY_ENVIRONMENT_ID: "799a2f98-f819-495d-b8b6-12e71af86568",
  RAILWAY_SERVICE_ID: "99d4fd5e-955b-416a-9078-0266bcf949d2",
  RAILWAY_GIT_COMMIT_SHA: sha,
}
const originalEnvironment = Object.fromEntries(
  Object.keys(environment).map((key) => [key, process.env[key]])
)
const request = (overrides: Record<string, unknown> = {}) =>
  ({
    auth_context: {
      actor_type: "user",
      actor_id: "user_operator",
      app_metadata: { roles: ["role_operator"] },
    },
    params: { creation_operation_id: "catop_owned" },
    query: { ...query },
    body: { ...body },
    scope: { resolve: jest.fn() },
    ...overrides,
  }) as unknown as AuthenticatedMedusaRequest
const response = () => {
  const res = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  }
  res.status.mockReturnValue(res)
  return res as unknown as MedusaResponse
}

beforeEach(() => {
  jest.clearAllMocks()
  Object.assign(process.env, environment)
})
afterAll(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("initialized Admin failed-creation boundary", () => {
  it("previews in the existing scope and applies with server-only user authority", async () => {
    const preview = { manifestSha256: body.expectedManifestSha256 }
    inspectMock.mockResolvedValue(
      preview as Awaited<ReturnType<typeof inspectFailedCatalogCreation>>
    )
    const repaired = {
      operationId: "catop_repair",
      replayed: false,
      result: { productId: query.productId },
    }
    repairMock.mockResolvedValue(repaired)
    const req = request()
    const res = response()
    await GET(req, res)
    expect(inspectMock).toHaveBeenCalledWith(req.scope, {
      creationOperationId: "catop_owned",
      productId: query.productId,
    })
    await POST(req, res)
    expect(repairMock).toHaveBeenCalledWith(
      req.scope,
      {
        creationOperationId: "catop_owned",
        productId: query.productId,
        expectedManifestSha256: body.expectedManifestSha256,
        idempotencyKey: body.idempotencyKey,
      },
      { actorId: "user_operator", source: "admin_http" }
    )
    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store"
    )
    expect(res.json).toHaveBeenNthCalledWith(1, {
      ...preview,
      actorId: "user_operator",
    })
    expect(res.json).toHaveBeenNthCalledWith(2, repaired)
  })
  it.each([GET, POST])(
    "rejects non-user, missing and malformed actors",
    async (handler) => {
      for (const auth_context of [
        undefined,
        { actor_type: "api-key", actor_id: "user_spoof" },
        { actor_type: "customer", actor_id: "user_spoof" },
        { actor_type: "user", actor_id: "" },
        { actor_type: "user", actor_id: "key_1" },
        { actor_type: "user", actor_id: "user_1 " },
      ])
        await expect(
          handler(request({ auth_context }), response())
        ).rejects.toMatchObject({
          type: "unauthorized",
        })
      expect(inspectMock).not.toHaveBeenCalled()
      expect(repairMock).not.toHaveBeenCalled()
    }
  )
  it.each(Object.keys(environment))(
    "rejects stale target %s before service access",
    async (key) => {
      for (const value of [undefined, "changed"]) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
        for (const handler of [GET, POST])
          await expect(handler(request(), response())).rejects.toMatchObject({
            type: "conflict",
          })
      }
      expect(inspectMock).not.toHaveBeenCalled()
      expect(repairMock).not.toHaveBeenCalled()
    }
  )
  it.each([
    { actorId: "user_spoof" },
    { source: "operator_cli" },
    { creationOperationId: "catop_other" },
    { apply: true },
  ])("rejects body and query authority/command additions %j", async (extra) => {
    await expect(
      GET(request({ query: { ...query, ...extra } }), response())
    ).rejects.toMatchObject({
      type: "invalid_data",
    })
    await expect(
      POST(request({ body: { ...body, ...extra } }), response())
    ).rejects.toMatchObject({
      type: "invalid_data",
    })
    expect(inspectMock).not.toHaveBeenCalled()
    expect(repairMock).not.toHaveBeenCalled()
  })
  it.each([
    { sha: [sha, sha] },
    { sha: "A".repeat(40) },
    { productId: "prod_bad/other" },
    { productId: ["prod_owned"] },
    { productId: undefined },
  ])(
    "rejects malformed/repeated preview and apply identity %j",
    async (change) => {
      for (const handler of [GET, POST])
        await expect(
          handler(
            request({
              query: { ...query, ...change },
              body: { ...body, ...change },
            }),
            response()
          )
        ).rejects.toMatchObject({
          type: "invalid_data",
        })
    }
  )
  it("rejects malformed path, unreviewed UUID/manifest and preview apply fields", async () => {
    for (const handler of [GET, POST])
      await expect(
        handler(
          request({ params: { creation_operation_id: "catop_bad/path" } }),
          response()
        )
      ).rejects.toMatchObject({ type: "invalid_data" })
    for (const change of [
      { idempotencyKey: "wrong" },
      { expectedManifestSha256: "b".repeat(63) },
      { expectedManifestSha256: undefined },
    ])
      await expect(
        POST(request({ body: { ...body, ...change } }), response())
      ).rejects.toMatchObject({ type: "invalid_data" })
    await expect(
      GET(
        request({ query: { ...query, idempotencyKey: body.idempotencyKey } }),
        response()
      )
    ).rejects.toMatchObject({ type: "invalid_data" })
  })
  it("preserves native conflicts and does not acknowledge failed inspection/repair", async () => {
    const failure = new Error("owned manifest changed")
    inspectMock.mockRejectedValue(failure)
    repairMock.mockRejectedValue(failure)
    for (const handler of [GET, POST]) {
      const res = response()
      await expect(handler(request(), res)).rejects.toBe(failure)
      expect(res.json).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    }
  })
  it("rejects a session switch before any first-use repair service call", async () => {
    const req = request({
      auth_context: { actor_type: "user", actor_id: "user_other" },
    })
    await expect(POST(req, response())).rejects.toMatchObject({
      type: "conflict",
    })
    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(repairMock).not.toHaveBeenCalled()
    expect(inspectMock).not.toHaveBeenCalled()
  })
})

describe("installed native conjunctive repair policy checking", () => {
  const frameworkDirectory = path.dirname(
    require.resolve("@medusajs/framework")
  )
  const { wrapWithPoliciesCheck } = jest.requireActual<{
    wrapWithPoliciesCheck: (
      handler: typeof GET,
      policies: ReadonlyArray<{ resource: string; operation: string }>
    ) => (
      req: AuthenticatedMedusaRequest,
      res: MedusaResponse,
      next: jest.Mock
    ) => Promise<void>
  }>(path.join(frameworkDirectory, "http/middlewares/check-permissions.js"))

  it.each(["GET", "POST"] as const)(
    "requires every real native %s policy before handler",
    async (method) => {
      const policies = adminAuthorizationManifest.find(
        (entry) =>
          entry.template ===
            "/admin/catalog/failed-creations/:creation_operation_id" &&
          entry.method === method
      )!.policies
      for (const missing of [null, ...policies]) {
        const granted = policies.filter((policy) => policy !== missing)
        const req = request()
        req.scope.resolve = jest.fn((key: string) => {
          if (key === ContainerRegistrationKeys.FEATURE_FLAG_ROUTER)
            return { isFeatureEnabled: () => true }
          if (key === Modules.CACHING) return undefined
          if (key === ContainerRegistrationKeys.QUERY)
            return {
              graph: async () => ({
                data: [
                  {
                    id: "role_operator",
                    policies: granted.map((policy, index) => ({
                      id: `policy_${index}`,
                      ...policy,
                    })),
                  },
                ],
              }),
            }
          throw new Error(`Unexpected native policy lookup ${key}`)
        }) as typeof req.scope.resolve
        const handler = jest.fn(async () => undefined)
        const next = jest.fn()
        await wrapWithPoliciesCheck(handler, policies)(req, response(), next)
        if (missing) {
          expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ type: "forbidden" })
          )
          expect(handler).not.toHaveBeenCalled()
        } else {
          expect(next).not.toHaveBeenCalled()
          expect(handler).toHaveBeenCalledTimes(1)
        }
      }
    }
  )
})
