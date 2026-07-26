import type {
  ITaxProvider,
  ItemTaxCalculationLine,
  ItemTaxLineDTO,
  Logger,
  ShippingTaxCalculationLine,
  ShippingTaxLineDTO,
  TaxCalculationContext,
} from "@medusajs/framework/types";
import { MathBN } from "@medusajs/framework/utils";
import type { RedisClientType } from "redis";
import { createClient } from "redis";
import Stripe from "stripe";

import {
  buildTaxLineCode,
  parseTaxControlContext,
} from "../../lib/tax-control/context";
import { REDIS_URL } from "../../lib/constants";
import { TAXRATE_IO_QUOTA_REDIS_KEY } from "../tax-control/constants";
import {
  createStripeTaxCalculation,
  retrieveStripeTaxCalculation,
  type StripeTaxCalculationResult,
} from "./clients/stripe-tax";
import {
  fetchTaxRateIo,
  type TaxRateIoJurisdiction,
  type TaxRateIoQuota,
  type TaxRateIoResult,
} from "./clients/taxrate-io";

type TaxRateLookupProviderOptions = {
  apiKey: string;
  mode?: "zip" | "address";
  provider: "taxrate_io";
  stripeApiKey?: string;
  stripeQuoteTtlMs?: number;
  stripeShippingTaxCode?: string;
  timeoutMs?: number;
};

type InjectedDependencies = {
  logger: Logger;
};

type CachedRate = {
  expiresAt: number;
  result: TaxRateIoResult;
};

type CachedStripeQuote = {
  expiresAt: number;
  result: StripeTaxCalculationResult;
};

const CACHE_TTL_MS = Number(
  process.env.TAX_RATE_LOOKUP_CACHE_TTL_MS ?? 5 * 60 * 1000,
);
const DEFAULT_STRIPE_QUOTE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;
const rateCache = new Map<string, CachedRate>();
const stripeQuoteCache = new Map<string, CachedStripeQuote>();
const redisUrl = REDIS_URL?.trim();
let redisClient: RedisClientType | null = null;
let redisConnectPromise: Promise<RedisClientType | null> | null = null;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const redisReconnectStrategy = (retries: number): false | number =>
  retries >= 3 ? false : Math.min(100 * 2 ** retries, 1_000);

const buildRateCacheKey = (
  address: TaxCalculationContext["address"],
): string | null => {
  const countryCode = address.country_code?.toLowerCase();
  const postalCode = address.postal_code?.trim();

  if (!countryCode || !postalCode) {
    return null;
  }

  const provinceCode = address.province_code?.toLowerCase() ?? "";
  return `${countryCode}:${provinceCode}:${postalCode}`;
};

const readCachedRate = (cacheKey: string): TaxRateIoResult | null => {
  const cached = rateCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    rateCache.delete(cacheKey);
    return null;
  }

  return cached.result;
};

const writeCachedRate = (cacheKey: string, result: TaxRateIoResult): void => {
  rateCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result,
  });
};

const parseCachedTaxRateIoResult = (value: string): TaxRateIoResult | null => {
  try {
    const parsed = JSON.parse(value) as Partial<TaxRateIoResult> | number;
    if (typeof parsed === "number" && Number.isFinite(parsed)) {
      return { jurisdiction: null, quota: null, ratePercent: parsed };
    }
    const ratePercent = Number(
      typeof parsed === "object" && parsed ? parsed.ratePercent : Number.NaN,
    );
    if (!Number.isFinite(ratePercent) || ratePercent < 0) {
      return null;
    }
    return {
      jurisdiction:
        typeof parsed === "object" && parsed && parsed.jurisdiction
          ? parsed.jurisdiction
          : null,
      quota: null,
      ratePercent,
    };
  } catch {
    const legacyRate = Number(value);
    return Number.isFinite(legacyRate) && legacyRate >= 0
      ? { jurisdiction: null, quota: null, ratePercent: legacyRate }
      : null;
  }
};

const getRedisClient = async (
  logger: Logger,
): Promise<RedisClientType | null> => {
  if (!redisUrl) {
    return null;
  }

  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (redisConnectPromise) {
    return redisConnectPromise;
  }

  const client =
    redisClient ??
    createClient({
      url: redisUrl,
      RESP: 3,
      socket: {
        connectTimeout: 2_000,
        reconnectStrategy: redisReconnectStrategy,
      },
    }).on("error", (error) => {
      logger.warn(`Tax cache Redis client error: ${errorMessage(error)}`);
    });
  redisClient = client;

  redisConnectPromise = client
    .connect()
    .then(() => client)
    .catch((error) => {
      logger.warn(`Tax cache Redis connection failed: ${errorMessage(error)}`);
      try {
        client.destroy();
      } catch {
        // The in-memory cache remains available if Redis cannot be destroyed.
      }
      redisClient = null;
      return null;
    })
    .finally(() => {
      redisConnectPromise = null;
    });

  return redisConnectPromise;
};

const buildRedisRateKey = (cacheKey: string): string => `taxrate:${cacheKey}`;

const buildRedisStripeQuoteKey = (fingerprint: string): string =>
  `stripe-tax:quote:${fingerprint}`;

const minorUnits = (
  unitPrice: ItemTaxCalculationLine["line_item"]["unit_price"],
  quantity: ItemTaxCalculationLine["line_item"]["quantity"],
  adjustedAmount?: number,
): number => {
  if (
    adjustedAmount !== undefined &&
    Number.isSafeInteger(adjustedAmount) &&
    adjustedAmount >= 0
  ) {
    return adjustedAmount;
  }
  const value = MathBN.mult(
    MathBN.mult(unitPrice ?? 0, quantity ?? 0),
    100,
  ).toNumber();
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded <= 0) {
    throw new Error("Stripe Tax received an invalid line-item amount.");
  }

  return rounded;
};

const shippingMinorUnits = (
  amount: ShippingTaxCalculationLine["shipping_line"]["unit_price"],
  adjustedAmount?: number,
): number => {
  if (
    adjustedAmount !== undefined &&
    Number.isSafeInteger(adjustedAmount) &&
    adjustedAmount >= 0
  ) {
    return adjustedAmount;
  }
  const value = MathBN.mult(amount ?? 0, 100).toNumber();
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0) {
    throw new Error("Stripe Tax received an invalid shipping amount.");
  }

  return rounded;
};

const rateForExactTax = (taxMinor: number, amountMinor: number): number => {
  if (taxMinor <= 0 || amountMinor <= 0) {
    return 0;
  }

  return Number(((taxMinor / amountMinor) * 100).toFixed(12));
};

const parseCachedStripeQuote = (value: string): CachedStripeQuote | null => {
  try {
    const parsed = JSON.parse(value) as CachedStripeQuote;
    if (
      !parsed ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now() ||
      typeof parsed.result?.calculationId !== "string" ||
      !parsed.result.calculationId.startsWith("taxcalc_")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export default class TaxRateLookupProviderService implements ITaxProvider {
  static identifier = "rate_lookup";
  protected logger_: Logger;
  protected options_: TaxRateLookupProviderOptions;
  protected stripe_: Stripe | null;

  constructor(
    { logger }: InjectedDependencies,
    options: TaxRateLookupProviderOptions,
  ) {
    this.logger_ = logger;
    this.options_ = options;
    this.stripe_ = options.stripeApiKey
      ? new Stripe(options.stripeApiKey, {
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        })
      : null;
  }

  getIdentifier(): string {
    return TaxRateLookupProviderService.identifier;
  }

  async getTaxLines(
    itemLines: ItemTaxCalculationLine[],
    shippingLines: ShippingTaxCalculationLine[],
    context: TaxCalculationContext,
  ): Promise<(ItemTaxLineDTO | ShippingTaxLineDTO)[]> {
    const control = parseTaxControlContext(context.additional_context);
    if (control.provider === "stripe_tax") {
      return this.getStripeTaxLines(itemLines, shippingLines, context);
    }

    return this.getTaxRateIoLines(itemLines, shippingLines, context);
  }

  private taxLineIdentity(
    provider: "stripe_tax" | "taxrate_io",
    generation: number,
    fingerprint: string,
    calculationId?: string,
    jurisdiction?: TaxRateIoJurisdiction | null,
  ) {
    return {
      code: buildTaxLineCode({
        ...(calculationId ? { calculationId } : {}),
        generation,
        provider,
      }),
      data: {
        ...(calculationId ? { calculation_id: calculationId } : {}),
        fingerprint,
        generation,
        ...(jurisdiction ? { jurisdiction } : {}),
        provider,
      },
      name: provider === "stripe_tax" ? "Stripe Tax" : "Sales tax",
      provider_id: this.getIdentifier(),
    };
  }

  private async getTaxRateIoLines(
    itemLines: ItemTaxCalculationLine[],
    shippingLines: ShippingTaxCalculationLine[],
    context: TaxCalculationContext,
  ): Promise<(ItemTaxLineDTO | ShippingTaxLineDTO)[]> {
    const control = parseTaxControlContext(context.additional_context);
    const frozenRate = control.frozenQuote?.taxRatePercent;
    const lookup =
      frozenRate !== undefined
        ? {
            jurisdiction: null,
            quota: null,
            ratePercent: frozenRate,
          }
        : await this.resolveTaxRateIo(context);
    const identity = this.taxLineIdentity(
      "taxrate_io",
      control.generation,
      control.fingerprint,
      undefined,
      lookup.jurisdiction,
    );

    const itemTaxLines: ItemTaxLineDTO[] = itemLines.map((line) => ({
      ...identity,
      line_item_id: line.line_item.id,
      rate: lookup.ratePercent,
    }));
    const shippingTaxLines: ShippingTaxLineDTO[] = shippingLines.map(
      (line) => ({
        ...identity,
        rate: lookup.ratePercent,
        shipping_line_id: line.shipping_line.id,
      }),
    );

    return [...itemTaxLines, ...shippingTaxLines];
  }

  private async getStripeTaxLines(
    itemLines: ItemTaxCalculationLine[],
    shippingLines: ShippingTaxCalculationLine[],
    context: TaxCalculationContext,
  ): Promise<(ItemTaxLineDTO | ShippingTaxLineDTO)[]> {
    const control = parseTaxControlContext(context.additional_context);
    const itemRates = itemLines.map(
      (line) => control.preservedItemRates[line.line_item.id],
    );
    const shippingRates = shippingLines.map(
      (line) => control.preservedShippingRates[line.shipping_line.id],
    );
    const hasPreservedRates = [...itemRates, ...shippingRates].some(
      (rate) => rate !== undefined,
    );
    if (hasPreservedRates) {
      if (
        itemRates.some((rate) => rate === undefined) ||
        shippingRates.some((rate) => rate === undefined)
      ) {
        throw new Error("Stripe Tax preserved order rates are incomplete.");
      }
      const identity = this.taxLineIdentity(
        "stripe_tax",
        control.generation,
        control.fingerprint,
        control.frozenQuote?.stripeCalculationId,
      );
      return [
        ...itemLines.map<ItemTaxLineDTO>((line, index) => ({
          ...identity,
          line_item_id: line.line_item.id,
          rate: itemRates[index]!,
        })),
        ...shippingLines.map<ShippingTaxLineDTO>((line, index) => ({
          ...identity,
          rate: shippingRates[index]!,
          shipping_line_id: line.shipping_line.id,
        })),
      ];
    }

    const quote = await this.resolveStripeQuote(itemLines, context);
    const identity = this.taxLineIdentity(
      "stripe_tax",
      control.generation,
      control.fingerprint,
      quote?.calculationId,
    );

    if (!quote) {
      return [
        ...itemLines.map<ItemTaxLineDTO>((line) => ({
          ...identity,
          line_item_id: line.line_item.id,
          rate: 0,
        })),
        ...shippingLines.map<ShippingTaxLineDTO>((line) => ({
          ...identity,
          rate: 0,
          shipping_line_id: line.shipping_line.id,
        })),
      ];
    }

    const itemTaxLines = itemLines.map<ItemTaxLineDTO>((line) => {
      const amount = minorUnits(
        line.line_item.unit_price,
        line.line_item.quantity,
        control.itemAmountsMinor[line.line_item.id],
      );
      const tax = quote.itemTaxByReference[line.line_item.id] ?? 0;
      return {
        ...identity,
        line_item_id: line.line_item.id,
        rate: rateForExactTax(tax, amount),
      };
    });

    const shippingAmount = shippingMinorUnits(
      shippingLines.reduce(
        (total, line) => MathBN.add(total, line.shipping_line.unit_price ?? 0),
        MathBN.convert(0),
      ),
      control.shippingAmountMinor,
    );
    const shippingRate = rateForExactTax(quote.shippingTax, shippingAmount);
    const shippingTaxLines = shippingLines.map<ShippingTaxLineDTO>((line) => ({
      ...identity,
      rate: shippingRate,
      shipping_line_id: line.shipping_line.id,
    }));

    return [...itemTaxLines, ...shippingTaxLines];
  }

  private async resolveStripeQuote(
    itemLines: ItemTaxCalculationLine[],
    context: TaxCalculationContext,
  ): Promise<StripeTaxCalculationResult | null> {
    const control = parseTaxControlContext(context.additional_context);
    if (!context.address.postal_code?.trim()) {
      return null;
    }
    if (!this.stripe_) {
      throw new Error("Stripe Tax is active but Stripe is not configured.");
    }

    const frozenCalculationId = control.frozenQuote?.stripeCalculationId;
    if (frozenCalculationId) {
      const cached = await this.readStripeQuote(control.fingerprint);
      if (cached?.calculationId === frozenCalculationId) {
        return cached;
      }

      const retrieved = await retrieveStripeTaxCalculation({
        calculationId: frozenCalculationId,
        client: this.stripe_,
      });
      await this.writeStripeQuote(control.fingerprint, retrieved);
      return retrieved;
    }

    const cached = await this.readStripeQuote(control.fingerprint);
    if (cached) {
      return cached;
    }

    if (!itemLines.length) {
      throw new Error(
        "Stripe Tax item calculation is unavailable for shipping.",
      );
    }

    const currencies = new Set(
      itemLines.map((line) =>
        line.line_item.currency_code?.trim().toLowerCase(),
      ),
    );
    if (currencies.size !== 1 || !currencies.has("usd")) {
      throw new Error("Stripe Tax checkout is configured for USD only.");
    }

    const shippingAmount = control.shippingAmountMinor;
    const stripeItems = itemLines
      .map((line) => ({
        amount: minorUnits(
          line.line_item.unit_price,
          line.line_item.quantity,
          control.itemAmountsMinor[line.line_item.id],
        ),
        quantity: Number(line.line_item.quantity ?? 0),
        reference: line.line_item.id,
        ...(control.itemTaxCodes[line.line_item.id]
          ? { taxCode: control.itemTaxCodes[line.line_item.id] }
          : {}),
      }))
      .filter((line) => line.amount > 0);
    if (!stripeItems.length) {
      throw new Error(
        "Stripe Tax requires at least one positive line-item amount.",
      );
    }
    const created = await createStripeTaxCalculation({
      address: {
        countryCode: context.address.country_code,
        ...(context.address.address_1
          ? { address1: context.address.address_1 }
          : {}),
        ...(context.address.address_2
          ? { address2: context.address.address_2 }
          : {}),
        ...(context.address.city ? { city: context.address.city } : {}),
        ...(context.address.postal_code
          ? { postalCode: context.address.postal_code }
          : {}),
        ...(context.address.province_code
          ? { provinceCode: context.address.province_code }
          : {}),
      },
      client: this.stripe_,
      currency: "usd",
      idempotencyKey: `rr-tax-${control.fingerprint}`,
      itemLines: stripeItems,
      ...(shippingAmount > 0
        ? {
            shipping: {
              amount: shippingAmount,
              ...(this.options_.stripeShippingTaxCode
                ? { taxCode: this.options_.stripeShippingTaxCode }
                : {}),
            },
          }
        : {}),
    });
    await this.writeStripeQuote(control.fingerprint, created);
    return created;
  }

  private async readStripeQuote(
    fingerprint: string,
  ): Promise<StripeTaxCalculationResult | null> {
    const local = stripeQuoteCache.get(fingerprint);
    if (local && local.expiresAt > Date.now()) {
      return local.result;
    }
    if (local) {
      stripeQuoteCache.delete(fingerprint);
    }

    const client = await getRedisClient(this.logger_);
    if (!client) {
      return null;
    }

    try {
      const value = await client.get(buildRedisStripeQuoteKey(fingerprint));
      if (!value) {
        return null;
      }
      const parsed = parseCachedStripeQuote(value);
      if (!parsed) {
        await client.del(buildRedisStripeQuoteKey(fingerprint));
        return null;
      }
      stripeQuoteCache.set(fingerprint, parsed);
      return parsed.result;
    } catch (error) {
      this.logger_.warn(
        `Stripe Tax cache lookup failed: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  private async writeStripeQuote(
    fingerprint: string,
    result: StripeTaxCalculationResult,
  ): Promise<void> {
    const configuredTtl =
      this.options_.stripeQuoteTtlMs ?? DEFAULT_STRIPE_QUOTE_TTL_MS;
    const upstreamTtl = result.expiresAt
      ? result.expiresAt * 1000 - Date.now()
      : configuredTtl;
    const ttlMs = Math.max(1_000, Math.min(configuredTtl, upstreamTtl));
    const cached: CachedStripeQuote = {
      expiresAt: Date.now() + ttlMs,
      result,
    };
    stripeQuoteCache.set(fingerprint, cached);

    const client = await getRedisClient(this.logger_);
    if (!client) {
      return;
    }
    try {
      await client.set(
        buildRedisStripeQuoteKey(fingerprint),
        JSON.stringify(cached),
        { EX: Math.max(1, Math.ceil(ttlMs / 1000)) },
      );
    } catch (error) {
      this.logger_.warn(
        `Stripe Tax cache write failed: ${errorMessage(error)}`,
      );
    }
  }

  private async resolveTaxRateIo(
    context: TaxCalculationContext,
  ): Promise<TaxRateIoResult> {
    const cacheKey = buildRateCacheKey(context.address);
    if (!cacheKey) {
      return { jurisdiction: null, quota: null, ratePercent: 0 };
    }

    const cached = readCachedRate(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const redisClientInstance = await getRedisClient(this.logger_);
    if (redisClientInstance) {
      try {
        const redisValue = await redisClientInstance.get(
          buildRedisRateKey(cacheKey),
        );
        if (redisValue !== null) {
          const parsed = parseCachedTaxRateIoResult(redisValue);
          if (parsed) {
            writeCachedRate(cacheKey, parsed);
            return parsed;
          }
        }
      } catch (error) {
        this.logger_.warn(
          `Tax cache Redis lookup failed: ${errorMessage(error)}`,
        );
      }
    }

    const countryCode = context.address.country_code?.toLowerCase();
    if (!countryCode) {
      return { jurisdiction: null, quota: null, ratePercent: 0 };
    }
    if (countryCode !== "us") {
      this.logger_.warn(
        `Tax lookup skipped for unsupported country: ${countryCode}`,
      );
      return { jurisdiction: null, quota: null, ratePercent: 0 };
    }

    const postalCode = context.address.postal_code?.trim();
    if (!postalCode) {
      return { jurisdiction: null, quota: null, ratePercent: 0 };
    }
    if (!this.options_.apiKey) {
      throw new Error("TAX_RATE_LOOKUP_API_KEY is not set.");
    }
    if (this.options_.mode && this.options_.mode !== "zip") {
      this.logger_.warn(
        `Tax lookup mode "${this.options_.mode}" is not supported. Using zip lookup.`,
      );
    }

    const result = await fetchTaxRateIo({
      apiKey: this.options_.apiKey,
      timeoutMs: this.options_.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      zip: postalCode,
    });

    writeCachedRate(cacheKey, result);
    if (redisClientInstance) {
      try {
        await redisClientInstance.set(
          buildRedisRateKey(cacheKey),
          JSON.stringify({
            jurisdiction: result.jurisdiction,
            ratePercent: result.ratePercent,
          }),
          { EX: Math.max(1, Math.ceil(CACHE_TTL_MS / 1000)) },
        );
        if (result.quota) {
          await this.writeTaxRateIoQuota(redisClientInstance, result.quota);
        }
      } catch (error) {
        this.logger_.warn(
          `Tax cache Redis write failed: ${errorMessage(error)}`,
        );
      }
    }
    return result;
  }

  private async writeTaxRateIoQuota(
    client: RedisClientType,
    quota: TaxRateIoQuota,
  ): Promise<void> {
    await client.set(TAXRATE_IO_QUOTA_REDIS_KEY, JSON.stringify(quota));
  }
}
