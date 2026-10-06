import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  updateOrderTaxLinesWorkflow,
  updateTaxLinesWorkflow,
  upsertTaxLinesWorkflow,
} from "@medusajs/core-flows"

import { readRequiredRecord } from "../../lib/provider-boundary/records"
import {
  buildTaxLineCode,
  TAX_CONTEXT_KEY,
} from "../../lib/tax-control/context"

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

type OrderContextHook = (
  input: { order: unknown; items?: unknown; shipping_methods?: unknown },
  context: { container: MedusaContainer }
) => Promise<HookResponse>

const registeredOrderHook = (): OrderContextHook => {
  const callback: unknown = mockUpdateOrderContext.mock.calls[0]?.[0]
  if (typeof callback !== "function") {
    throw new Error("The tax-line order hook was not registered.")
  }
  return callback as OrderContextHook
}

const hookContext = (response: HookResponse) => {
  const output = readRequiredRecord(response.toJSON().output, "Tax hook output")
  return readRequiredRecord(output[TAX_CONTEXT_KEY], "Tax hook context")
}

const orderFixture = (provider: "taxrate_io" | "stripe_tax" | null = null) => ({
  id: "order_01",
  currency_code: "usd",
  items: [
    {
      id: "ordli_original",
      quantity: 2,
      unit_price: 2.34,
      tax_lines: [
        {
          code: buildTaxLineCode({
            collectionMode: provider ? "collect" : "disabled",
            provider,
            generation: 1,
            ...(provider === "stripe_tax"
              ? { calculationId: "taxcalc_owned" }
              : {}),
          }),
          rate: provider ? 6.35 : 0,
        },
      ],
    },
  ],
  shipping_methods: [],
})

const containerFixture = ({
  cart,
  graphResult,
}: {
  cart: Record<string, unknown>
  graphResult?: unknown
}): MedusaContainer => {
  const graph = jest.fn(async (input: { entity: string; fields: string[] }) => {
    if (graphResult !== undefined) {
      return graphResult
    }
    return input.entity === "order" || input.fields.includes("currency_code")
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

  it.each([null, "taxrate_io", "stripe_tax"] as const)(
    "uses a unit basis for native partial order lines under %s",
    async (provider) => {
      const order = orderFixture(provider)
      // Medusa queries unattached order_line_item rows before ITEM_ADD exists.
      // Quantity belongs to the order-item link, not this native row.
      const items = [
        { ...order.items[0], id: "ordli_replacement", quantity: undefined },
      ]
      const original = structuredClone(items)
      const context = hookContext(
        await registeredOrderHook()(
          { order, items },
          { container: containerFixture({ cart: order }) }
        )
      )
      expect(context).toMatchObject({
        collectionMode: provider ? "collect" : "disabled",
        provider,
        generation: 1,
        itemAmountsMinor: { ordli_replacement: 234 },
        shippingAmountMinor: 0,
        frozenQuote: { generation: 1, provider },
        ...(provider === "stripe_tax"
          ? {
              preservedItemRates: { ordli_replacement: 6.35 },
            }
          : {}),
      })
      expect(items).toEqual(original)
    }
  )

  it("keeps an explicit partial line quantity and adjusted amount", async () => {
    const order = orderFixture()
    const items = [
      {
        id: "ordli_replacement",
        quantity: "3",
        unit_price: "2.34",
        adjustments: [{ amount: "1" }],
      },
    ]
    expect(
      hookContext(
        await registeredOrderHook()(
          { order, items },
          { container: containerFixture({ cart: order }) }
        )
      )
    ).toMatchObject({ itemAmountsMinor: { ordli_replacement: 602 } })
  })

  it.each([0, null, false, -1, 1.5, "no", Number.MAX_SAFE_INTEGER + 1])(
    "rejects an explicit invalid partial quantity %p",
    async (quantity) => {
      const order = orderFixture()
      await expect(
        registeredOrderHook()(
          {
            order,
            items: [{ id: "ordli_invalid", quantity, unit_price: 2.34 }],
          },
          { container: containerFixture({ cart: order }) }
        )
      ).rejects.toThrow("Tax subject fingerprint data is invalid.")
    }
  )

  it("still rejects missing quantity in a full order refresh", async () => {
    const order = {
      ...orderFixture(),
      items: [{ id: "ordli_missing", unit_price: 2.34 }],
    }
    await expect(
      registeredOrderHook()(
        { order },
        { container: containerFixture({ cart: order }) }
      )
    ).rejects.toThrow("Tax subject fingerprint data is invalid.")
  })

  it("still rejects missing quantity in checkout", async () => {
    const cart = {
      ...orderFixture(),
      id: "cart_01",
      items: [{ id: "item_missing", unit_price: 2.34 }],
    }
    await expect(
      registeredCartHook()({ cart }, { container: containerFixture({ cart }) })
    ).rejects.toThrow("Tax subject fingerprint data is invalid.")
  })

  it("keeps the Stripe Tax hold on new taxable order items", async () => {
    const order = orderFixture("stripe_tax")
    await expect(
      registeredOrderHook()(
        {
          order: { id: order.id, currency_code: order.currency_code },
          items: [{ id: "ordli_new", unit_price: 2.34 }],
        },
        { container: containerFixture({ cart: order }) }
      )
    ).rejects.toThrow(
      "Stripe Tax order changes cannot add or reprice taxable items."
    )
  })

  it.each([null, "taxrate_io"] as const)(
    "retains historical %s treatment from a reduced native order projection",
    async (provider) => {
      const order = orderFixture(provider)
      const context = hookContext(
        await registeredOrderHook()(
          {
            order: { id: order.id, currency_code: order.currency_code },
            items: [{ id: "ordli_new", unit_price: 2.34 }],
          },
          { container: containerFixture({ cart: order }) }
        )
      )
      expect(context).toMatchObject({
        provider,
        collectionMode: provider ? "collect" : "disabled",
        generation: 1,
        frozenQuote: {
          generation: 1,
          provider,
          ...(provider ? { taxRatePercent: 6.35 } : {}),
        },
      })
    }
  )

  it.each([
    { data: [] },
    { data: [false] },
    { data: [{ id: "another_order" }] },
    { data: [{ id: "order_01" }, { id: "order_01" }] },
  ])(
    "rejects unavailable or ambiguous native order history %p",
    async (graphResult) => {
      const order = orderFixture()
      await expect(
        registeredOrderHook()(
          { order, items: [{ id: "ordli_new", unit_price: 2.34 }] },
          { container: containerFixture({ cart: order, graphResult }) }
        )
      ).rejects.toThrow("Historical order tax query")
    }
  )

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
