import type {
  ItemTaxCalculationLine,
  Logger,
  ShippingTaxCalculationLine,
  TaxCalculationContext,
} from "@medusajs/framework/types";

jest.mock("../../lib/constants", () => ({
  REDIS_URL: "",
}));
jest.mock("./clients/taxrate-io", () => ({
  fetchTaxRateIo: jest.fn(),
}));

import { createTaxContextFingerprint } from "../../lib/tax-control/context";
import { fetchTaxRateIo } from "./clients/taxrate-io";
import TaxRateLookupProviderService from "./service";

const mockFetchTaxRateIo = jest.mocked(fetchTaxRateIo);

const service = () =>
  new TaxRateLookupProviderService(
    {
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
      } as unknown as Logger,
    },
    {
      apiKey: "",
      provider: "taxrate_io",
    },
  );

const item = (id: string): ItemTaxCalculationLine =>
  ({
    line_item: {
      currency_code: "usd",
      id,
      quantity: 1,
      unit_price: 20,
    },
  }) as unknown as ItemTaxCalculationLine;

const shipping = (id: string): ShippingTaxCalculationLine =>
  ({
    shipping_line: {
      id,
      unit_price: 5,
    },
  }) as unknown as ShippingTaxCalculationLine;

const context = (
  preservedItemRates: Record<string, number>,
  preservedShippingRates: Record<string, number>,
): TaxCalculationContext =>
  ({
    additional_context: {
      remorseless_tax: {
        collectionMode: "collect",
        fingerprint: createTaxContextFingerprint({ order: "order_01" }),
        frozenQuote: {
          collectionMode: "collect",
          generation: 2,
          provider: "stripe_tax",
          stripeCalculationId: "taxcalc_original",
        },
        generation: 2,
        itemAmountsMinor: {},
        itemTaxCodes: {},
        preservedItemRates,
        preservedShippingRates,
        provider: "stripe_tax",
        shippingAmountMinor: 500,
        subjectId: "order_01",
      },
    },
    address: {
      country_code: "us",
      postal_code: "14201",
    },
  }) as unknown as TaxCalculationContext;

const lookupContext = (postalCode: string): TaxCalculationContext =>
  ({
    additional_context: {
      remorseless_tax: {
        collectionMode: "collect",
        fingerprint: createTaxContextFingerprint({ postalCode }),
        generation: 1,
        itemAmountsMinor: {},
        itemTaxCodes: {},
        preservedItemRates: {},
        preservedShippingRates: {},
        provider: "taxrate_io",
        shippingAmountMinor: 0,
        subjectId: `cart-${postalCode}`,
      },
    },
    address: {
      country_code: "us",
      postal_code: postalCode,
    },
  }) as unknown as TaxCalculationContext;

describe("controlled tax provider order rate preservation", () => {
  it("reuses reviewed order rates without requiring another Stripe lookup", async () => {
    await expect(
      service().getTaxLines(
        [item("orli_01")],
        [shipping("ordsm_01")],
        context({ orli_01: 8.75 }, { ordsm_01: 8.75 }),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "rr_tax:stripe_tax:g2:taxcalc_original",
        line_item_id: "orli_01",
        rate: 8.75,
      }),
      expect.objectContaining({
        code: "rr_tax:stripe_tax:g2:taxcalc_original",
        rate: 8.75,
        shipping_line_id: "ordsm_01",
      }),
    ]);
  });

  it("fails closed when only part of a recalculation has preserved rates", async () => {
    await expect(
      service().getTaxLines(
        [item("orli_01"), item("orli_02")],
        [],
        context({ orli_01: 8.75 }, {}),
      ),
    ).rejects.toThrow("preserved order rates are incomplete");
  });
});

describe("controlled tax provider disabled collection", () => {
  it("emits one explicit zero line per subject without a provider call", async () => {
    const disabledContext = {
      ...lookupContext("10001"),
      additional_context: {
        remorseless_tax: {
          collectionMode: "disabled",
          fingerprint: createTaxContextFingerprint({ cart: "cart-disabled" }),
          generation: 4,
          itemAmountsMinor: {},
          itemTaxCodes: {},
          preservedItemRates: {},
          preservedShippingRates: {},
          shippingAmountMinor: 500,
          subjectId: "cart-disabled",
        },
      },
    } as unknown as TaxCalculationContext;

    await expect(
      service().getTaxLines(
        [item("item-disabled")],
        [shipping("shipping-disabled")],
        disabledContext,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "rr_tax:disabled:g4:decision",
        data: {
          collection_mode: "disabled",
          fingerprint: expect.any(String),
          generation: 4,
        },
        line_item_id: "item-disabled",
        name: "Tax not collected",
        rate: 0,
      }),
      expect.objectContaining({
        code: "rr_tax:disabled:g4:decision",
        rate: 0,
        shipping_line_id: "shipping-disabled",
      }),
    ]);
    expect(mockFetchTaxRateIo).not.toHaveBeenCalled();
  });
});

describe("controlled tax provider local cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchTaxRateIo.mockResolvedValue({
      jurisdiction: null,
      quota: null,
      ratePercent: 8.75,
    });
  });

  it("bounds lookup entries and rate-limits key-free capacity warnings", async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;
    const provider = new TaxRateLookupProviderService(
      { logger },
      {
        apiKey: "configured",
        provider: "taxrate_io",
        rateCacheMaxEntries: 1,
        rateCacheTtlMs: 1_000,
      },
    );

    await provider.getTaxLines([item("item-1")], [], lookupContext("10001"));
    await provider.getTaxLines([item("item-2")], [], lookupContext("10002"));
    await provider.getTaxLines([item("item-3")], [], lookupContext("10001"));

    expect(mockFetchTaxRateIo).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Tax rate local cache reached capacity; least-recently-used entries were evicted.",
    );
    expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain(
      "1000",
    );
  });

  it("rejects invalid programmatic cache settings during construction", () => {
    expect(
      () =>
        new TaxRateLookupProviderService(
          {
            logger: {
              info: jest.fn(),
              warn: jest.fn(),
            } as unknown as Logger,
          },
          {
            apiKey: "configured",
            provider: "taxrate_io",
            stripeQuoteCacheMaxEntries: 1_001,
          },
        ),
    ).toThrow("STRIPE_TAX_QUOTE_CACHE_MAX_ENTRIES");
  });
});
