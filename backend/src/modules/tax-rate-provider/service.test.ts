import type {
  ItemTaxCalculationLine,
  Logger,
  ShippingTaxCalculationLine,
  TaxCalculationContext,
} from "@medusajs/framework/types";

jest.mock("../../lib/constants", () => ({
  REDIS_URL: "",
}));

import { createTaxContextFingerprint } from "../../lib/tax-control/context";
import TaxRateLookupProviderService from "./service";

const service = () =>
  new TaxRateLookupProviderService(
    {
      logger: {
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
        fingerprint: createTaxContextFingerprint({ order: "order_01" }),
        frozenQuote: {
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
