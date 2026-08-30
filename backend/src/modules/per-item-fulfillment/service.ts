import type {
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  CreateShippingOptionDTO,
  CalculateShippingOptionPriceDTO,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  Logger,
  ValidateFulfillmentDataContext,
} from "@medusajs/framework/types"
import {
  AbstractFulfillmentProviderService,
  MedusaError,
} from "@medusajs/framework/utils"

import {
  readFiniteNumber,
  readNonNegativeSafeInteger,
} from "../../lib/provider-boundary/primitives"
import {
  asUnknownRecord,
  readRecordArray,
} from "../../lib/provider-boundary/records"

type InjectedDependencies = {
  logger: Logger
}

type PerItemFulfillmentOptions = {
  baseAmount: number
  additionalAmount: number
  currencyCode?: string
}

const DEFAULT_BASE_AMOUNT = 5
const DEFAULT_ADDITIONAL_AMOUNT = 0.5
const MAX_CART_ITEMS = 100
const MAX_ITEM_QUANTITY = 100
const MAX_SHIPPING_AMOUNT = 999_999.99

const roundToCurrencyPrecision = (value: number): number =>
  Math.round((value + Number.EPSILON * Math.max(1, value)) * 100) / 100

export const resolveShippingAmount = (
  value: unknown,
  fallback: number
): number | null => {
  const parsed = readFiniteNumber(
    value === null || value === undefined ? fallback : value
  )
  return parsed !== null && parsed >= 0 && parsed <= MAX_SHIPPING_AMOUNT
    ? roundToCurrencyPrecision(parsed)
    : null
}

export const calculatePerItemShippingAmount = ({
  additionalAmount,
  baseAmount,
  itemCount,
}: {
  additionalAmount: number
  baseAmount: number
  itemCount: number
}): number => {
  const totalQuantity = readNonNegativeSafeInteger(itemCount)
  if (
    totalQuantity === null ||
    totalQuantity > MAX_CART_ITEMS * MAX_ITEM_QUANTITY ||
    !Number.isFinite(baseAmount) ||
    !Number.isFinite(additionalAmount) ||
    baseAmount < 0 ||
    additionalAmount < 0 ||
    baseAmount > MAX_SHIPPING_AMOUNT ||
    additionalAmount > MAX_SHIPPING_AMOUNT
  ) {
    throw new RangeError("Per-item shipping inputs are outside safe limits.")
  }
  if (totalQuantity === 0) {
    return 0
  }
  const amount = roundToCurrencyPrecision(
    baseAmount + Math.max(0, totalQuantity - 1) * additionalAmount
  )
  if (!Number.isFinite(amount) || amount > MAX_SHIPPING_AMOUNT) {
    throw new RangeError("Per-item shipping total is outside safe limits.")
  }
  return amount
}

const invalidFulfillmentData = (): MedusaError =>
  new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "The per-item shipping calculation data is invalid."
  )

export default class PerItemFulfillmentService extends AbstractFulfillmentProviderService {
  static override identifier = "per_item"

  protected logger_: Logger
  protected options_: PerItemFulfillmentOptions

  constructor(
    { logger }: InjectedDependencies,
    options: PerItemFulfillmentOptions
  ) {
    super()

    this.logger_ = logger
    this.options_ = options
  }

  override async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: "standard",
        name: "Standard",
      },
    ]
  }

  override async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: ValidateFulfillmentDataContext
  ): Promise<Record<string, unknown>> {
    return {
      ...data,
      option: optionData,
    }
  }

  override async validateOption(
    data: Record<string, unknown>
  ): Promise<boolean> {
    const option = asUnknownRecord(data)
    if (!option) {
      return false
    }
    const base = resolveShippingAmount(option.base_amount, DEFAULT_BASE_AMOUNT)
    const additional = resolveShippingAmount(
      option.additional_amount,
      DEFAULT_ADDITIONAL_AMOUNT
    )
    const currencyCode = option.currency_code
    return (
      base !== null &&
      additional !== null &&
      (currencyCode === null ||
        currencyCode === undefined ||
        (typeof currencyCode === "string" &&
          currencyCode.toLowerCase() === "usd"))
    )
  }

  override async canCalculate(
    _data: CreateShippingOptionDTO
  ): Promise<boolean> {
    return true
  }

  override async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    _data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const option = asUnknownRecord(optionData)
    if (!option) {
      throw invalidFulfillmentData()
    }
    const baseAmount = resolveShippingAmount(
      option.base_amount,
      this.options_.baseAmount ?? DEFAULT_BASE_AMOUNT
    )
    const additionalAmount = resolveShippingAmount(
      option.additional_amount,
      this.options_.additionalAmount ?? DEFAULT_ADDITIONAL_AMOUNT
    )
    if (baseAmount === null || additionalAmount === null) {
      throw invalidFulfillmentData()
    }

    let items: Record<string, unknown>[]
    try {
      items = readRecordArray(context.items, {
        context: "Per-item fulfillment cart items",
        optional: true,
      })
    } catch {
      throw invalidFulfillmentData()
    }
    if (items.length > MAX_CART_ITEMS) {
      throw invalidFulfillmentData()
    }
    let itemCount = 0
    for (const item of items) {
      const quantity = readNonNegativeSafeInteger(item.quantity)
      if (
        typeof item.id !== "string" ||
        !item.id.trim() ||
        item.id.trim().length > 255 ||
        quantity === null ||
        quantity < 1 ||
        quantity > MAX_ITEM_QUANTITY ||
        !Number.isSafeInteger(itemCount + quantity)
      ) {
        throw invalidFulfillmentData()
      }
      itemCount += quantity
    }

    const calculated = calculatePerItemShippingAmount({
      additionalAmount,
      baseAmount,
      itemCount,
    })

    const currencyCode =
      typeof context.currency_code === "string"
        ? context.currency_code.trim().toLowerCase()
        : ""
    const configuredCurrency =
      typeof this.options_.currencyCode === "string"
        ? this.options_.currencyCode.trim().toLowerCase()
        : "usd"
    if (currencyCode !== "usd" || configuredCurrency !== "usd") {
      throw invalidFulfillmentData()
    }

    return {
      calculated_amount: calculated,
      is_calculated_price_tax_inclusive: false,
    }
  }

  override async createFulfillment(
    _data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    _order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<
      Omit<FulfillmentDTO, "provider_id" | "data" | "items">
    >
  ): Promise<CreateFulfillmentResult> {
    return {
      data: {},
      labels: [],
    }
  }

  override async cancelFulfillment(
    _data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return {}
  }

  override async createReturnFulfillment(
    _fulfillment: Record<string, unknown>
  ): Promise<CreateFulfillmentResult> {
    return {
      data: {},
      labels: [],
    }
  }

  override async retrieveDocuments(
    _fulfillmentData: Record<string, unknown>,
    _documentType: string
  ): Promise<void> {
    return undefined
  }
}
