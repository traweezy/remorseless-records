import { createUserAccountWorkflow } from "@medusajs/core-flows"
import type {
  ConfigModule,
  IAuthModuleService,
  IRbacModuleService,
  IStoreModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { randomBytes, randomUUID } from "node:crypto"

export type SettingsHttpResponse = {
  status: number
  data: unknown
  headers: Record<string, unknown>
}

export type SettingsHttpApi = {
  defaults: { baseURL?: string }
  request: (options: {
    url: string
    method: string
    data?: unknown
    headers?: Record<string, string>
    validateStatus: (status: number) => boolean
  }) => Promise<SettingsHttpResponse>
}

export const settingsRecord = (
  value: unknown,
  label = "Native Settings response"
): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}

export const settingsRows = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) throw new TypeError("Native rows must be an array")
  return value.map((row) => settingsRecord(row))
}

export const settingsId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,255}$/u.test(value))
    throw new TypeError("Expected a safe opaque native fixture ID")
  return value
}

export type SettingsActor = {
  id: string
  roleId: string
  authIdentityId: string
  email: string
  password: string
}

type NativeQuery = {
  graph: (options: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: unknown[] }>
}

export const assertNativeSettingsEnvironment = (container: MedusaContainer) => {
  if (process.env.INTEGRATION_TESTS_ENABLED !== "1")
    throw new Error("Settings fixtures require the disposable test runner")
  const config = container.resolve<ConfigModule>(
    ContainerRegistrationKeys.CONFIG_MODULE
  )
  if (
    config.projectConfig.http.jwtSecret !== "disposable_jwt_secret" ||
    config.projectConfig.http.cookieSecret !== "disposable_cookie_secret"
  )
    throw new Error(
      "Settings fixtures require disposable signing configuration"
    )
  const database = new URL(config.projectConfig.databaseUrl ?? "")
  if (
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.pathname !== "/rr_disposable_settings"
  )
    throw new Error("Settings fixture database identity is not owned")
  const flags = container.resolve<{
    isFeatureEnabled: (name: string) => boolean
  }>(ContainerRegistrationKeys.FEATURE_FLAG_ROUTER)
  if (!flags.isFeatureEnabled("rbac"))
    throw new Error("Settings fixtures require actual enabled native RBAC")
}

const resources = [
  "store",
  "user",
  "rbac_role",
  "rbac_policy",
  "region",
  "tax_region",
  "tax_rate",
  "sales_channel",
  "stock_location",
  "price_preference",
  "currency",
  "tax_provider",
  "product",
]

const grantsFor = (mode: "owner" | "reader" | "none" | "user" | "role") => {
  if (mode === "none") return []
  if (mode === "user") return ["user:read", "user:update", "rbac_role:read"]
  if (mode === "role")
    return ["user:read", "rbac_role:read", "rbac_role:update"]
  return [
    "payment:read",
    // The closed native shell performs a real authenticated unread-count GET.
    ...(mode === "owner" ? ["notification:read"] : []),
    ...resources.flatMap((resource) =>
      (mode === "owner" ? ["read", "create", "update", "delete"] : ["read"])
        .filter((operation) => resource !== "product" || operation === "read")
        .map((operation) => `${resource}:${operation}`)
    ),
  ]
}

const createActor = async (
  container: MedusaContainer,
  tag: string,
  mode: "owner" | "reader" | "none" | "user" | "role"
): Promise<SettingsActor> => {
  const email = `settings-${mode}-${tag}@example.invalid`
  const password = randomBytes(24).toString("base64url")
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH)
  const registration = await auth.register("emailpass", {
    body: { email, password },
  })
  if (!registration.success || !registration.authIdentity?.id)
    throw new Error("Native synthetic emailpass registration failed")
  const { result: user } = await createUserAccountWorkflow(container).run({
    input: {
      authIdentityId: registration.authIdentity.id,
      userData: { email, first_name: "Settings", last_name: mode },
    },
  })
  const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)
  const role = await rbac.createRbacRoles({ name: `Settings ${mode} ${tag}` })
  const grantKeys = grantsFor(mode)
  if (new Set(grantKeys).size !== grantKeys.length)
    throw new Error("Native fixture grant keys are duplicated")
  if (grantKeys.length) {
    const expected = new Map(
      grantKeys.map((key) => {
        const [resource, operation, unexpected] = key.split(":")
        if (!resource || !operation || unexpected !== undefined)
          throw new Error("Invalid fixture policy grant")
        return [key, { key, resource, operation }] as const
      })
    )
    // These native module overloads batch only this freshly created actor's
    // unchanged grant set. No JWT or effective-permission cache is introduced.
    const existing = await rbac.listRbacPolicies(
      { key: grantKeys },
      { take: grantKeys.length * 2 }
    )
    const byKey = new Map<string, (typeof existing)[number]>()
    const collectPolicies = (
      policies: typeof existing,
      allowedKeys: Set<string>
    ) => {
      if (!Array.isArray(policies))
        throw new Error("Native fixture policy response is not an array")
      for (const policy of policies) {
        const declaration = expected.get(policy.key)
        if (
          !allowedKeys.has(policy.key) ||
          !declaration ||
          policy.resource !== declaration.resource ||
          policy.operation !== declaration.operation ||
          byKey.has(policy.key)
        )
          throw new Error("Native fixture policy projection is inconsistent")
        settingsId(policy.id)
        byKey.set(policy.key, policy)
      }
    }
    collectPolicies(existing, new Set(grantKeys))
    const missing = grantKeys
      .filter((key) => !byKey.has(key))
      .map((key) => {
        const declaration = expected.get(key)
        if (!declaration)
          throw new Error("Native fixture grant declaration is missing")
        return declaration
      })
    if (missing.length) {
      const created = await rbac.createRbacPolicies(missing)
      if (!Array.isArray(created) || created.length !== missing.length)
        throw new Error(
          "Native fixture policy creation did not acknowledge every key"
        )
      collectPolicies(created, new Set(missing.map(({ key }) => key)))
    }
    if (byKey.size !== grantKeys.length)
      throw new Error("Native fixture policy keys are missing")
    // Keep request order equal to grantsFor; native response order is not an
    // authority boundary. Require the exact set in both ACK and persisted rows.
    const links = grantKeys.map((key) => {
      const policy = byKey.get(key)
      if (!policy) throw new Error("Native fixture grant policy is missing")
      return { role_id: role.id, policy_id: policy.id }
    })
    const expectedPolicyIds = new Set(links.map(({ policy_id }) => policy_id))
    if (expectedPolicyIds.size !== grantKeys.length)
      throw new Error("Native fixture policy IDs are duplicated")
    const assertRolePolicies = (value: unknown) => {
      const policies = settingsRows(value)
      const seen = new Set<string>()
      for (const policy of policies) {
        const policyId = settingsId(policy.policy_id)
        if (
          policy.role_id !== role.id ||
          !expectedPolicyIds.has(policyId) ||
          seen.has(policyId)
        )
          throw new Error("Native fixture role-policy links are inconsistent")
        seen.add(policyId)
      }
      if (
        policies.length !== grantKeys.length ||
        seen.size !== grantKeys.length
      )
        throw new Error("Native fixture role-policy links are missing")
    }
    assertRolePolicies(await rbac.createRbacRolePolicies(links))
    assertRolePolicies(
      await rbac.listRbacRolePolicies(
        { role_id: role.id },
        { select: ["role_id", "policy_id"], take: grantKeys.length + 1 }
      )
    )
  }
  // Persist the actual native link. JWT-only app_metadata role claims do not
  // exercise native delegation or the effective-permission endpoint.
  const link = container.resolve<{
    create: (links: Record<string, unknown>) => Promise<unknown>
  }>(ContainerRegistrationKeys.LINK)
  await link.create({
    [Modules.USER]: { user_id: user.id },
    [Modules.RBAC]: { rbac_role_id: role.id },
  })
  return {
    id: user.id,
    roleId: role.id,
    authIdentityId: registration.authIdentity.id,
    email,
    password,
  }
}

export const createNativeSettingsFixture = async (
  container: MedusaContainer,
  api: SettingsHttpApi
) => {
  assertNativeSettingsEnvironment(container)
  const origin = new URL(api.defaults.baseURL ?? "")
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    !origin.port ||
    Number(origin.port) < 1024 ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password
  )
    throw new Error(
      "Settings fixture requires the initialized loopback HTTP API"
    )
  const tag = randomUUID()
  const query = container.resolve<NativeQuery>(ContainerRegistrationKeys.QUERY)
  const stores = container.resolve<IStoreModuleService>(Modules.STORE)
  const initializedStores = await stores.listStores(
    {},
    { take: 2, relations: ["supported_currencies", "supported_locales"] }
  )
  if (initializedStores.length !== 1)
    throw new Error("Settings requires exactly one native bootstrap Store")
  const initializedStore = initializedStores[0]
  if (!initializedStore)
    throw new Error("Settings native bootstrap Store is absent")
  const currencies = initializedStore.supported_currencies ?? []
  // Native Medusa startup calls createDefaultsWorkflow before the runner
  // snapshots its template. Prove that exact synthetic bootstrap projection
  // before changing its sole Store; creating a second Store would make the
  // Dashboard's native list-first selection exercise the wrong record.
  if (
    initializedStore.name !== "Medusa Store" ||
    initializedStore.metadata != null ||
    initializedStore.default_region_id != null ||
    initializedStore.default_location_id != null ||
    currencies.length !== 1 ||
    currencies[0]?.currency_code !== "eur" ||
    currencies[0]?.is_default !== true ||
    (initializedStore.supported_locales ?? []).length !== 0
  )
    throw new Error("Settings Store differs from the owned native bootstrap")
  const salesChannelId = settingsId(initializedStore.default_sales_channel_id)
  const channels = settingsRows(
    (
      await query.graph({
        entity: "sales_channel",
        fields: ["id", "name", "description", "is_disabled", "metadata"],
        filters: {},
      })
    ).data
  )
  if (
    channels.length !== 1 ||
    channels[0]?.id !== salesChannelId ||
    channels[0]?.name !== "Default Sales Channel" ||
    channels[0]?.description !== "Created by Medusa" ||
    channels[0]?.is_disabled !== false ||
    channels[0]?.metadata != null
  )
    throw new Error("Settings Store has an unowned default Sales Channel")
  const store = await stores.updateStores(initializedStore.id, {
    name: `Owned Settings Store ${tag}`,
    supported_currencies: [{ currency_code: "usd", is_default: true }],
  })
  const actors = {
    owner: await createActor(container, tag, "owner"),
    reader: await createActor(container, tag, "reader"),
    none: await createActor(container, tag, "none"),
    userOnly: await createActor(container, tag, "user"),
    roleOnly: await createActor(container, tag, "role"),
  }
  const rbac = container.resolve<IRbacModuleService>(Modules.RBAC)
  const targetRole = await rbac.createRbacRoles({ name: `Target role ${tag}` })
  const owned = new Set([
    store.id,
    salesChannelId,
    targetRole.id,
    ...Object.values(actors).flatMap((actor) => [actor.id, actor.roleId]),
  ])
  const headers = async (actor = actors.owner) => {
    const login = await api.request({
      url: "/auth/user/emailpass",
      method: "POST",
      data: { email: actor.email, password: actor.password },
      validateStatus: () => true,
    })
    if (login.status !== 200)
      throw new Error("Native fixture emailpass HTTP login failed")
    const token = settingsRecord(login.data).token
    if (typeof token !== "string" || token.length < 20)
      throw new Error("Native fixture HTTP login did not return an actor token")
    return { authorization: `Bearer ${token}` }
  }
  const request = async (
    method: string,
    url: string,
    data?: unknown,
    actor = actors.owner
  ) =>
    api.request({
      method,
      url,
      data,
      headers: await headers(actor),
      validateStatus: () => true,
    })
  const rows = async (entity: string, ids: string[], fields = ["*"]) => {
    if (ids.some((id) => !owned.has(settingsId(id))))
      throw new Error("Native Settings readback must use owned IDs")
    return settingsRows(
      (await query.graph({ entity, fields, filters: { id: ids } })).data
    )
  }
  const ownResponse = (response: SettingsHttpResponse, entity: string) => {
    const row = settingsRecord(settingsRecord(response.data)[entity])
    owned.add(settingsId(row.id))
    return row
  }
  let tableFixturesPrepared = false
  const prepareTableFixtures = async () => {
    if (process.env.RR_NATIVE_SETTINGS_BROWSER !== "1" || tableFixturesPrepared)
      throw new Error(
        "Owned pagination seeds require one explicit browser opt-in"
      )
    assertNativeSettingsEnvironment(container)
    tableFixturesPrepared = true
    const userSearch = `${tag}-table`
    const roleSearch = `Table role ${tag}`
    const regionSearch = `Table region ${tag}`
    const tableUsers: { id: string; email: string }[] = []
    const tableRoles: { id: string; name: string }[] = []
    const tableRegions: { id: string; name: string }[] = []
    const tableTaxRegions: { id: string; countryCode: string }[] = []
    const phaseTimings = { actorsMs: 0, regionsMs: 0, taxRegionsMs: 0 }
    // These owned setup requests retain one genuine native owner login.
    // No owner grants change while this pagination seed batch runs; ordinary
    // fixture reads and browser sessions still use their existing auth paths.
    const seedHeaders = await headers(actors.owner)
    const seedRequest = (method: string, url: string, data?: unknown) =>
      api.request({
        method,
        url,
        data,
        headers: seedHeaders,
        validateStatus: () => true,
      })
    for (const [path, key] of [
      ["/admin/regions?limit=1", "regions"],
      ["/admin/tax-regions?parent_id=null&limit=1", "tax_regions"],
    ] as const) {
      const baseline = await seedRequest("GET", path)
      if (
        baseline.status !== 200 ||
        settingsRecord(baseline.data).count !== 0 ||
        settingsRows(settingsRecord(baseline.data)[key]).length !== 0
      )
        throw new Error(
          "Browser table seeds require an empty owned native configuration"
        )
    }
    // Actual native account workflows and persisted no-grant roles seed the
    // owned fixture. No invite, mail, staging user or authentication mock.
    const tableActorSeeds: Array<
      { actor: SettingsActor; name: string } | undefined
    > = new Array(21)
    let nextActorIndex = 0
    let actorSeedFailed = false
    let actorSeedFailure: unknown
    const seedTableActorWorker = async () => {
      while (!actorSeedFailed && nextActorIndex < tableActorSeeds.length) {
        const index = nextActorIndex++
        const ordinal = String(index).padStart(2, "0")
        try {
          const actor = await createActor(
            container,
            `${userSearch}-${ordinal}`,
            "none"
          )
          owned.add(actor.id)
          owned.add(actor.roleId)
          const name = `${roleSearch} ${ordinal}`
          const renamed = await rbac.updateRbacRoles({ id: actor.roleId, name })
          if (renamed.id !== actor.roleId || renamed.name !== name)
            throw new Error("Owned native table role was not persisted")
          tableActorSeeds[index] = { actor, name }
        } catch (error) {
          if (!actorSeedFailed) {
            actorSeedFailed = true
            actorSeedFailure = error
          }
        }
      }
    }
    // Only these 21 distinct no-grant native account/role workflows overlap.
    // Always join every in-flight workflow before retaining the first failure.
    const actorStarted = performance.now()
    await Promise.all([
      seedTableActorWorker(),
      seedTableActorWorker(),
      seedTableActorWorker(),
    ])
    phaseTimings.actorsMs = performance.now() - actorStarted
    if (actorSeedFailed) throw actorSeedFailure
    // Distinct owned records may be seeded in groups of three. Join the whole
    // group before retaining a failure, and preserve input order. All requests
    // still use native HTTP validation/policies/workflows; exact 21-row HTTP
    // readbacks below remain mandatory before any browser interaction.
    const seedBatches = async <T, U>(
      items: readonly T[],
      seed: (item: T, index: number) => Promise<U>
    ): Promise<U[]> => {
      const results: U[] = []
      for (let offset = 0; offset < items.length; offset += 3) {
        const batch = await Promise.allSettled(
          items
            .slice(offset, offset + 3)
            .map((item, index) => seed(item, offset + index))
        )
        for (const result of batch) {
          if (result.status === "rejected") throw result.reason
          results.push(result.value)
        }
      }
      return results
    }
    const regionStarted = performance.now()
    const seededRegions = await seedBatches(
      tableActorSeeds,
      async (seed, index) => {
        const ordinal = String(index).padStart(2, "0")
        if (!seed) throw new Error("Owned native table actor seed is missing")
        const { actor, name } = seed
        tableUsers.push({ id: actor.id, email: actor.email })
        tableRoles.push({ id: actor.roleId, name })
        const regionResponse = await seedRequest("POST", "/admin/regions", {
          name: `${regionSearch} ${ordinal}`,
          currency_code: "usd",
          countries: [],
          payment_providers: ["pp_system_default"],
          automatic_taxes: false,
          metadata: { ownedTableFixture: tag },
        })
        if (regionResponse.status !== 200)
          throw new Error("Owned native Region seed failed")
        const region = ownResponse(regionResponse, "region")
        return {
          id: settingsId(region.id),
          name: String(region.name),
        }
      }
    )
    tableRegions.push(...seededRegions)
    phaseTimings.regionsMs = performance.now() - regionStarted
    // Real native top-level Tax rows use distinct supported ISO countries.
    // CA/DE remain available to the CRUD cases; no tax calculation is invoked.
    const taxStarted = performance.now()
    const seededTaxRegions = await seedBatches(
      [
        "ar",
        "at",
        "au",
        "be",
        "br",
        "ch",
        "cz",
        "dk",
        "ee",
        "es",
        "fi",
        "fr",
        "gb",
        "gr",
        "ie",
        "in",
        "it",
        "jp",
        "kr",
        "mx",
        "nl",
      ],
      async (countryCode) => {
        const response = await seedRequest("POST", "/admin/tax-regions", {
          country_code: countryCode,
          provider_id: "tp_rate_lookup_rate-lookup",
          metadata: { ownedTableFixture: tag },
        })
        if (response.status !== 200)
          throw new Error("Owned native Tax Region seed failed")
        const row = ownResponse(response, "tax_region")
        if (row.country_code !== countryCode)
          throw new Error("Native Tax country seed differs")
        return { id: settingsId(row.id), countryCode }
      }
    )
    tableTaxRegions.push(...seededTaxRegions)
    phaseTimings.taxRegionsMs = performance.now() - taxStarted
    const collections = [
      {
        path: `/admin/users?q=${encodeURIComponent(userSearch)}&limit=100`,
        key: "users",
        expected: tableUsers,
      },
      {
        path: `/admin/rbac/roles?q=${encodeURIComponent(roleSearch)}&limit=100`,
        key: "roles",
        expected: tableRoles,
      },
      {
        path: `/admin/regions?q=${encodeURIComponent(regionSearch)}&limit=100`,
        key: "regions",
        expected: tableRegions,
      },
      {
        path: "/admin/tax-regions?parent_id=null&limit=100",
        key: "tax_regions",
        expected: tableTaxRegions,
      },
    ]
    for (const { path, key, expected } of collections) {
      const response = await request("GET", path)
      if (response.status !== 200)
        throw new Error("Native table seed readback failed")
      const payload = settingsRecord(response.data)
      const actual = settingsRows(payload[key])
        .map((row) => settingsId(row.id))
        .sort()
      if (
        payload.count !== 21 ||
        JSON.stringify(actual) !==
          JSON.stringify(expected.map((row) => row.id).sort())
      )
        throw new Error(
          "Native HTTP table seed readback did not prove exactly 21 owned rows"
        )
    }
    return {
      userSearch,
      roleSearch,
      regionSearch,
      users: tableUsers,
      roles: tableRoles,
      regions: tableRegions,
      taxRegions: tableTaxRegions,
      phaseTimings,
      setupProvenance:
        "native account/role workflows and authenticated Region/Tax CRUD; native HTTP readback",
    }
  }
  return {
    container,
    api,
    origin: origin.origin,
    tag,
    actors,
    store,
    targetRole,
    rbac,
    owned,
    query,
    headers,
    request,
    rows,
    ownResponse,
    prepareTableFixtures,
  }
}

export type NativeSettingsFixture = Awaited<
  ReturnType<typeof createNativeSettingsFixture>
>
