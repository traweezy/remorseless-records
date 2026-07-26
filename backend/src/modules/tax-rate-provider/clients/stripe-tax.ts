import type Stripe from "stripe"

export type StripeTaxAddress = {
  address1?: string
  address2?: string | null
  city?: string
  countryCode: string
  postalCode?: string
  provinceCode?: string | null
}

export type StripeTaxLineInput = {
  amount: number
  quantity: number
  reference: string
  taxCode?: string
}

export type StripeTaxShippingInput = {
  amount: number
  taxCode?: string
}

export type StripeTaxCalculationResult = {
  amountTotal: number
  calculationId: string
  currency: string
  expiresAt: number | null
  itemTaxByReference: Record<string, number>
  livemode: boolean
  shippingTax: number
  taxAmountExclusive: number
}

type StripeTaxClient = Pick<Stripe, "tax">

const addressParams = (
  address: StripeTaxAddress
): Stripe.Tax.CalculationCreateParams.CustomerDetails.Address => ({
  country: address.countryCode.toUpperCase(),
  ...(address.address1 ? { line1: address.address1 } : {}),
  ...(address.address2 ? { line2: address.address2 } : {}),
  ...(address.city ? { city: address.city } : {}),
  ...(address.postalCode ? { postal_code: address.postalCode } : {}),
  ...(address.provinceCode
    ? { state: address.provinceCode.toUpperCase() }
    : {}),
})

const serializeCalculation = async (
  client: StripeTaxClient,
  calculation: Stripe.Tax.Calculation
): Promise<StripeTaxCalculationResult> => {
  if (!calculation.id) {
    throw new Error("Stripe Tax returned a calculation without an ID.")
  }

  const expanded = calculation.line_items?.data ?? []
  const lineItems = calculation.line_items?.has_more
    ? (
        await client.tax.calculations.listLineItems(calculation.id, {
          limit: 100,
        })
      ).data
    : expanded

  const itemTaxByReference = Object.fromEntries(
    lineItems.map((line) => [line.reference, line.amount_tax])
  )

  return {
    amountTotal: calculation.amount_total,
    calculationId: calculation.id,
    currency: calculation.currency,
    expiresAt: calculation.expires_at,
    itemTaxByReference,
    livemode: calculation.livemode,
    shippingTax: calculation.shipping_cost?.amount_tax ?? 0,
    taxAmountExclusive: calculation.tax_amount_exclusive,
  }
}

export const createStripeTaxCalculation = async ({
  address,
  client,
  currency,
  idempotencyKey,
  itemLines,
  shipping,
}: {
  address: StripeTaxAddress
  client: StripeTaxClient
  currency: string
  idempotencyKey: string
  itemLines: StripeTaxLineInput[]
  shipping?: StripeTaxShippingInput
}): Promise<StripeTaxCalculationResult> => {
  if (!itemLines.length) {
    throw new Error("Stripe Tax requires at least one line item.")
  }

  const calculation = await client.tax.calculations.create(
    {
      currency: currency.toLowerCase(),
      customer_details: {
        address: addressParams(address),
        address_source: "shipping",
      },
      expand: ["line_items"],
      line_items: itemLines.map((line) => ({
        amount: line.amount,
        quantity: line.quantity,
        reference: line.reference,
        tax_behavior: "exclusive",
        ...(line.taxCode ? { tax_code: line.taxCode } : {}),
      })),
      ...(shipping && shipping.amount > 0
        ? {
            shipping_cost: {
              amount: shipping.amount,
              tax_behavior: "exclusive" as const,
              ...(shipping.taxCode ? { tax_code: shipping.taxCode } : {}),
            },
          }
        : {}),
    },
    { idempotencyKey }
  )

  return serializeCalculation(client, calculation)
}

export const retrieveStripeTaxCalculation = async ({
  calculationId,
  client,
}: {
  calculationId: string
  client: StripeTaxClient
}): Promise<StripeTaxCalculationResult> => {
  const calculation = await client.tax.calculations.retrieve(calculationId, {
    expand: ["line_items"],
  })
  return serializeCalculation(client, calculation)
}
