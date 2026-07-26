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
    id: "taxassoc_test",
    object: "tax.association",
    payment_intent: "pi_test",
    tax_transaction_attempts: attempts,
  }) as Stripe.Tax.Association;

const serviceFixture = ({
  evidence = {
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
  taxAssociation = association([
    {
      committed: { transaction: "tax_txn_sale" },
      source: "pi_test",
      status: "committed",
    },
  ]),
}: {
  intent?: Stripe.PaymentIntent;
  taxAssociation?: Stripe.Tax.Association;
} = {}) =>
  ({
    paymentIntents: {
      retrieve: jest.fn(async () => intent),
    },
    tax: {
      associations: {
        find: jest.fn(async () => taxAssociation),
      },
    },
  }) as unknown as Stripe;

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
        taxTransactionId: "tax_txn_sale",
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
          committed: { transaction: "tax_txn_sale" },
          source: "pi_test",
          status: "committed",
        },
        {
          committed: { transaction: "tax_txn_refund" },
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
          refund_tax_transaction_ids: ["tax_txn_refund"],
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
});
