import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import {
  resolveStripeTaxReadiness,
  resolveTaxRateIoReadiness,
} from "../../../../lib/tax-control/readiness"
import { syncTaxRateIoQuota } from "../../../../lib/tax-control/quota"
import { taxControlSnapshot } from "../utils"
import {
  TAX_CONTROL_ACKNOWLEDGEMENT_VERSION,
  TAX_DISABLED_ACKNOWLEDGEMENT,
} from "../../../../modules/tax-control/constants"

import { POST } from "./route"

jest.mock("../../../../lib/tax-control/readiness", () => ({
  resolveStripeTaxReadiness: jest.fn(),
  resolveTaxRateIoReadiness: jest.fn(),
}))
jest.mock("../../../../lib/tax-control/quota", () => ({
  syncTaxRateIoQuota: jest.fn(),
}))
jest.mock("../utils", () => ({
  taxControlSnapshot: jest.fn(),
}))

const stripeReadinessMock = resolveStripeTaxReadiness as jest.MockedFunction<
  typeof resolveStripeTaxReadiness
>
const taxRateReadinessMock = resolveTaxRateIoReadiness as jest.MockedFunction<
  typeof resolveTaxRateIoReadiness
>
const syncQuotaMock = syncTaxRateIoQuota as jest.MockedFunction<
  typeof syncTaxRateIoQuota
>
const snapshotMock = taxControlSnapshot as jest.MockedFunction<
  typeof taxControlSnapshot
>

const validBody = {
  expectedGeneration: 3,
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  reason: "Sandbox Stripe Tax checks passed.",
  targetCollectionMode: "collect",
  targetProvider: "stripe_tax",
} as const

type ResponseState = {
  body: unknown
  headers: Record<string, string>
  status: number
}

const responseFixture = (): {
  res: MedusaResponse
  state: ResponseState
} => {
  const state: ResponseState = { body: null, headers: {}, status: 200 }
  const response = {} as MedusaResponse
  response.setHeader = jest.fn((name: string, value: string) => {
    state.headers[name.toLowerCase()] = value
    return response
  }) as MedusaResponse["setHeader"]
  response.status = jest.fn((status: number) => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.json = jest.fn((body: unknown) => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  return { res: response, state }
}

const requestFixture = ({
  actorId = "user_admin",
  body = validBody,
}: {
  actorId?: string | null
  body?: unknown
} = {}) => {
  const service = { transitionTaxControl: jest.fn(async () => undefined) }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const locking = {
    execute: jest.fn(async (_key: string, operation: () => Promise<unknown>) =>
      operation()
    ),
  }
  const resolve = jest.fn((key: string) => {
    if (key === "tax_control") {
      return service
    }
    if (key === Modules.LOCKING) {
      return locking
    }
    if (key === "logger") {
      return logger
    }
    throw new Error(`Unexpected dependency: ${key}`)
  })
  const req = {
    auth_context: actorId ? { actor_id: actorId } : undefined,
    body,
    scope: { resolve },
  } as unknown as AuthenticatedMedusaRequest

  return { locking, logger, req, resolve, service }
}

const ready = {
  checks: [],
  configured: true,
  message: "Ready.",
  ready: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  stripeReadinessMock.mockResolvedValue({
    ...ready,
    accountMode: "sandbox",
    activeRegistrationCount: 1,
    missingFields: [],
  })
  taxRateReadinessMock.mockReturnValue(ready)
  syncQuotaMock.mockResolvedValue(null)
  snapshotMock.mockResolvedValue({ ok: true } as never)
})

describe("POST /admin/tax-control/switch", () => {
  it("validates the request before resolving switch dependencies", async () => {
    const fixture = requestFixture({
      body: { ...validBody, reason: "short" },
    })
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "Provide a collection choice"
    )
    expect(fixture.resolve).not.toHaveBeenCalled()
  })

  it("requires an authenticated Admin actor", async () => {
    const fixture = requestFixture({ actorId: null })
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "authenticated admin user"
    )
    expect(fixture.resolve).not.toHaveBeenCalled()
  })

  it("checks readiness and transitions under the distributed lock", async () => {
    const fixture = requestFixture()
    const { res, state } = responseFixture()

    await POST(fixture.req, res)

    expect(fixture.locking.execute).toHaveBeenCalledTimes(1)
    expect(stripeReadinessMock).toHaveBeenCalledWith({
      logger: fixture.logger,
    })
    expect(fixture.service.transitionTaxControl).toHaveBeenCalledWith({
      acknowledgementVersion: TAX_CONTROL_ACKNOWLEDGEMENT_VERSION,
      actorId: "user_admin",
      ...validBody,
    })
    expect(state).toEqual({
      body: { ok: true },
      headers: { "cache-control": "no-store" },
      status: 200,
    })
  })

  it("refuses a provider that fails its current readiness checks", async () => {
    stripeReadinessMock.mockResolvedValue({
      ...ready,
      accountMode: "sandbox",
      activeRegistrationCount: 0,
      missingFields: ["registration"],
      message: "A registration is required.",
      ready: false,
    })
    const fixture = requestFixture()
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "stripe_tax is not available"
    )
    expect(fixture.service.transitionTaxControl).not.toHaveBeenCalled()
    expect(snapshotMock).not.toHaveBeenCalled()
  })

  it("refuses an unconfigured provider even if a malformed probe claims ready", async () => {
    stripeReadinessMock.mockResolvedValue({
      ...ready,
      accountMode: "unknown",
      activeRegistrationCount: 0,
      configured: false,
      missingFields: [],
      message: "Stripe is not configured.",
    })
    const fixture = requestFixture()
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "stripe_tax is not available"
    )
    expect(fixture.service.transitionTaxControl).not.toHaveBeenCalled()
  })

  it("refreshes TaxRate.io quota before evaluating that provider", async () => {
    syncQuotaMock.mockResolvedValue({
      observedAt: "2026-08-30T16:00:00.000Z",
      quota: 100,
      remaining: 18,
      source: "manual_refresh",
      usage: 82,
      usagePercent: 82,
    })
    const fixture = requestFixture({
      body: { ...validBody, targetProvider: "taxrate_io" },
    })
    const { res } = responseFixture()

    await POST(fixture.req, res)

    expect(syncQuotaMock).toHaveBeenCalledWith({
      logger: fixture.logger,
      service: fixture.service,
    })
    expect(taxRateReadinessMock).toHaveBeenCalledWith(18)
  })

  it("disables collection without probing either external tax provider", async () => {
    const fixture = requestFixture({
      body: {
        acknowledgement: TAX_DISABLED_ACKNOWLEDGEMENT,
        expectedGeneration: 3,
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
        reason: "The owner approved a temporary collection pause.",
        targetCollectionMode: "disabled",
        targetProvider: "stripe_tax",
      },
    })
    const { res } = responseFixture()

    await POST(fixture.req, res)

    expect(syncQuotaMock).not.toHaveBeenCalled()
    expect(taxRateReadinessMock).not.toHaveBeenCalled()
    expect(stripeReadinessMock).not.toHaveBeenCalled()
    expect(fixture.service.transitionTaxControl).toHaveBeenCalledWith({
      acknowledgementVersion: TAX_CONTROL_ACKNOWLEDGEMENT_VERSION,
      actorId: "user_admin",
      expectedGeneration: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
      reason: "The owner approved a temporary collection pause.",
      targetCollectionMode: "disabled",
      targetProvider: "stripe_tax",
    })
  })

  it("requires the exact versioned acknowledgement before disabling tax", async () => {
    const fixture = requestFixture({
      body: {
        acknowledgement: "I understand.",
        expectedGeneration: 3,
        idempotencyKey: "00000000-0000-4000-8000-000000000003",
        reason: "The owner approved a temporary collection pause.",
        targetCollectionMode: "disabled",
        targetProvider: "stripe_tax",
      },
    })
    const { res } = responseFixture()

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "exact acknowledgement"
    )
    expect(fixture.resolve).not.toHaveBeenCalled()
  })
})
