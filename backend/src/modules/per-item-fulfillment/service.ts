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
} from '@medusajs/framework/types'
import { AbstractFulfillmentProviderService } from '@medusajs/framework/utils'

type InjectedDependencies = {
  logger: Logger
}

type PerItemFulfillmentOptions = {
  baseAmount: number
  additionalAmount: number
  currencyCode?: string
}

type ShippingOptionData = {
  base_amount?: number
  additional_amount?: number
  currency_code?: string
}

const DEFAULT_BASE_AMOUNT = 500
const DEFAULT_ADDITIONAL_AMOUNT = 50

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const resolveAmount = (value: unknown, fallback: number): number => {
  const parsed = toNumber(value)
  if (parsed === null) {
    return fallback
  }

  return Math.max(0, Math.round(parsed))
}

export default class PerItemFulfillmentService extends AbstractFulfillmentProviderService {
  static override identifier = 'per_item'

  protected logger_: Logger
  protected options_: PerItemFulfillmentOptions

  constructor({ logger }: InjectedDependencies, options: PerItemFulfillmentOptions) {
    super()

    this.logger_ = logger
    this.options_ = options
  }

  override async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: 'standard',
        name: 'Standard',
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

  override async validateOption(data: Record<string, unknown>): Promise<boolean> {
    const base = resolveAmount((data as ShippingOptionData).base_amount, DEFAULT_BASE_AMOUNT)
    const additional = resolveAmount(
      (data as ShippingOptionData).additional_amount,
      DEFAULT_ADDITIONAL_AMOUNT
    )

    return Number.isFinite(base) && Number.isFinite(additional)
  }

  override async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  override async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO['optionData'],
    _data: CalculateShippingOptionPriceDTO['data'],
    context: CalculateShippingOptionPriceDTO['context']
  ): Promise<CalculatedShippingOptionPrice> {
    const baseAmount = resolveAmount(
      (optionData as ShippingOptionData).base_amount,
      this.options_.baseAmount ?? DEFAULT_BASE_AMOUNT
    )
    const additionalAmount = resolveAmount(
      (optionData as ShippingOptionData).additional_amount,
      this.options_.additionalAmount ?? DEFAULT_ADDITIONAL_AMOUNT
    )

    const itemCount = Array.isArray(context.items)
      ? context.items.reduce((total, item) => total + Number(item?.quantity ?? 0), 0)
      : 0

    const totalQuantity = Math.max(0, Math.trunc(itemCount))
    const calculated = totalQuantity > 0
      ? baseAmount + Math.max(0, totalQuantity - 1) * additionalAmount
      : 0

    const currencyCode =
      typeof context.currency_code === 'string' ? context.currency_code : null
    if (currencyCode && this.options_.currencyCode) {
      const normalized = currencyCode.toLowerCase()
      if (normalized !== this.options_.currencyCode.toLowerCase()) {
        this.logger_.warn(
          `Per-item shipping configured for ${this.options_.currencyCode}, received ${context.currency_code}.`
        )
      }
    }

    return {
      calculated_amount: calculated,
      is_calculated_price_tax_inclusive: false,
    }
  }

  override async createFulfillment(
    _data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, 'fulfillment'>>[],
    _order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, 'provider_id' | 'data' | 'items'>>
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
