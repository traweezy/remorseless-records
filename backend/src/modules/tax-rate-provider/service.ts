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
import { observeOperation } from "../../lib/observability/operation-telemetry";
import { resolveProviderTaxCacheConfig } from "../../lib/tax-control/cache-config";
import { REDIS_URL } from "../../lib/constants";
import {
  TAXRATE_IO_QUOTA_REDIS_KEY,
  type TaxCollectionMode,
  type TaxProviderName,
} from "../tax-control/constants";
import {
  BoundedExpiringCache,
  type CacheEvictionEvent,
} from "./bounded-expiring-cache";
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
  rateCacheMaxEntries?: number;
  rateCacheTtlMs?: number;
  stripeApiKey?: string;
  stripeQuoteCacheMaxEntries?: number;
  stripeQuoteTtlMs?: number;
  stripeShippingTaxCode?: string;
  timeoutMs?: number;
};

type InjectedDependencies = {
  logger: Logger;
};

type CachedStripeQuote = {
  expiresAt: number;
  result: StripeTaxCalculationResult;
};

type LocalTaxCache = "rate" | "stripe_quote";

const DEFAULT_TIMEOUT_MS = 8_000;
const CACHE_CAPACITY_LOG_INTERVAL_MS = 60_000;
const redisUrl = REDIS_URL?.trim();
let redisClient: RedisClientType | null = null;
let redisConnectPromise: Promise<RedisClientType | null> | null = null;

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
    }).on("error", () => {
      logger.warn("Tax cache Redis client reported an error.");
    });
  redisClient = client;

  redisConnectPromise = client
    .connect()
    .then(() => client)
    .catch(() => {
      logger.warn("Tax cache Redis connection failed.");
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
  readonly #capacityLogAt = new Map<LocalTaxCache, number>();
  readonly #rateCache: BoundedExpiringCache<string, TaxRateIoResult>;
  readonly #rateCacheTtlMs: number;
  readonly #stripeQuoteCache: BoundedExpiringCache<
    string,
    StripeTaxCalculationResult
  >;
  readonly #stripeQuoteTtlMs: number;

  constructor(
    { logger }: InjectedDependencies,
    options: TaxRateLookupProviderOptions,
  ) {
    this.logger_ = logger;
    this.options_ = options;
    const cacheConfig = resolveProviderTaxCacheConfig(options);
    this.#rateCacheTtlMs = cacheConfig.rateLookupTtlMs;
    this.#stripeQuoteTtlMs = cacheConfig.stripeQuoteTtlMs;
    this.#rateCache = new BoundedExpiringCache({
      maxEntries: cacheConfig.rateLookupMaxEntries,
      onEviction: (event) => this.#observeCacheEviction("rate", event),
    });
    this.#stripeQuoteCache = new BoundedExpiringCache({
      maxEntries: cacheConfig.stripeQuoteMaxEntries,
      onEviction: (event) => this.#observeCacheEviction("stripe_quote", event),
    });
    this.stripe_ = options.stripeApiKey
      ? new Stripe(options.stripeApiKey, {
          httpClient: Stripe.createFetchHttpClient(),
          maxNetworkRetries: 1,
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        })
      : null;
  }

  getIdentifier(): string {
    return TaxRateLookupProviderService.identifier;
  }

  #observeCacheEviction(cache: LocalTaxCache, event: CacheEvictionEvent): void {
    if (event.reason !== "capacity") {
      return;
    }
    const now = Date.now();
    const lastLoggedAt = this.#capacityLogAt.get(cache) ?? 0;
    if (now - lastLoggedAt < CACHE_CAPACITY_LOG_INTERVAL_MS) {
      return;
    }
    this.#capacityLogAt.set(cache, now);
    this.logger_.warn(
      cache === "rate"
        ? "Tax rate local cache reached capacity; least-recently-used entries were evicted."
        : "Stripe Tax quote local cache reached capacity; least-recently-used entries were evicted.",
    );
  }

  #readCachedRate(cacheKey: string): TaxRateIoResult | null {
    return this.#rateCache.get(cacheKey) ?? null;
  }

  #writeCachedRate(cacheKey: string, result: TaxRateIoResult): void {
    this.#rateCache.set(cacheKey, result, Date.now() + this.#rateCacheTtlMs);
  }

  async getTaxLines(
    itemLines: ItemTaxCalculationLine[],
    shippingLines: ShippingTaxCalculationLine[],
    context: TaxCalculationContext,
  ): Promise<(ItemTaxLineDTO | ShippingTaxLineDTO)[]> {
    return observeOperation(
      { domain: "tax", operation: "calculate" },
      async () => {
        const control = parseTaxControlContext(context.additional_context);
        if (control.collectionMode === "disabled") {
          return this.getDisabledTaxLines(itemLines, shippingLines, control);
        }
        if (control.provider === "stripe_tax") {
          return this.getStripeTaxLines(itemLines, shippingLines, context);
        }

        return this.getTaxRateIoLines(itemLines, shippingLines, context);
      },
    );
  }

  private taxLineIdentity(
    collectionMode: TaxCollectionMode,
    provider: TaxProviderName | null,
    generation: number,
    fingerprint: string,
    calculationId?: string,
    jurisdiction?: TaxRateIoJurisdiction | null,
  ) {
    return {
      code: buildTaxLineCode({
        ...(calculationId ? { calculationId } : {}),
        collectionMode,
        generation,
        provider,
      }),
      data: {
        ...(calculationId ? { calculation_id: calculationId } : {}),
        collection_mode: collectionMode,
        fingerprint,
        generation,
        ...(jurisdiction ? { jurisdiction } : {}),
        ...(provider ? { provider } : {}),
      },
      name:
        collectionMode === "disabled"
          ? "Tax not collected"
          : provider === "stripe_tax"
            ? "Stripe Tax"
            : "Sales tax",
      provider_id: this.getIdentifier(),
    };
  }

  private getDisabledTaxLines(
    itemLines: ItemTaxCalculationLine[],
    shippingLines: ShippingTaxCalculationLine[],
    control: ReturnType<typeof parseTaxControlContext>,
  ): (ItemTaxLineDTO | ShippingTaxLineDTO)[] {
    const identity = this.taxLineIdentity(
      "disabled",
      null,
      control.generation,
      control.fingerprint,
    );
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
      "collect",
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
        "collect",
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
      "collect",
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
      if (
        amount > 0 &&
        !Object.hasOwn(quote.itemTaxByReference, line.line_item.id)
      ) {
        throw new Error("Stripe Tax response omitted an item tax result.");
      }
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
        expectedReferences: itemLines
          .filter(
            (line) =>
              minorUnits(
                line.line_item.unit_price,
                line.line_item.quantity,
                control.itemAmountsMinor[line.line_item.id],
              ) > 0,
          )
          .map((line) => line.line_item.id),
        onRetry: ({ attempt, operation, reason, totalAttempts }) =>
          this.logger_.warn(
            `Stripe Tax ${operation} retry scheduled (${reason}, attempt ${attempt}/${totalAttempts}).`,
          ),
        timeoutMs: this.options_.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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
      onRetry: ({ attempt, operation, reason, totalAttempts }) =>
        this.logger_.warn(
          `Stripe Tax ${operation} retry scheduled (${reason}, attempt ${attempt}/${totalAttempts}).`,
        ),
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
      timeoutMs: this.options_.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    await this.writeStripeQuote(control.fingerprint, created);
    return created;
  }

  private async readStripeQuote(
    fingerprint: string,
  ): Promise<StripeTaxCalculationResult | null> {
    const local = this.#stripeQuoteCache.get(fingerprint);
    if (local) {
      return local;
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
      this.#stripeQuoteCache.set(fingerprint, parsed.result, parsed.expiresAt);
      return parsed.result;
    } catch {
      this.logger_.warn("Stripe Tax cache lookup failed.");
      return null;
    }
  }

  private async writeStripeQuote(
    fingerprint: string,
    result: StripeTaxCalculationResult,
  ): Promise<void> {
    const configuredTtl = this.#stripeQuoteTtlMs;
    const now = Date.now();
    const upstreamTtl = result.expiresAt
      ? result.expiresAt * 1000 - now
      : configuredTtl;
    const ttlMs = Math.max(1_000, Math.min(configuredTtl, upstreamTtl));
    const cached: CachedStripeQuote = {
      expiresAt: now + ttlMs,
      result,
    };
    this.#stripeQuoteCache.set(fingerprint, result, cached.expiresAt);

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
    } catch {
      this.logger_.warn("Stripe Tax cache write failed.");
    }
  }

  private async resolveTaxRateIo(
    context: TaxCalculationContext,
  ): Promise<TaxRateIoResult> {
    const cacheKey = buildRateCacheKey(context.address);
    if (!cacheKey) {
      return { jurisdiction: null, quota: null, ratePercent: 0 };
    }

    const cached = this.#readCachedRate(cacheKey);
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
            this.#writeCachedRate(cacheKey, parsed);
            return parsed;
          }
        }
      } catch {
        this.logger_.warn("Tax cache Redis lookup failed.");
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

    const result = await observeOperation(
      { domain: "tax", operation: "provider_request" },
      () =>
        fetchTaxRateIo({
          apiKey: this.options_.apiKey,
          onRetry: ({ attempt, reason, totalAttempts }) =>
            this.logger_.warn(
              `Tax rate lookup retry scheduled (${reason}, attempt ${attempt}/${totalAttempts}).`,
            ),
          timeoutMs: this.options_.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          zip: postalCode,
        }),
    );

    this.#writeCachedRate(cacheKey, result);
    if (redisClientInstance) {
      try {
        await redisClientInstance.set(
          buildRedisRateKey(cacheKey),
          JSON.stringify({
            jurisdiction: result.jurisdiction,
            ratePercent: result.ratePercent,
          }),
          { EX: Math.max(1, Math.ceil(this.#rateCacheTtlMs / 1000)) },
        );
        if (result.quota) {
          await this.writeTaxRateIoQuota(redisClientInstance, result.quota);
        }
      } catch {
        this.logger_.warn("Tax cache Redis write failed.");
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
