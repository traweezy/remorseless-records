import type { MedusaContainer } from "@medusajs/framework/types"
import {
  createNativeSettingsFixture,
  type NativeSettingsFixture,
  type SettingsHttpApi,
  settingsId,
  settingsRecord,
  settingsRows,
} from "./native-settings-fixture"

const memberIds = async (fixture: NativeSettingsFixture, userId: string) => {
  if (!fixture.owned.has(userId)) throw new Error("User must be fixture-owned")
  const { data } = await fixture.query.graph({
    entity: "user",
    fields: ["id", "rbac_roles.id"],
    filters: { id: userId },
  })
  const user = settingsRows(data)[0]
  return settingsRows(user?.rbac_roles ?? []).map((role) => settingsId(role.id))
}

const createRegion = async (fixture: NativeSettingsFixture) => {
  const response = await fixture.request("POST", "/admin/regions", {
    name: `Settings Region ${fixture.tag}`,
    currency_code: "usd",
    countries: ["ca"],
    payment_providers: ["pp_system_default"],
    automatic_taxes: false,
    metadata: { fixture: fixture.tag, nested: { retained: true } },
  })
  expect(response.status).toBe(200)
  return fixture.ownResponse(response, "region")
}

export const registerNativeSettingsHttpTests = ({
  api,
  getContainer,
}: {
  api: SettingsHttpApi
  getContainer: () => MedusaContainer
}) => {
  describe("initialized native Settings HTTP and persisted RBAC", () => {
    let fixture: NativeSettingsFixture
    beforeEach(async () => {
      fixture = await createNativeSettingsFixture(getContainer(), api)
    })

    it("logs in through native emailpass and resolves persisted actor permissions", async () => {
      const me = await fixture.request("GET", "/admin/users/me")
      expect(me.status).toBe(200)
      expect(settingsRecord(settingsRecord(me.data).user).id).toBe(
        fixture.actors.owner.id
      )
      const permissions = await fixture.request(
        "GET",
        "/admin/rbac/me/permissions"
      )
      expect(permissions.status).toBe(200)
      expect(settingsRecord(permissions.data).permissions).toEqual(
        expect.arrayContaining([
          "store:update",
          "user:update",
          "rbac_role:update",
        ])
      )
      expect(await memberIds(fixture, fixture.actors.owner.id)).toEqual([
        fixture.actors.owner.roleId,
      ])
      const session = await api.request({
        method: "POST",
        url: "/auth/session",
        headers: await fixture.headers(),
        validateStatus: () => true,
      })
      expect(session.status).toBe(200)
      if (!Array.isArray(session.headers["set-cookie"]))
        throw new Error("Native session did not issue a browser session cookie")
      // The cookie value is deliberately not exported or added to receipts.
    })

    it("denies unauthenticated and read-only Store writes without changing rows", async () => {
      const before = await fixture.rows("store", [fixture.store.id])
      const anonymous = await api.request({
        method: "POST",
        url: `/admin/stores/${fixture.store.id}`,
        data: { name: "Anonymous forbidden" },
        validateStatus: () => true,
      })
      expect(anonymous.status).toBe(401)
      const denied = await fixture.request(
        "POST",
        `/admin/stores/${fixture.store.id}`,
        { name: "Reader forbidden" },
        fixture.actors.reader
      )
      expect(denied.status).toBe(403)
      expect(await fixture.rows("store", [fixture.store.id])).toEqual(before)
    })

    it("persists Store name and nested metadata through native update and readback", async () => {
      const update = {
        name: `Edited Store ${fixture.tag}`,
        metadata: { fixture: fixture.tag, nested: { value: "Unicode æ" } },
      }
      const saved = await fixture.request(
        "POST",
        `/admin/stores/${fixture.store.id}`,
        update
      )
      expect(saved.status).toBe(200)
      const rows = await fixture.rows("store", [fixture.store.id])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject(update)
      const read = await fixture.request(
        "GET",
        `/admin/stores/${fixture.store.id}`
      )
      expect(read.status).toBe(200)
      expect(settingsRecord(settingsRecord(read.data).store)).toMatchObject(
        update
      )
    })

    it("adds switches and removes native Store currencies and tax preferences", async () => {
      const path = `/admin/stores/${fixture.store.id}`
      const currencies = [
        { currency_code: "usd", is_default: false, is_tax_inclusive: false },
        { currency_code: "eur", is_default: true, is_tax_inclusive: true },
      ]
      expect(
        (
          await fixture.request("POST", path, {
            supported_currencies: currencies,
          })
        ).status
      ).toBe(200)
      const saved = await fixture.request("GET", path)
      const store = settingsRecord(settingsRecord(saved.data).store)
      expect(settingsRows(store.supported_currencies)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ currency_code: "usd", is_default: false }),
          expect.objectContaining({ currency_code: "eur", is_default: true }),
        ])
      )
      const preferences = await fixture.request(
        "GET",
        "/admin/price-preferences?attribute=currency_code&value=eur"
      )
      expect(preferences.status).toBe(200)
      expect(
        settingsRows(settingsRecord(preferences.data).price_preferences)
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "eur", is_tax_inclusive: true }),
        ])
      )
      expect(
        (
          await fixture.request("POST", path, {
            supported_currencies: [currencies[1]],
          })
        ).status
      ).toBe(200)
      const removed = await fixture.request("GET", path)
      expect(
        settingsRows(
          settingsRecord(settingsRecord(removed.data).store)
            .supported_currencies
        ).map((row) => row.currency_code)
      ).toEqual(["eur"])
    })

    it("keeps same-value Store retry semantic state and does not invent replay acknowledgements", async () => {
      const path = `/admin/stores/${fixture.store.id}`
      const body = {
        name: `Repeat Store ${fixture.tag}`,
        metadata: { value: 2 },
      }
      expect((await fixture.request("POST", path, body)).status).toBe(200)
      const first = await fixture.rows(
        "store",
        [fixture.store.id],
        ["id", "name", "metadata"]
      )
      expect((await fixture.request("POST", path, body)).status).toBe(200)
      expect(
        await fixture.rows(
          "store",
          [fixture.store.id],
          ["id", "name", "metadata"]
        )
      ).toEqual(first)
    })

    it("updates an owned User while retaining native email and auth identity", async () => {
      const target = fixture.actors.reader
      const body = {
        first_name: "Renamed",
        last_name: "Synthetic",
        metadata: { fixture: fixture.tag, nested: { count: 7 } },
      }
      const response = await fixture.request(
        "POST",
        `/admin/users/${target.id}`,
        body
      )
      expect(response.status).toBe(200)
      expect(
        await fixture.rows(
          "user",
          [target.id],
          ["id", "email", "first_name", "last_name", "metadata"]
        )
      ).toEqual([expect.objectContaining({ ...body, email: target.email })])
      const me = await fixture.request(
        "GET",
        "/admin/users/me",
        undefined,
        target
      )
      expect(settingsRecord(settingsRecord(me.data).user).id).toBe(target.id)
    })

    it("requires both grants to assign User roles and preserves membership on denial", async () => {
      const path = `/admin/users/${fixture.actors.reader.id}/roles`
      const before = await memberIds(fixture, fixture.actors.reader.id)
      for (const actor of [fixture.actors.userOnly, fixture.actors.roleOnly]) {
        const denied = await fixture.request(
          "POST",
          path,
          { roles: [fixture.targetRole.id] },
          actor
        )
        expect(denied.status).toBe(403)
        expect(await memberIds(fixture, fixture.actors.reader.id)).toEqual(
          before
        )
      }
      expect(
        (
          await fixture.request("POST", path, {
            roles: [fixture.targetRole.id],
          })
        ).status
      ).toBe(200)
      expect(await memberIds(fixture, fixture.actors.reader.id)).toEqual(
        expect.arrayContaining([fixture.targetRole.id])
      )
      expect(
        (
          await fixture.request("DELETE", path, {
            roles: [fixture.targetRole.id],
          })
        ).status
      ).toBe(200)
      expect(await memberIds(fixture, fixture.actors.reader.id)).toEqual(before)
    })

    it("uses native Role-user assignment and prevents duplicate persisted links", async () => {
      const path = `/admin/rbac/roles/${fixture.targetRole.id}/users`
      const body = { users: [fixture.actors.reader.id] }
      expect((await fixture.request("POST", path, body)).status).toBe(200)
      const replay = await fixture.request("POST", path, body)
      // Native association replay has no catalog idempotency contract. Capture
      // its actual status while requiring precisely one persisted membership.
      expect([200, 400, 409]).toContain(replay.status)
      expect(
        (await memberIds(fixture, fixture.actors.reader.id)).filter(
          (id) => id === fixture.targetRole.id
        )
      ).toHaveLength(1)
      expect((await fixture.request("DELETE", path, body)).status).toBe(200)
      expect(await memberIds(fixture, fixture.actors.reader.id)).not.toContain(
        fixture.targetRole.id
      )
    })

    it("prevents delegating an owned role whose policy the actor does not possess", async () => {
      const productDelete = await fixture.rbac.listRbacPolicies(
        { key: "product:delete" },
        { take: 1 }
      )
      const policy =
        productDelete[0] ??
        (await fixture.rbac.createRbacPolicies({
          key: "product:delete",
          resource: "product",
          operation: "delete",
        }))
      await fixture.rbac.createRbacRolePolicies({
        role_id: fixture.targetRole.id,
        policy_id: policy.id,
      })
      const before = await memberIds(fixture, fixture.actors.reader.id)
      const denied = await fixture.request(
        "POST",
        `/admin/users/${fixture.actors.reader.id}/roles`,
        { roles: [fixture.targetRole.id] }
      )
      expect(denied.status).toBe(403)
      expect(await memberIds(fixture, fixture.actors.reader.id)).toEqual(before)
    })

    it("edits and deletes an ordinary owned Role and reads native persisted state", async () => {
      const path = `/admin/rbac/roles/${fixture.targetRole.id}`
      const body = {
        name: `Updated owned role ${fixture.tag}`,
        description: "Disposable",
        metadata: { nested: { value: true } },
      }
      expect((await fixture.request("POST", path, body)).status).toBe(200)
      expect(await fixture.rows("rbac_role", [fixture.targetRole.id])).toEqual([
        expect.objectContaining(body),
      ])
      expect((await fixture.request("DELETE", path)).status).toBe(200)
      expect((await fixture.request("GET", path)).status).toBe(404)
      expect(await fixture.rows("rbac_role", [fixture.targetRole.id])).toEqual(
        []
      )
    })

    it("does not permit a no-grant actor to create a Role without policy IDs", async () => {
      const name = `Forbidden empty role ${fixture.tag}`
      const response = await fixture.request(
        "POST",
        "/admin/rbac/roles",
        { name },
        fixture.actors.none
      )
      // This is a security assertion, not a preclaimed source-derived PASS.
      // The installed collection route currently omits its create policy.
      expect(response.status).toBe(403)
      expect(await fixture.rbac.listRbacRoles({ name })).toEqual([])
    })

    it("denies self deletion and removes another owned synthetic User", async () => {
      const self = await fixture.request(
        "DELETE",
        `/admin/users/${fixture.actors.owner.id}`
      )
      expect(self.status).toBe(400)
      expect(
        await fixture.rows("user", [fixture.actors.owner.id], ["id"])
      ).toHaveLength(1)
      const removed = await fixture.request(
        "DELETE",
        `/admin/users/${fixture.actors.reader.id}`
      )
      expect(removed.status).toBe(200)
      expect(
        await fixture.rows("user", [fixture.actors.reader.id], ["id"])
      ).toEqual([])
    })

    it("creates edits and deletes an isolated API-only Policy without rewriting registered policies", async () => {
      const body = {
        key: `settings-fixture:${fixture.tag}`,
        resource: "settings_fixture",
        operation: "read",
        name: "Owned unused policy",
        metadata: { fixture: fixture.tag },
      }
      const created = await fixture.request(
        "POST",
        "/admin/rbac/policies",
        body
      )
      expect(created.status).toBe(200)
      const row = fixture.ownResponse(created, "policy")
      const path = `/admin/rbac/policies/${settingsId(row.id)}`
      const denied = await fixture.request(
        "POST",
        path,
        { name: "Forbidden" },
        fixture.actors.reader
      )
      expect(denied.status).toBe(403)
      expect(await fixture.rows("rbac_policy", [settingsId(row.id)])).toEqual([
        expect.objectContaining(body),
      ])
      expect(
        (await fixture.request("POST", path, { name: "Edited unused policy" }))
          .status
      ).toBe(200)
      expect(
        await fixture.rows("rbac_policy", [settingsId(row.id)], ["id", "name"])
      ).toEqual([expect.objectContaining({ name: "Edited unused policy" })])
      expect((await fixture.request("DELETE", path)).status).toBe(200)
      expect(await fixture.rows("rbac_policy", [settingsId(row.id)])).toEqual(
        []
      )
    })

    it("creates updates and deletes a native Region with an actual manual provider", async () => {
      const providers = await fixture.request(
        "GET",
        "/admin/payments/payment-providers"
      )
      expect(providers.status).toBe(200)
      expect(
        settingsRows(settingsRecord(providers.data).payment_providers).map(
          (provider) => provider.id
        )
      ).toContain("pp_system_default")
      const region = await createRegion(fixture)
      const path = `/admin/regions/${settingsId(region.id)}`
      const body = {
        name: `Edited Region ${fixture.tag}`,
        currency_code: "eur",
        countries: ["de"],
        automatic_taxes: false,
        metadata: { fixture: fixture.tag, retained: [1, 2] },
      }
      expect((await fixture.request("POST", path, body)).status).toBe(200)
      expect(
        await fixture.rows(
          "region",
          [settingsId(region.id)],
          ["id", "name", "currency_code", "automatic_taxes", "metadata"]
        )
      ).toEqual([
        expect.objectContaining({
          name: body.name,
          currency_code: "eur",
          automatic_taxes: false,
          metadata: { ...body.metadata, nested: { retained: true } },
        }),
      ])
      const read = await fixture.request("GET", path)
      expect(read.status).toBe(200)
      expect(settingsRecord(settingsRecord(read.data).region).metadata).toEqual(
        {
          ...body.metadata,
          nested: { retained: true },
        }
      )
      expect(
        settingsRows(
          settingsRecord(settingsRecord(read.data).region).countries
        ).map((country) => country.iso_2)
      ).toEqual(["de"])
      expect((await fixture.request("DELETE", path)).status).toBe(200)
      expect(await fixture.rows("region", [settingsId(region.id)])).toEqual([])
    })

    it("preserves Region state after permission or invalid currency denial", async () => {
      const region = await createRegion(fixture)
      const id = settingsId(region.id)
      const before = await fixture.rows("region", [id])
      expect(
        (
          await fixture.request(
            "POST",
            `/admin/regions/${id}`,
            { name: "Forbidden" },
            fixture.actors.reader
          )
        ).status
      ).toBe(403)
      const invalid = await fixture.request("POST", `/admin/regions/${id}`, {
        currency_code: "not-a-currency",
      })
      expect(invalid.status).toBe(400)
      expect(await fixture.rows("region", [id])).toEqual(before)
      const malformed = await fixture.request("POST", `/admin/regions/${id}`, {
        currency_code: 42,
      })
      expect(malformed.status).toBe(400)
      expect(await fixture.rows("region", [id])).toEqual(before)
      const collectionBefore = await fixture.request(
        "GET",
        "/admin/regions?limit=100"
      )
      expect(collectionBefore.status).toBe(200)
      const beforeIds = settingsRows(
        settingsRecord(collectionBefore.data).regions
      )
        .map((row) => settingsId(row.id))
        .sort()
      for (const currency_code of ["not-a-currency", 42]) {
        const deniedCreate = await fixture.request("POST", "/admin/regions", {
          name: `Rejected currency ${fixture.tag}`,
          currency_code,
          countries: [],
          payment_providers: ["pp_system_default"],
          automatic_taxes: false,
          metadata: { fixture: fixture.tag },
        })
        expect(deniedCreate.status).toBe(400)
        const collectionAfter = await fixture.request(
          "GET",
          "/admin/regions?limit=100"
        )
        expect(collectionAfter.status).toBe(200)
        expect(
          settingsRows(settingsRecord(collectionAfter.data).regions)
            .map((row) => settingsId(row.id))
            .sort()
        ).toEqual(beforeIds)
        expect(settingsRecord(collectionAfter.data).count).toBe(
          settingsRecord(collectionBefore.data).count
        )
      }
      expect(
        (
          await fixture.request("POST", `/admin/regions/${id}`, {
            currency_code: "eur",
          })
        ).status
      ).toBe(200)
      expect(
        await fixture.rows("region", [id], ["id", "currency_code"])
      ).toEqual([expect.objectContaining({ id, currency_code: "eur" })])
      expect(
        (
          await fixture.request("POST", `/admin/regions/${id}`, {
            name: `Currency omitted ${fixture.tag}`,
          })
        ).status
      ).toBe(200)
      expect(
        await fixture.rows("region", [id], ["id", "name", "currency_code"])
      ).toEqual([
        expect.objectContaining({
          id,
          name: `Currency omitted ${fixture.tag}`,
          currency_code: "eur",
        }),
      ])
    })

    it("creates country and province Tax Regions and rates without tax calculation", async () => {
      const providers = await fixture.request("GET", "/admin/tax-providers")
      expect(providers.status).toBe(200)
      const registered = settingsRows(
        settingsRecord(providers.data).tax_providers
      )
      const expected = registered.filter(
        (provider) => provider.id === "tp_rate_lookup_rate-lookup"
      )
      expect(expected).toHaveLength(1)
      const provider = expected[0]
      if (!provider) throw new Error("Native owned Tax provider is missing")
      const created = await fixture.request("POST", "/admin/tax-regions", {
        country_code: "ca",
        provider_id: provider.id,
        default_tax_rate: {
          rate: 5,
          code: `OWNED-${fixture.tag}`,
          name: "Owned country rate",
        },
        metadata: { fixture: fixture.tag },
      })
      expect(created.status).toBe(200)
      const country = fixture.ownResponse(created, "tax_region")
      const provinceResponse = await fixture.request(
        "POST",
        "/admin/tax-regions",
        {
          country_code: "ca",
          province_code: "on",
          parent_id: country.id,
          metadata: { fixture: fixture.tag },
        }
      )
      expect(provinceResponse.status).toBe(200)
      const province = fixture.ownResponse(provinceResponse, "tax_region")
      const rateResponse = await fixture.request("POST", "/admin/tax-rates", {
        tax_region_id: province.id,
        rate: 8,
        code: `OWNED-P-${fixture.tag}`,
        name: "Owned provincial rate",
        is_default: true,
      })
      expect(rateResponse.status).toBe(200)
      const rate = fixture.ownResponse(rateResponse, "tax_rate")
      expect(
        await fixture.rows(
          "tax_region",
          [settingsId(province.id)],
          ["id", "country_code", "province_code", "parent_id"]
        )
      ).toEqual([
        expect.objectContaining({
          country_code: "ca",
          province_code: "on",
          parent_id: country.id,
        }),
      ])
      expect(
        (
          await fixture.request(
            "POST",
            `/admin/tax-rates/${settingsId(rate.id)}`,
            { rate: 9, metadata: { edited: true } }
          )
        ).status
      ).toBe(200)
      expect(
        await fixture.rows(
          "tax_rate",
          [settingsId(rate.id)],
          ["id", "rate", "metadata"]
        )
      ).toEqual([
        expect.objectContaining({ rate: 9, metadata: { edited: true } }),
      ])
      expect(
        (
          await fixture.request(
            "DELETE",
            `/admin/tax-rates/${settingsId(rate.id)}`
          )
        ).status
      ).toBe(200)
      expect(
        (
          await fixture.request(
            "DELETE",
            `/admin/tax-regions/${settingsId(province.id)}`
          )
        ).status
      ).toBe(200)
      expect(
        (
          await fixture.request(
            "DELETE",
            `/admin/tax-regions/${settingsId(country.id)}`
          )
        ).status
      ).toBe(200)
      expect(
        await fixture.rows("tax_region", [
          settingsId(country.id),
          settingsId(province.id),
        ])
      ).toEqual([])
    })

    it("denies restricted Tax creation and malformed missing provider without rows", async () => {
      const before = await fixture.query.graph({
        entity: "tax_region",
        fields: ["id"],
        filters: { country_code: "ca" },
      })
      expect(
        (
          await fixture.request(
            "POST",
            "/admin/tax-regions",
            { country_code: "ca", provider_id: "tp_rate_lookup_rate-lookup" },
            fixture.actors.reader
          )
        ).status
      ).toBe(403)
      expect(
        (
          await fixture.request("POST", "/admin/tax-regions", {
            country_code: "ca",
          })
        ).status
      ).toBe(400)
      expect(
        await fixture.query.graph({
          entity: "tax_region",
          fields: ["id"],
          filters: { country_code: "ca" },
        })
      ).toEqual(before)
    })
  })
}
