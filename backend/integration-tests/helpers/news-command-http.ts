import {
  createApiKeysWorkflow,
  createUserAccountWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/core-flows"
import type {
  ConfigModule,
  IAuthModuleService,
  IRbacModuleService,
  ISalesChannelModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { randomBytes, randomUUID } from "node:crypto"

import {
  beginNewsCommand,
  newsCommandStorageKey,
  readSavedNewsCommand,
  restoreNewsCommand,
  retryNewsCommand,
  type NewsCommandBoundary,
} from "../../src/admin/features/news/news-command-state"
import {
  newsEntrySchema,
  newsMutationSchema,
  type NewsEntry,
  type NewsUpdateBody,
  type NewsWriteInput,
} from "../../src/admin/features/news/news-query"
import type { NewsService } from "../../src/api/admin/news/command"
import { newsUpdateSchema } from "../../src/api/admin/news/contracts"
import { hashCatalogCommand } from "../../src/modules/catalog/catalog-command"
import { serializeNewsEntry } from "../../src/modules/news/serializers"
import { sanitizeRichTextHtml } from "../../src/lib/content/rich-text"
import { createNewsLostReplyTransport } from "./news-command-transport"

type Reply = { status: number; data: unknown }
type HttpApi = {
  defaults: { baseURL?: string }
  request: (options: {
    url: string
    method: string
    data?: unknown
    headers?: Record<string, string>
    validateStatus: (status: number) => boolean
  }) => Promise<Reply>
}
type Actor = {
  id: string
  roleId: string
  email: string
  password: string
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Owned News fixture expected an object")
  return value as Record<string, unknown>
}
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const writeInput = (changes: Partial<NewsWriteInput> = {}): NewsWriteInput => ({
  title: "Owned News command",
  content: "<p>Owned News body</p>",
  coverUrl: null,
  coverAltText: null,
  excerpt: null,
  publishedAt: null,
  status: "draft",
  tags: [],
  ...changes,
})
const storage = (): NewsCommandBoundary["storage"] => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

const assertEnvironment = (container: MedusaContainer, api: HttpApi) => {
  if (process.env.INTEGRATION_TESTS_ENABLED !== "1")
    throw new Error("News fixtures require the guarded disposable runner")
  const config = container.resolve<ConfigModule>(
    ContainerRegistrationKeys.CONFIG_MODULE
  )
  const database = new URL(config.projectConfig.databaseUrl ?? "")
  const origin = new URL(api.defaults.baseURL ?? "")
  const flags = container.resolve<{
    isFeatureEnabled: (key: string) => boolean
  }>(ContainerRegistrationKeys.FEATURE_FLAG_ROUTER)
  if (
    config.projectConfig.http.jwtSecret !== "disposable_jwt_secret" ||
    config.projectConfig.http.cookieSecret !== "disposable_cookie_secret" ||
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.pathname !== "/rr_disposable_news" ||
    !flags.isFeatureEnabled("rbac") ||
    origin.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(origin.hostname) ||
    !origin.port ||
    Number(origin.port) < 1024 ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password
  )
    throw new Error("News fixtures require exact synthetic DB, HTTP and RBAC")
  return origin.origin
}

const createActor = async (
  container: MedusaContainer,
  tag: string,
  name: string,
  grants: readonly string[]
): Promise<Actor> => {
  const email = `news-${name}-${tag}@example.invalid`
  const password = randomBytes(24).toString("base64url")
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH)
  const registration = await auth.register("emailpass", {
    body: { email, password },
  })
  if (!registration.success || !registration.authIdentity?.id)
    throw new Error("Owned native News emailpass registration failed")
  const { result: user } = await createUserAccountWorkflow(container).run({
    input: {
      authIdentityId: registration.authIdentity.id,
      userData: { email, first_name: "News", last_name: name },
    },
  })
  const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)
  const role = await rbac.createRbacRoles({ name: `News ${name} ${tag}` })
  for (const key of grants) {
    const [resource, operation] = key.split(":")
    if (resource !== "news" || !operation)
      throw new Error("Owned News fixture has an unexpected grant")
    const policies = await rbac.listRbacPolicies({ key }, { take: 2 })
    if (policies.length > 1)
      throw new Error("Owned native News policy key is ambiguous")
    const policy =
      policies[0] ??
      (await rbac.createRbacPolicies({
        key,
        resource,
        operation,
      }))
    await rbac.createRbacRolePolicies({
      role_id: role.id,
      policy_id: policy.id,
    })
  }
  await container
    .resolve<{
      create: (value: Record<string, unknown>) => Promise<unknown>
    }>(ContainerRegistrationKeys.LINK)
    .create({
      [Modules.USER]: { user_id: user.id },
      [Modules.RBAC]: { rbac_role_id: role.id },
    })
  return { id: user.id, roleId: role.id, email, password }
}

export const createNativeNewsFixture = async (
  container: MedusaContainer,
  api: HttpApi
) => {
  const origin = assertEnvironment(container, api)
  const tag = randomUUID()
  const grants = ["news:read", "news:create", "news:update"]
  const actors = {
    first: await createActor(container, tag, "first", grants),
    second: await createActor(container, tag, "second", grants),
    reader: await createActor(container, tag, "reader", ["news:read"]),
  }
  const tokens = new Map<string, Record<string, string>>()
  const headers = async (actor = actors.first) => {
    const existing = tokens.get(actor.id)
    if (existing) return { ...existing }
    const reply = await api.request({
      url: "/auth/user/emailpass",
      method: "POST",
      data: { email: actor.email, password: actor.password },
      validateStatus: () => true,
    })
    if (reply.status !== 200)
      throw new Error("Owned native News HTTP emailpass login failed")
    const token = object(reply.data).token
    if (typeof token !== "string" || token.length < 20)
      throw new Error("Owned native News login did not return a token")
    const value = { authorization: `Bearer ${token}` }
    tokens.set(actor.id, value)
    return { ...value }
  }
  const request = async (
    method: string,
    url: string,
    data?: unknown,
    actor = actors.first
  ) =>
    api.request({
      method,
      url,
      data,
      headers: await headers(actor),
      validateStatus: () => true,
    })
  const service = container.resolve<NewsService>("news")
  const owned = new Set<string>()
  const entry = async (id: string) => {
    if (!owned.has(id)) throw new Error("News readback must use an owned post")
    return newsEntrySchema.parse(
      serializeNewsEntry(await service.retrieveNewsEntry(id))
    )
  }
  const create = async (input = writeInput()): Promise<NewsEntry> => {
    const response = await request("POST", "/admin/news", {
      ...input,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
    })
    expect(response.status).toBe(201)
    const result = newsMutationSchema.parse(response.data)
    expect(result.replayed).toBe(false)
    owned.add(result.entry.id)
    return result.entry
  }
  const body = (
    post: NewsEntry,
    input = writeInput(),
    actor = actors.first,
    key = randomUUID()
  ): NewsUpdateBody => ({
    ...input,
    expectedActorId: actor.id,
    expectedVersion: post.version,
    idempotencyKey: key,
  })
  const operations = (key: string) =>
    service.listNewsOperations({ idempotency_key: key }, { take: 2 })
  let publicReadKey: string | undefined
  const publicEntry = async (id: string) => {
    const post = await entry(id)
    if (!publicReadKey) {
      const channel = await container
        .resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
        .createSalesChannels({ name: `Owned News Store ${tag}` })
      const { result: keys } = await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [
            {
              type: "publishable",
              title: `Owned News Store ${tag}`,
              created_by: actors.first.id,
            },
          ],
        },
      })
      expect(keys).toHaveLength(1)
      const key = keys[0]!
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: { id: key.id, add: [channel.id] },
      })
      publicReadKey = key.token
    }
    const response = await api.request({
      method: "GET",
      url: `/store/news/${encodeURIComponent(post.slug)}`,
      headers: { "x-publishable-api-key": publicReadKey },
      validateStatus: () => true,
    })
    expect(response.status).toBe(200)
    const result = newsEntrySchema.parse(object(response.data).entry)
    expect(result.id).toBe(id)
    return result
  }
  return {
    origin,
    actors,
    headers,
    request,
    api,
    service,
    entry,
    create,
    body,
    operations,
    publicEntry,
    sanitizeContent: sanitizeRichTextHtml,
  }
}
type Fixture = Awaited<ReturnType<typeof createNativeNewsFixture>>

const assertOperation = async (
  fixture: Fixture,
  entryId: string,
  body: NewsUpdateBody
) => {
  const operations = await fixture.operations(body.idempotencyKey)
  expect(operations).toHaveLength(1)
  const operation = operations[0]
  const { expectedActorId: _actor, ...payload } = newsUpdateSchema.parse(body)
  expect(operation).toMatchObject({
    actor_id: body.expectedActorId,
    aggregate_id: entryId,
    command: "news.entry.update",
    expected_version: body.expectedVersion,
    status: "succeeded",
    request_sha256: hashCatalogCommand({
      aggregateId: entryId,
      command: "news.entry.update",
      expectedVersion: body.expectedVersion,
      payload,
    }),
  })
  return json(operation)
}

export const registerNewsCommandHttpTests = ({
  api,
  getContainer,
}: {
  api: HttpApi
  getContainer: () => MedusaContainer
}) => {
  describe("initialized native News command authority and lost replies", () => {
    let fixture: Fixture
    beforeEach(async () => {
      fixture = await createNativeNewsFixture(getContainer(), api)
    })

    it("uses actual emailpass users and persisted native read/update policies", async () => {
      for (const actor of [fixture.actors.first, fixture.actors.second]) {
        const me = await fixture.request(
          "GET",
          "/admin/users/me",
          undefined,
          actor
        )
        expect(me.status).toBe(200)
        expect(object(object(me.data).user).id).toBe(actor.id)
        const grants = await fixture.request(
          "GET",
          "/admin/rbac/me/permissions",
          undefined,
          actor
        )
        expect(grants.status).toBe(200)
        expect(object(grants.data).permissions).toEqual(
          expect.arrayContaining(["news:read", "news:create", "news:update"])
        )
      }
      const post = await fixture.create()
      const body = fixture.body(post, writeInput(), fixture.actors.reader)
      const before = await fixture.entry(post.id)
      const anonymous = await fixture.api.request({
        method: "PUT",
        url: `/admin/news/${post.id}`,
        data: body,
        validateStatus: () => true,
      })
      expect(anonymous.status).toBe(401)
      expect(
        (
          await fixture.request(
            "GET",
            `/admin/news/${post.id}`,
            undefined,
            fixture.actors.reader
          )
        ).status
      ).toBe(200)
      expect(
        (
          await fixture.request(
            "PUT",
            `/admin/news/${post.id}`,
            body,
            fixture.actors.reader
          )
        ).status
      ).toBe(403)
      expect(await fixture.operations(body.idempotencyKey)).toHaveLength(0)
      expect(await fixture.entry(post.id)).toEqual(before)

      // The entry and pending ledger have already been flushed when the
      // completion response is rejected. Native transaction rollback must
      // remove both, even though real SQL writes occurred before the failure.
      const snapshot = async () => {
        const [rows, count] = await fixture.service.listAndCountNewsEntries(
          {},
          { take: 100, order: { id: "ASC" } }
        )
        expect(count).toBeLessThanOrEqual(100)
        expect(rows).toHaveLength(count)
        return json(rows)
      }
      const persistedBefore = await snapshot()
      const failedKey = randomUUID()
      const nativeComplete = fixture.service.updateNewsOperations.bind(
        fixture.service
      )
      const completion = jest
        .spyOn(fixture.service, "updateNewsOperations")
        .mockImplementationOnce(async (...args) => {
          await nativeComplete(...args)
          return [false] as unknown as Awaited<
            ReturnType<typeof nativeComplete>
          >
        })
      try {
        const failed = await fixture.request("POST", "/admin/news", {
          ...writeInput({ title: `Owned flushed rollback ${failedKey}` }),
          expectedVersion: 0,
          idempotencyKey: failedKey,
        })
        expect(failed.status).toBe(500)
        expect(completion).toHaveBeenCalledTimes(1)
        await expect(completion.mock.results[0]?.value).resolves.toEqual([
          false,
        ])
      } finally {
        completion.mockRestore()
      }
      expect(await snapshot()).toEqual(persistedBefore)
      expect(await fixture.operations(failedKey)).toHaveLength(0)
      expect(await fixture.entry(post.id)).toEqual(before)
    })

    it("rejects first-use actor mismatch and malformed actor before any ledger or post change", async () => {
      const post = await fixture.create()
      const body = fixture.body(post)
      const before = await fixture.entry(post.id)
      expect(
        (
          await fixture.request(
            "PUT",
            `/admin/news/${post.id}`,
            body,
            fixture.actors.second
          )
        ).status
      ).toBe(409)
      expect(
        (
          await fixture.request("PUT", `/admin/news/${post.id}`, {
            ...body,
            expectedActorId: "user_not-a-native-id",
          })
        ).status
      ).toBe(400)
      expect(await fixture.operations(body.idempotencyKey)).toHaveLength(0)
      expect(await fixture.entry(post.id)).toEqual(before)
    })

    it("drops one real committed Publish response and retries the exact durable body and UUID", async () => {
      const post = await fixture.create()
      const transport = await createNewsLostReplyTransport({
        nativeOrigin: fixture.origin,
        entryId: post.id,
        headers: await fixture.headers(),
        dropSuccesses: 1,
      })
      try {
        const input = writeInput({
          title: "  Actual Publish acknowledgement  ",
          content:
            "<p>Actual <strong>body</strong></p><script>discard()</script>",
          status: "published",
          tags: ["Metal", "metal", "Vinyl"],
          excerpt: "  Actual excerpt  ",
        })
        const attempt = await beginNewsCommand(
          { backendOrigin: transport.backendOrigin, entryId: post.id },
          post,
          input,
          "publish",
          randomUUID(),
          {
            storage: storage(),
            locks: navigator.locks,
            client: transport.client,
          }
        )
        expect(attempt.error).toBeUndefined()
        expect(attempt.record.status).toBe("confirmed")
        expect(attempt.record.acknowledgement?.replayed).toBe(true)
        expect(attempt.record.acknowledgement?.entry).toMatchObject({
          title: "Actual Publish acknowledgement",
          status: "published",
          version: 2,
          content: "<p>Actual <strong>body</strong></p>",
          tags: ["Metal", "Vinyl"],
          excerpt: "Actual excerpt",
        })
        expect(attempt.record.body.publishedAt).toBeNull()
        expect(
          Number.isFinite(
            Date.parse(attempt.record.acknowledgement?.entry.publishedAt ?? "")
          )
        ).toBe(true)
        expect(transport.puts).toHaveLength(2)
        expect(transport.puts[0]).toBe(transport.puts[1])
        expect(transport.statuses).toEqual([200, 200])
        expect(transport.snapshot()).toMatchObject({
          dropped: 1,
          failures: [],
          unexpectedRequests: [],
        })
        await assertOperation(fixture, post.id, attempt.record.body)
        expect((await fixture.entry(post.id)).version).toBe(2)
        const { expectedActorId: _actor, ...legacy } = attempt.record.body
        const legacyReplay = await fixture.request(
          "PUT",
          `/admin/news/${post.id}`,
          legacy
        )
        expect(legacyReplay.status).toBe(200)
        expect(newsMutationSchema.parse(legacyReplay.data)).toEqual(
          attempt.record.acknowledgement
        )
      } finally {
        await transport.close()
        expect(transport.snapshot()).toMatchObject({
          closed: true,
          openSockets: 0,
          inFlight: 0,
          failures: [],
          unexpectedRequests: [],
        })
        expect(transport.snapshot().closedSockets).toBe(
          transport.snapshot().openedSockets
        )
      }
    })

    it("restores an uncertain exact command after reload and preserves its historical receipt after another writer", async () => {
      const post = await fixture.create()
      const actorHeaders = await fixture.headers()
      const transport = await createNewsLostReplyTransport({
        nativeOrigin: fixture.origin,
        entryId: post.id,
        headers: actorHeaders,
        dropSuccesses: 2,
      })
      const persistedStorage = storage()
      const boundary = {
        storage: persistedStorage,
        locks: navigator.locks,
        client: transport.client,
      }
      try {
        const context = {
          backendOrigin: transport.backendOrigin,
          entryId: post.id,
        }
        const attempt = await beginNewsCommand(
          context,
          post,
          writeInput({ status: "published" }),
          "publish",
          randomUUID(),
          boundary
        )
        expect(attempt.record.status).toBe("uncertain")
        expect(attempt.error).toBeDefined()
        const savedBytes = persistedStorage.getItem(newsCommandStorageKey)
        expect(savedBytes).not.toBeNull()
        expect(transport.puts).toHaveLength(2)
        const originalLedger = await assertOperation(
          fixture,
          post.id,
          attempt.record.body
        )
        const published = await fixture.entry(post.id)
        const later = fixture.body(
          published,
          writeInput({
            title: "Later independent writer",
            status: "published",
          }),
          fixture.actors.second
        )
        const response = await fixture.request(
          "PUT",
          `/admin/news/${post.id}`,
          later,
          fixture.actors.second
        )
        expect(response.status).toBe(200)
        const current = newsMutationSchema.parse(response.data).entry
        expect(current.version).toBe(3)
        Object.assign(
          actorHeaders,
          await fixture.headers(fixture.actors.second)
        )
        await expect(
          restoreNewsCommand(transport.backendOrigin, boundary)
        ).rejects.toThrow("administrator")
        expect(transport.puts).toHaveLength(2)
        expect(persistedStorage.getItem(newsCommandStorageKey)).toBe(savedBytes)
        Object.assign(actorHeaders, await fixture.headers())
        const restored = await restoreNewsCommand(
          transport.backendOrigin,
          boundary
        )
        expect(restored).toEqual(attempt.record)
        expect(transport.puts).toHaveLength(2)
        const recovered = await retryNewsCommand(
          restored ?? attempt.record,
          transport.backendOrigin,
          boundary
        )
        expect(recovered.record.status).toBe("confirmed")
        expect(recovered.record.body).toEqual(attempt.record.body)
        expect(recovered.record.acknowledgement).toEqual({
          entry: published,
          replayed: true,
        })
        expect(transport.puts).toHaveLength(3)
        expect(new Set(transport.puts).size).toBe(1)
        expect(await fixture.entry(post.id)).toEqual(current)
        expect(
          await assertOperation(fixture, post.id, attempt.record.body)
        ).toEqual(originalLedger)
        expect(
          readSavedNewsCommand(persistedStorage)?.acknowledgement?.entry.version
        ).toBe(2)
      } finally {
        await transport.close()
        expect(transport.snapshot()).toMatchObject({
          closed: true,
          openSockets: 0,
          inFlight: 0,
          dropped: 2,
          failures: [],
          unexpectedRequests: [],
        })
        expect(transport.snapshot().closedSockets).toBe(
          transport.snapshot().openedSockets
        )
      }
    })

    it("cannot confirm another writer's matching draft or scheduled projection and retains initial rejection", async () => {
      for (const status of ["draft", "scheduled"] as const) {
        const post = await fixture.create()
        const input = writeInput({
          status,
          publishedAt:
            status === "scheduled"
              ? new Date(Date.now() + 86_400_000).toISOString()
              : null,
        })
        const other = fixture.body(post, input, fixture.actors.second)
        expect(
          (
            await fixture.request(
              "PUT",
              `/admin/news/${post.id}`,
              other,
              fixture.actors.second
            )
          ).status
        ).toBe(200)
        const current = await fixture.entry(post.id)
        const transport = await createNewsLostReplyTransport({
          nativeOrigin: fixture.origin,
          entryId: post.id,
          headers: await fixture.headers(),
          dropSuccesses: 1,
        })
        try {
          const attempt = await beginNewsCommand(
            { backendOrigin: transport.backendOrigin, entryId: post.id },
            post,
            input,
            status === "draft" ? "draft" : "schedule",
            randomUUID(),
            {
              storage: storage(),
              locks: navigator.locks,
              client: transport.client,
            }
          )
          expect(attempt.record.status).toBe("rejected")
          expect(attempt.record.acknowledgement).toBeNull()
          expect(transport.puts).toHaveLength(1)
          expect(transport.statuses).toEqual([409])
          expect(transport.snapshot().dropped).toBe(0)
          expect(
            await fixture.operations(attempt.record.body.idempotencyKey)
          ).toHaveLength(0)
          expect(await fixture.entry(post.id)).toEqual(current)
        } finally {
          await transport.close()
          expect(transport.snapshot()).toMatchObject({
            closed: true,
            openSockets: 0,
            inFlight: 0,
            failures: [],
            unexpectedRequests: [],
          })
        }
      }
    })

    it("binds the exact replay to native actor body and original version while retaining current state and ledger", async () => {
      const post = await fixture.create()
      const body = fixture.body(post, writeInput({ status: "published" }))
      const first = await fixture.request("PUT", `/admin/news/${post.id}`, body)
      expect(first.status).toBe(200)
      const historical = newsMutationSchema.parse(first.data)
      const ledger = await assertOperation(fixture, post.id, body)
      const archived = await fixture.request(
        "POST",
        `/admin/news/${post.id}/archive`,
        {
          expectedVersion: 2,
          idempotencyKey: randomUUID(),
        },
        fixture.actors.second
      )
      expect(archived.status).toBe(200)
      const current = newsMutationSchema.parse(archived.data).entry
      expect(current).toMatchObject({ version: 3, status: "archived" })
      const replay = await fixture.request(
        "PUT",
        `/admin/news/${post.id}`,
        body
      )
      expect(replay.status).toBe(200)
      expect(newsMutationSchema.parse(replay.data)).toEqual({
        ...historical,
        replayed: true,
      })
      for (const [candidate, actor] of [
        [
          { ...body, expectedActorId: fixture.actors.second.id },
          fixture.actors.second,
        ],
        [{ ...body, title: "Changed command body" }, fixture.actors.first],
        [{ ...body, expectedVersion: 3 }, fixture.actors.first],
      ] as const) {
        expect(
          (
            await fixture.request(
              "PUT",
              `/admin/news/${post.id}`,
              candidate,
              actor
            )
          ).status
        ).toBe(409)
      }
      expect(await fixture.entry(post.id)).toEqual(current)
      expect(await assertOperation(fixture, post.id, body)).toEqual(ledger)
    })
  })
}
