import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { DELETE, PUT } from "./route"

const updateBody = {
  expectedActorId: "user_admin",
  expectedVersion: 1,
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  title: "Updated title",
}

const putFixture = (authContext: unknown, body: unknown = updateBody) => {
  const result = {
    entry: { id: "news_existing", title: "Updated title", version: 2 },
    replayed: false,
  }
  const service = {
    createNewsEntries: jest.fn(),
    createNewsOperations: jest.fn(),
    listNewsOperations: jest.fn(),
    retrieveNewsEntry: jest.fn(),
    runNewsTransaction: jest.fn().mockResolvedValue(result),
    updateNewsEntries: jest.fn(),
    updateNewsOperations: jest.fn(),
  }
  const resolve = jest.fn(() => service)
  const req = {
    auth_context: authContext,
    body,
    params: { id: "news_existing" },
    scope: { resolve },
  } as unknown as MedusaRequest
  const json = jest.fn()
  const status = jest.fn(() => ({ json }))
  const res = { json, status } as unknown as MedusaResponse
  return { json, req, res, resolve, result, service, status }
}

describe("PUT /admin/news/:id actor precondition", () => {
  it.each([
    undefined,
    null,
    {},
    { actor_id: "user_admin" },
    { actor_id: "user_admin", actor_type: "customer" },
    { actor_id: "user_admin", actor_type: "api-key" },
    { actor_id: 1, actor_type: "user" },
    { actor_id: "user_", actor_type: "user" },
    { actor_id: "user_other", actor_type: "user" },
  ])(
    "rejects native actor %p before resolving any service",
    async (context) => {
      const fixture = putFixture(context)
      await expect(PUT(fixture.req, fixture.res)).rejects.toThrow()
      expect(fixture.resolve).not.toHaveBeenCalled()
      for (const method of Object.values(fixture.service)) {
        expect(method).not.toHaveBeenCalled()
      }
      expect(fixture.status).not.toHaveBeenCalled()
      expect(fixture.json).not.toHaveBeenCalled()
    }
  )

  it.each([null, "", " user_admin", 1, {}])(
    "rejects malformed actor precondition %p before resolving any service",
    async (expectedActorId) => {
      const fixture = putFixture(
        { actor_id: "user_admin", actor_type: "user" },
        { ...updateBody, expectedActorId }
      )
      await expect(PUT(fixture.req, fixture.res)).rejects.toThrow(
        "Invalid news payload."
      )
      expect(fixture.resolve).not.toHaveBeenCalled()
      for (const method of Object.values(fixture.service)) {
        expect(method).not.toHaveBeenCalled()
      }
    }
  )

  it("accepts the actual matching native user", async () => {
    const fixture = putFixture({ actor_id: "user_admin", actor_type: "user" })
    await PUT(fixture.req, fixture.res)
    expect(fixture.resolve).toHaveBeenCalledWith("news")
    expect(fixture.service.runNewsTransaction).toHaveBeenCalledTimes(1)
    expect(fixture.status).toHaveBeenCalledWith(200)
    expect(fixture.json).toHaveBeenCalledWith(fixture.result)
  })

  it("preserves the legacy route when the precondition is omitted", async () => {
    const { expectedActorId: _expectedActorId, ...legacyBody } = updateBody
    const fixture = putFixture({ actor_id: "user_admin" }, legacyBody)
    await PUT(fixture.req, fixture.res)
    expect(fixture.resolve).toHaveBeenCalledWith("news")
    expect(fixture.service.runNewsTransaction).toHaveBeenCalledTimes(1)
    expect(fixture.json).toHaveBeenCalledWith(fixture.result)
  })
})

describe("DELETE /admin/news/:id", () => {
  it("rejects physical deletion in favor of archive", async () => {
    await expect(DELETE()).rejects.toThrow(
      "News posts are retained for audit history. Archive the post instead."
    )
  })
})
