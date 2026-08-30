import type Stripe from "stripe";

import type TaxControlModuleService from "../../modules/tax-control/service";
import { reconcileTaxQuoteEvidence } from "./evidence-reconciliation";

const paymentIntent = (
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent =>
  ({
    amount: 1_080,
    amount_received: 1_080,
    currency: "usd",
    id: "pi_test",
    last_payment_error: null,
    latest_charge: {
      amount_refunded: 0,
      disputed: false,
      id: "ch_test",
      object: "charge",
    } as Stripe.Charge,
    livemode: false,
    metadata: {},
    object: "payment_intent",
    status: "succeeded",
    ...overrides,
  }) as Stripe.PaymentIntent;

const association = (
  attempts: Stripe.Tax.Association["tax_transaction_attempts"],
): Stripe.Tax.Association =>
  ({
    calculation: "taxcalc_test",
    id: "taxa_test",
    object: "tax.association",
    payment_intent: "pi_test",
    tax_transaction_attempts: attempts,
  }) as Stripe.Tax.Association;

const serviceFixture = ({
  evidence = {
    collection_mode: "collect",
    payment_intent_id: "pi_test",
    provider: "stripe_tax",
  },
}: {
  evidence?: Record<string, unknown> | null;
} = {}) =>
  ({
    listTaxQuoteEvidences: jest.fn(async () => (evidence ? [evidence] : [])),
    updateTaxQuoteEvidenceLifecycle: jest.fn(async (input) => input),
  }) as unknown as TaxControlModuleService;

const stripeFixture = ({
  intent = paymentIntent(),
  refunds,
  refundsHasMore = false,
  taxAssociation = association([
    {
      committed: { transaction: "tax_sale" },
      source: "pi_test",
      status: "committed",
    },
  ]),
}: {
  intent?: Stripe.PaymentIntent;
  refunds?: Stripe.Refund[];
  refundsHasMore?: boolean;
  taxAssociation?: Stripe.Tax.Association;
} = {}) => {
  const charge =
    intent.latest_charge && typeof intent.latest_charge === "object"
      ? intent.latest_charge
      : null;
  const defaultRefunds =
    charge && charge.amount_refunded > 0
      ? [
          {
            amount: charge.amount_refunded,
            currency: "usd",
            failure_reason: null,
            id: "re_test",
            object: "refund",
            payment_intent: intent.id,
            status: "succeeded",
          } as unknown as Stripe.Refund,
        ]
      : [];

  return {
    paymentIntents: {
      retrieve: jest.fn(async () => intent),
    },
    refunds: {
      list: jest.fn(async () => ({
        data: refunds ?? defaultRefunds,
        has_more: refundsHasMore,
        object: "list",
        url: "/v1/refunds",
      })),
    },
    tax: {
      associations: {
        find: jest.fn(async () => taxAssociation),
      },
    },
  } as unknown as Stripe;
};

describe("reconcileTaxQuoteEvidence", () => {
  it("avoids Stripe calls when the PaymentIntent is not tracked", async () => {
    const client = stripeFixture();

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_untracked",
        service: serviceFixture({ evidence: null }),
      }),
    ).resolves.toEqual({
      associationStatus: "not_tracked",
      evidenceFound: false,
      paymentIntentId: "pi_untracked",
      status: null,
    });
    expect(client.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("persists the committed Stripe Tax transaction and order identity", async () => {
    const service = serviceFixture();

    await expect(
      reconcileTaxQuoteEvidence({
        client: stripeFixture(),
        orderId: "order_01",
        paymentIntentId: "pi_test",
        service,
      }),
    ).resolves.toMatchObject({
      associationStatus: "committed",
      status: "succeeded",
    });
    expect(service.updateTaxQuoteEvidenceLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_01",
        status: "succeeded",
        taxTransactionId: "tax_sale",
      }),
    );
  });

  it("records partial refunds and their Stripe Tax reversal transactions", async () => {
    const service = serviceFixture();
    const client = stripeFixture({
      intent: paymentIntent({
        latest_charge: {
          amount_refunded: 400,
          disputed: false,
          id: "ch_test",
          object: "charge",
        } as Stripe.Charge,
      }),
      taxAssociation: association([
        {
          committed: { transaction: "tax_sale" },
          source: "pi_test",
          status: "committed",
        },
        {
          committed: { transaction: "tax_refund" },
          source: "re_test",
          status: "committed",
        },
      ]),
    });

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_test",
        service,
      }),
    ).resolves.toMatchObject({
      associationStatus: "committed",
      status: "partially_refunded",
    });
    expect(service.updateTaxQuoteEvidenceLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          refund_amount_minor: 400,
          refund_tax_transaction_ids: ["tax_refund"],
        }),
      }),
    );
  });

  it("keeps refunded evidence eligible until its tax reversal appears", async () => {
    const client = stripeFixture({
      intent: paymentIntent({
        latest_charge: {
          amount_refunded: 1_080,
          disputed: false,
          id: "ch_test",
          object: "charge",
        } as Stripe.Charge,
      }),
    });

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_test",
        service: serviceFixture(),
      }),
    ).resolves.toMatchObject({
      associationStatus: "refund_pending",
      status: "refunded",
    });
  });

  it("keeps a second partial refund pending until its own reversal appears", async () => {
    const client = stripeFixture({
      intent: paymentIntent({
        latest_charge: {
          amount_refunded: 700,
          disputed: false,
          id: "ch_test",
          object: "charge",
        } as Stripe.Charge,
      }),
      refunds: [
        {
          amount: 300,
          currency: "usd",
          failure_reason: null,
          id: "re_first",
          object: "refund",
          payment_intent: "pi_test",
          status: "succeeded",
        } as unknown as Stripe.Refund,
        {
          amount: 400,
          currency: "usd",
          failure_reason: null,
          id: "re_second",
          object: "refund",
          payment_intent: "pi_test",
          status: "succeeded",
        } as unknown as Stripe.Refund,
      ],
      taxAssociation: association([
        {
          committed: { transaction: "tax_sale" },
          source: "pi_test",
          status: "committed",
        },
        {
          committed: { transaction: "tax_refundfirst" },
          source: "re_first",
          status: "committed",
        },
      ]),
    });

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_test",
        service: serviceFixture(),
      }),
    ).resolves.toMatchObject({
      associationStatus: "refund_pending",
      status: "partially_refunded",
    });
  });

  it("surfaces a refund that failed after Medusa accepted it", async () => {
    const service = serviceFixture();
    const client = stripeFixture({
      refunds: [
        {
          amount: 400,
          currency: "usd",
          failure_reason: "expired_or_canceled_card",
          id: "re_failed",
          object: "refund",
          payment_intent: "pi_test",
          status: "failed",
        } as Stripe.Refund,
      ],
    });

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_test",
        service,
      }),
    ).resolves.toMatchObject({
      associationStatus: "refund_failed:expired_or_canceled_card",
      status: "association_failed",
    });
    expect(service.updateTaxQuoteEvidenceLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          stripe_refund_failed_count: 1,
        }),
      }),
    );
  });

  it("fails closed when more refunds exist than the bounded audit retrieved", async () => {
    await expect(
      reconcileTaxQuoteEvidence({
        client: stripeFixture({ refundsHasMore: true }),
        paymentIntentId: "pi_test",
        service: serviceFixture(),
      }),
    ).resolves.toMatchObject({
      associationStatus: "refund_list_truncated",
      status: "association_failed",
    });
  });

  it("raises disputes above the otherwise successful payment state", async () => {
    const service = serviceFixture();
    const client = stripeFixture({
      intent: paymentIntent({
        latest_charge: {
          amount_refunded: 0,
          disputed: true,
          id: "ch_test",
          object: "charge",
        } as Stripe.Charge,
      }),
    });

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_test",
        service,
      }),
    ).resolves.toMatchObject({ status: "disputed" });
  });

  it("surfaces a failed tax association for operator attention", async () => {
    const service = serviceFixture();
    const client = stripeFixture({
      taxAssociation: association([
        {
          errored: { reason: "calculation_expired" },
          source: "pi_test",
          status: "errored",
        },
      ]),
    });

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_test",
        service,
      }),
    ).resolves.toEqual({
      associationStatus: "errored:calculation_expired",
      evidenceFound: true,
      paymentIntentId: "pi_test",
      status: "association_failed",
    });
  });

  it("records a failed confirmation without making the evidence terminal", async () => {
    const service = serviceFixture();
    const client = stripeFixture({
      intent: paymentIntent({
        amount_received: 0,
        last_payment_error: {
          code: "card_declined",
          type: "card_error",
        } as Stripe.PaymentIntent.LastPaymentError,
        status: "requires_payment_method",
      }),
    });

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_test",
        service,
      }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(service.updateTaxQuoteEvidenceLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          stripe_payment_error_code: "card_declined",
        }),
      }),
    );
  });

  it("does not query Stripe Tax for TaxRate.io evidence", async () => {
    const service = serviceFixture({
      evidence: {
        collection_mode: "collect",
        payment_intent_id: "pi_test",
        provider: "taxrate_io",
      },
    });
    const client = stripeFixture({
      intent: paymentIntent({
        latest_charge: {
          amount_refunded: 1_080,
          disputed: false,
          id: "ch_test",
          object: "charge",
        } as Stripe.Charge,
      }),
    });

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_test",
        service,
      }),
    ).resolves.toMatchObject({
      associationStatus: "not_applicable",
      status: "refunded",
    });
    expect(client.tax.associations.find).not.toHaveBeenCalled();
  });

  it("tracks disabled refunds and disputes without expecting a tax association", async () => {
    const service = serviceFixture({
      evidence: {
        collection_mode: "disabled",
        payment_intent_id: "pi_test",
        provider: null,
      },
    });
    const client = stripeFixture({
      intent: paymentIntent({
        latest_charge: {
          amount_refunded: 400,
          disputed: false,
          id: "ch_test",
          object: "charge",
        } as Stripe.Charge,
      }),
    });

    await expect(
      reconcileTaxQuoteEvidence({
        client,
        paymentIntentId: "pi_test",
        service,
      }),
    ).resolves.toMatchObject({
      associationStatus: "not_applicable",
      status: "partially_refunded",
    });
    expect(client.tax.associations.find).not.toHaveBeenCalled();
    expect(service.updateTaxQuoteEvidenceLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ taxTransactionId: null }),
    );
  });
});
