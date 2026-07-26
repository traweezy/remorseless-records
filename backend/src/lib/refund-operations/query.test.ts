import type { MedusaContainer } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

import { buildRefundOperationsSnapshot } from "./query";

const evidenceFixture = (id = "taxevidence_01") => ({
  amount_minor: 2_000,
  association_status: "committed",
  cart_id: "cart_01",
  currency_code: "usd",
  id,
  last_verified_at: "2026-07-26T15:00:00.000Z",
  metadata: {
    refund_amount_minor: 500,
    refund_tax_transaction_ids: [],
    stripe_refund_count: 1,
    stripe_refund_statuses: [{ status: "succeeded" }],
  },
  order_id: "order_01",
  payment_intent_id: "pi_test",
  provider: "taxrate_io",
  status: "partially_refunded",
});

const orderFixture = () => ({
  currency_code: "usd",
  display_id: 42,
  id: "order_01",
  payment_collections: [
    {
      payments: [
        {
          amount: 20,
          captured_amount: 20,
          currency_code: "usd",
          data: { id: "pi_test" },
          id: "pay_01",
          provider_id: "pp_stripe_stripe",
          refunds: [{ amount: 5 }],
        },
      ],
    },
  ],
});

const containerFixture = ({
  evidence = [evidenceFixture()],
  graph,
  reasons = [{ id: "refreason_01" }],
}: {
  evidence?: unknown[];
  graph: jest.Mock;
  reasons?: unknown[];
}): MedusaContainer => {
  const taxControl = {
    listAndCountTaxQuoteEvidences: jest.fn(
      async (_filters: unknown, config: { skip?: number; take?: number }) => {
        const skip = config.skip ?? 0;
        const take = config.take ?? evidence.length;
        return [evidence.slice(skip, skip + take), evidence.length];
      },
    ),
  };
  const payment = {
    listRefundReasons: jest.fn(async () => reasons),
  };
  const dependencies = new Map<string, unknown>([
    [ContainerRegistrationKeys.QUERY, { graph }],
    ["tax_control", taxControl],
    [Modules.PAYMENT, payment],
  ]);
  return {
    resolve: (name: string) => dependencies.get(name),
  } as unknown as MedusaContainer;
};

describe("refund operations snapshot query", () => {
  it("loads recent orders and retains only those with Medusa refunds", async () => {
    const graph = jest.fn(async () => ({ data: [orderFixture()] }));

    const snapshot = await buildRefundOperationsSnapshot({
      container: containerFixture({ graph }),
      now: new Date("2026-07-26T16:00:00.000Z"),
    });

    expect(graph).toHaveBeenCalledTimes(1);
    const [firstCall] = graph.mock.calls as unknown as Array<
      [
        {
          entity: string;
          fields: string[];
          filters: Record<string, unknown>;
        },
      ]
    >;
    expect(firstCall?.[0]).toMatchObject({
      entity: "order",
      filters: {
        updated_at: { $gte: "2026-01-27T16:00:00.000Z" },
      },
    });
    expect(firstCall?.[0].filters).not.toHaveProperty("payment_status");
    expect(firstCall?.[0].fields).not.toEqual(
      expect.arrayContaining([
        "email",
        "fulfillment_status",
        "payment_status",
        "status",
        "updated_at",
        "customer.*",
        "shipping_address.*",
      ]),
    );
    expect(snapshot).toMatchObject({
      reasonConfiguration: { configured: true, count: 1 },
      source: {
        evidenceScanned: 1,
        ordersScanned: 1,
        truncated: false,
        windowDays: 180,
      },
      summary: {
        actionRequired: 0,
        processing: 0,
        totalCases: 1,
        verified: 1,
      },
    });
  });

  it("does not project recent orders without Medusa or evidence refunds", async () => {
    const graph = jest.fn(async () => ({
      data: [
        {
          ...orderFixture(),
          payment_collections: [
            {
              payments: [
                {
                  currency_code: "usd",
                  data: { id: "pi_without_refund" },
                  id: "pay_without_refund",
                  provider_id: "pp_stripe_stripe",
                  refunds: [],
                },
              ],
            },
          ],
        },
      ],
    }));

    const snapshot = await buildRefundOperationsSnapshot({
      container: containerFixture({ evidence: [], graph }),
    });

    expect(snapshot.cases).toEqual([]);
    expect(snapshot.source.ordersScanned).toBe(0);
  });

  it("loads an older order when tracked evidence has a refund signal", async () => {
    const graph = jest.fn(async (input: { filters?: { id?: string[] } }) => ({
      data: input.filters?.id ? [orderFixture()] : [],
    }));

    const snapshot = await buildRefundOperationsSnapshot({
      container: containerFixture({ graph }),
    });

    expect(graph).toHaveBeenCalledTimes(2);
    expect(graph.mock.calls[1]?.[0]).toMatchObject({
      filters: { id: ["order_01"] },
      pagination: { take: 1 },
    });
    expect(snapshot.cases).toHaveLength(1);
  });

  it("paginates tax evidence instead of silently applying a 500-row cap", async () => {
    const evidence = Array.from({ length: 251 }, (_, index) => ({
      ...evidenceFixture(`taxevidence_${index}`),
      association_status: "committed",
      metadata: {},
      order_id: null,
      payment_intent_id: `pi_${index}`,
      status: "succeeded",
    }));
    const graph = jest.fn(async () => ({ data: [] }));
    const container = containerFixture({ evidence, graph, reasons: [] });

    const snapshot = await buildRefundOperationsSnapshot({ container });
    const taxControl = container.resolve("tax_control") as {
      listAndCountTaxQuoteEvidences: jest.Mock;
    };

    expect(taxControl.listAndCountTaxQuoteEvidences).toHaveBeenCalledTimes(2);
    expect(snapshot.source).toMatchObject({
      evidenceScanned: 251,
      truncated: false,
    });
    expect(snapshot.reasonConfiguration).toEqual({
      configured: false,
      count: 0,
    });
  });
});
