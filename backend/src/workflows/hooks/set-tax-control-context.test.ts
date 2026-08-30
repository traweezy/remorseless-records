import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  updateOrderTaxLinesWorkflow,
  updateTaxLinesWorkflow,
  upsertTaxLinesWorkflow,
} from "@medusajs/core-flows"

import { readRequiredRecord } from "../../lib/provider-boundary/records"
import { TAX_CONTEXT_KEY } from "../../lib/tax-control/context"

jest.mock("@medusajs/core-flows", () => ({
  updateOrderTaxLinesWorkflow: {
    hooks: { setTaxLineContext: jest.fn() },
  },
  updateTaxLinesWorkflow: {
    hooks: { setTaxLineContext: jest.fn() },
  },
  upsertTaxLinesWorkflow: {
    hooks: { setTaxLineContext: jest.fn() },
  },
}))

import "./set-tax-control-context"

const mockUpdateCartContext = updateTaxLinesWorkflow.hooks
  .setTaxLineContext as unknown as jest.Mock
const mockUpsertCartContext = upsertTaxLinesWorkflow.hooks
  .setTaxLineContext as unknown as jest.Mock
const mockUpdateOrderContext = updateOrderTaxLinesWorkflow.hooks
  .setTaxLineContext as unknown as jest.Mock

type HookResponse = {
  toJSON: () => { output: unknown }
}

type CartContextHook = (
  input: { cart: unknown },
  context: { container: MedusaContainer }
) => Promise<HookResponse>

const registeredCartHook = (): CartContextHook => {
  const callback: unknown = mockUpdateCartContext.mock.calls[0]?.[0]
  if (typeof callback !== "function") {
    throw new Error("The tax-line cart hook was not registered.")
  }
  return callback as CartContextHook
}

const containerFixture = ({
  cart,
  graphResult,
}: {
  cart: Record<string, unknown>
  graphResult?: unknown
}): MedusaContainer => {
  const graph = jest.fn(async (input: { fields: string[] }) => {
    if (graphResult !== undefined) {
      return graphResult
    }
    return input.fields.includes("currency_code")
      ? { data: [cart] }
      : { data: [{}] }
  })
  const dependencies = new Map<unknown, unknown>([
    [ContainerRegistrationKeys.QUERY, { graph }],
    [
      "tax_control",
      {
        ensureTaxProviderControl: jest.fn(async () => ({
          active_provider: "taxrate_io",
          collection_mode: "collect",
          generation: 2,
        })),
      },
    ],
    [
      "catalog",
      {
        listCatalogProductProfiles: jest.fn(async () => []),
      },
    ],
  ])
  return {
    resolve: (name: unknown) => dependencies.get(name),
  } as unknown as MedusaContainer
}

describe("tax-control workflow context boundary", () => {
  it("registers cart, upsert, and order workflow hooks", () => {
    expect(mockUpdateCartContext).toHaveBeenCalledTimes(1)
    expect(mockUpsertCartContext).toHaveBeenCalledTimes(1)
    expect(mockUpdateOrderContext).toHaveBeenCalledTimes(1)
  })

  it("rejects a malformed workflow cart before resolving dependencies", async () => {
    await expect(
      registeredCartHook()(
        { cart: false },
        { container: {} as MedusaContainer }
      )
    ).rejects.toThrow(
      "Tax line workflow cart returned malformed structured data."
    )
  })

  it("rejects a malformed Query Graph envelope", async () => {
    const cart = { id: "cart_01" }
    await expect(
      registeredCartHook()(
        { cart },
        {
          container: containerFixture({
            cart,
            graphResult: { data: [false] },
          }),
        }
      )
    ).rejects.toThrow(
      "Tax cart enrichment query returned malformed structured data."
    )
  })

  it.each([
    ["missing", { data: [] }],
    ["ambiguous", { data: [{ id: "cart_01" }, { id: "cart_01" }] }],
  ])("rejects a %s Query Graph row", async (_label, graphResult) => {
    const cart = { id: "cart_01" }
    await expect(
      registeredCartHook()(
        { cart },
        { container: containerFixture({ cart, graphResult }) }
      )
    ).rejects.toThrow(
      "Tax cart enrichment query returned an unexpected record count."
    )
  })

  it("rejects coercive item amounts instead of treating booleans as money", async () => {
    const cart = {
      currency_code: "usd",
      id: "cart_01",
      items: [
        {
          adjustments: [],
          id: "item_01",
          quantity: 1,
          tax_lines: [],
          unit_price: true,
        },
      ],
      shipping_methods: [],
    }
    await expect(
      registeredCartHook()({ cart }, { container: containerFixture({ cart }) })
    ).rejects.toThrow("Tax calculation received an invalid amount.")
  })

  it.each([
    [
      "duplicate item",
      {
        items: [
          {
            adjustments: [],
            id: "item_duplicate",
            quantity: 1,
            tax_lines: [],
            unit_price: 10,
          },
          {
            adjustments: [],
            id: "item_duplicate",
            quantity: 1,
            tax_lines: [],
            unit_price: 10,
          },
        ],
        shipping_methods: [],
      },
      "Tax calculation received an invalid item identity.",
    ],
    [
      "missing shipping",
      {
        items: [],
        shipping_methods: [{ adjustments: [], amount: 5, tax_lines: [] }],
      },
      "Tax calculation received an invalid shipping identity.",
    ],
  ])("rejects a %s identity", async (_label, relationships, message) => {
    const cart = {
      currency_code: "usd",
      id: "cart_01",
      ...relationships,
    }
    await expect(
      registeredCartHook()({ cart }, { container: containerFixture({ cart }) })
    ).rejects.toThrow(message)
  })

  it("builds bounded minor-unit amounts from explicit numeric strings", async () => {
    const cart = {
      currency_code: "usd",
      id: "cart_01",
      items: [
        {
          adjustments: [{ amount: "1", is_tax_inclusive: false }],
          id: "item_01",
          quantity: "2",
          tax_lines: [{ rate: "8.75" }],
          unit_price: "10",
        },
      ],
      shipping_methods: [
        {
          adjustments: [],
          amount: "5",
          id: "shipping_01",
          tax_lines: [],
        },
      ],
    }
    const response = await registeredCartHook()(
      { cart },
      { container: containerFixture({ cart }) }
    )
    const output = readRequiredRecord(
      response.toJSON().output,
      "Tax hook test output"
    )
    const context = readRequiredRecord(
      output[TAX_CONTEXT_KEY],
      "Tax hook test context"
    )

    expect(context).toMatchObject({
      collectionMode: "collect",
      generation: 2,
      itemAmountsMinor: { item_01: 1_900 },
      provider: "taxrate_io",
      shippingAmountMinor: 500,
      subjectId: "cart_01",
    })
  })
})
