import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import { enforceNativeRegionCurrency } from "./native-currency-guard"

const fixture = (body: unknown) => {
  const listCurrencies = jest.fn().mockResolvedValue([{ code: "usd" }])
  const resolve = jest.fn((key: string) => {
    if (key !== Modules.CURRENCY) throw new Error("Unexpected module")
    return { listCurrencies }
  })
  const req = {
    validatedBody: body,
    scope: { resolve },
  } as unknown as MedusaRequest
  const next = jest.fn()
  const run = () => enforceNativeRegionCurrency(req, {} as MedusaResponse, next)
  return { listCurrencies, resolve, req, next, run }
}

describe("native Region currency membership", () => {
  it.each([{}, { name: "Updated name" }, { metadata: { opaque: true } }])(
    "delegates updates without a currency field without querying any module",
    async (body) => {
      const f = fixture(body)
      await f.run()
      expect(f.resolve).not.toHaveBeenCalled()
      expect(f.next).toHaveBeenCalledWith()
      expect(f.req.validatedBody).toBe(body)
    }
  )

  it.each(["usd", "USD", "eur", "EUR"])(
    "checks native catalog membership for %s without changing the delegated body",
    async (code) => {
      const body = {
        name: "Owned Region",
        currency_code: code,
        payment_providers: ["pp_system_default"],
        metadata: { opaque: [1, { retained: true }] },
      }
      const copy = structuredClone(body)
      const f = fixture(body)
      f.listCurrencies.mockResolvedValue([{ code: code.toLowerCase() }])
      await f.run()
      expect(f.resolve).toHaveBeenCalledWith(Modules.CURRENCY)
      expect(f.listCurrencies).toHaveBeenCalledWith(
        { code: [code.toLowerCase()] },
        { select: ["code"], take: 2 }
      )
      expect(f.next).toHaveBeenCalledTimes(1)
      expect(f.next).toHaveBeenCalledWith()
      expect(f.req.validatedBody).toBe(body)
      expect(body).toEqual(copy)
    }
  )

  it.each(["not-a-currency", "zzz", " usd "])(
    "rejects unknown catalog code %j before any native handler delegation",
    async (code) => {
      const f = fixture({ currency_code: code })
      f.listCurrencies.mockResolvedValue([])
      await expect(f.run()).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })
      expect(f.listCurrencies).toHaveBeenCalledWith(
        { code: [code] },
        { select: ["code"], take: 2 }
      )
      expect(f.next).not.toHaveBeenCalled()
    }
  )

  it.each([
    null,
    [],
    undefined,
    { currency_code: null },
    { currency_code: 42 },
    { currency_code: "" },
  ])(
    "fails closed if the native validated-input precondition is violated",
    async (body) => {
      const f = fixture(body)
      await expect(f.run()).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })
      expect(f.resolve).not.toHaveBeenCalled()
      expect(f.next).not.toHaveBeenCalled()
    }
  )

  it.each([
    null,
    {},
    [null],
    [{ code: "eur" }],
    [{ code: 42 }],
    [{ code: "usd" }, { code: "usd" }],
  ])(
    "rejects malformed, mismatched or ambiguous catalog data",
    async (rows) => {
      const f = fixture({ currency_code: "usd" })
      f.listCurrencies.mockResolvedValue(rows)
      await expect(f.run()).rejects.toMatchObject({
        type: MedusaError.Types.UNEXPECTED_STATE,
      })
      expect(f.next).not.toHaveBeenCalled()
    }
  )

  it("preserves lookup failure rather than falling back to bundled currency data", async () => {
    const f = fixture({ currency_code: "usd" })
    const failure = new Error("Owned module unavailable")
    f.listCurrencies.mockRejectedValue(failure)
    await expect(f.run()).rejects.toBe(failure)
    expect(f.next).not.toHaveBeenCalled()
  })
})
