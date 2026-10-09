import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { enforceNativeVariantBatchParentOwnership } from "./native-variant-parent-guard"

const fixture = (body: unknown, productId = "prod_owned") => {
  const graph = jest.fn(async (input: { filters: { id: string[] } }) => ({
    data: input.filters.id.map((id) => ({ id, product_id: productId })),
  }))
  const resolve = jest.fn((key: string) => {
    if (key !== ContainerRegistrationKeys.QUERY)
      throw new Error("Unexpected parent-guard resolution")
    return { graph }
  })
  const req = {
    params: { id: productId },
    scope: { resolve },
    validatedBody: body,
  } as unknown as MedusaRequest
  const next = jest.fn()
  const run = () =>
    enforceNativeVariantBatchParentOwnership(req, {} as MedusaResponse, next)
  return { graph, next, req, resolve, run }
}

describe("native Variant batch parent ownership", () => {
  it.each([
    { create: [{ title: "New Variant" }] },
    {},
    { update: [], delete: [] },
  ])(
    "keeps create-only/empty native batches free of ownership lookups",
    async (body) => {
      const f = fixture(body)
      await f.run()
      expect(f.resolve).not.toHaveBeenCalled()
      expect(f.next).toHaveBeenCalledTimes(1)
      expect(f.next).toHaveBeenCalledWith()
    }
  )

  it("validates all update identities while retaining native input order and duplicate semantics", async () => {
    const body = {
      create: [{ title: "New Variant" }],
      update: [
        { id: "variant_second", title: "Second" },
        { id: "variant_first", manage_inventory: false },
        { id: "variant_second", title: "Later native update" },
      ],
      delete: [],
    }
    const copy = structuredClone(body)
    const f = fixture(body)
    await f.run()
    expect(f.graph).toHaveBeenCalledWith({
      entity: "variant",
      fields: ["id", "product_id"],
      filters: { id: ["variant_second", "variant_first"] },
      pagination: { take: 3 },
    })
    expect(f.req.validatedBody).toBe(body)
    expect(body).toEqual(copy)
    expect(f.next).toHaveBeenCalledWith()
  })

  it.each([
    {
      rows: [
        { id: "variant_own", product_id: "prod_owned" },
        { id: "variant_other", product_id: "prod_other" },
      ],
    },
    { rows: [{ id: "variant_own", product_id: "prod_owned" }] },
  ])("rejects foreign/missing rows before any delegation", async ({ rows }) => {
    const f = fixture({
      update: [{ id: "variant_own" }, { id: "variant_other" }],
    })
    f.graph.mockResolvedValue({ data: rows })
    await expect(f.run()).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(f.next).not.toHaveBeenCalled()
  })

  it("bounds graph chunks without reducing the native whole-batch size", async () => {
    const f = fixture({
      update: Array.from({ length: 202 }, (_, n) => ({
        id: `variant_${n}`,
        title: String(n),
      })),
    })
    await f.run()
    expect(
      f.graph.mock.calls.map(([input]) => input.filters.id.length)
    ).toEqual([100, 100, 2])
    expect(
      f.graph.mock.calls.every(
        ([input]) =>
          (input as { pagination?: { take: number } }).pagination!.take <= 101
      )
    ).toBe(true)
    expect(f.next).toHaveBeenCalledTimes(1)
  })

  it("does not delegate earlier owned chunks when the last chunk is foreign", async () => {
    const f = fixture({
      update: Array.from({ length: 101 }, (_, n) => ({ id: `variant_${n}` })),
    })
    f.graph.mockImplementation(async (input) => ({
      data: input.filters.id.map((id) => ({
        id,
        product_id: id === "variant_100" ? "prod_other" : "prod_owned",
      })),
    }))
    await expect(f.run()).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(f.graph).toHaveBeenCalledTimes(2)
    expect(f.next).not.toHaveBeenCalled()
  })

  it("retains the existing terminal disabled-delete path without parent reads", async () => {
    const f = fixture({
      update: [{ id: "variant_other", title: "Never written" }],
      delete: ["variant_other"],
    })
    await f.run()
    expect(f.resolve).not.toHaveBeenCalled()
    expect(f.next).toHaveBeenCalledWith()
  })

  it.each([
    undefined,
    [],
    { update: {} },
    { update: [null] },
    { update: [{ id: "" }] },
    { update: [{ id: " variant_01" }] },
    { delete: "variant_01" },
  ])(
    "fails closed when its validated-input precondition is violated",
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
    {
      data: [
        { id: "variant_01", product_id: "prod_owned" },
        { id: "variant_01", product_id: "prod_owned" },
      ],
    },
    { data: [{ id: "variant_unrequested", product_id: "prod_owned" }] },
    {
      data: [
        {
          id: "variant_01",
          product_id: "prod_owned",
          product: { id: "prod_other" },
        },
      ],
    },
    { data: [{ id: "variant_01" }] },
    { data: null },
  ])("rejects malformed or unbound graph results", async (reply) => {
    const f = fixture({ update: [{ id: "variant_01" }] })
    f.graph.mockResolvedValue(reply as never)
    await expect(f.run()).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
    })
    expect(f.next).not.toHaveBeenCalled()
  })

  it("propagates a failed native read without delegation", async () => {
    const f = fixture({ update: [{ id: "variant_01" }] })
    const failure = new Error("Owned native graph unavailable")
    f.graph.mockRejectedValue(failure)
    await expect(f.run()).rejects.toBe(failure)
    expect(f.next).not.toHaveBeenCalled()
  })
})
