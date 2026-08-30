import {
  loadTaxControlImpact,
  summarizeTaxControlImpact,
  type TaxControlImpactQuery,
} from "./impact";

const cart = ({
  collectionMode = "collect",
  provider = "taxrate_io",
  sessionProvider = "pp_stripe_stripe",
  status = "pending",
}: {
  collectionMode?: "collect" | "disabled";
  provider?: string;
  sessionProvider?: string;
  status?: string;
} = {}) => ({
  id: crypto.randomUUID(),
  payment_collection: {
    payment_sessions: [
      {
        data: {
          metadata: {
            rr_tax_collection_mode: collectionMode,
            ...(collectionMode === "collect"
              ? { rr_tax_provider: provider }
              : {}),
          },
        },
        provider_id: sessionProvider,
        status,
      },
    ],
  },
});

describe("tax-control checkout impact", () => {
  it("counts only processable Stripe checkout sessions", () => {
    expect(
      summarizeTaxControlImpact([
        cart(),
        cart({ provider: "stripe_tax", status: "requires_more" }),
        cart({ provider: "stripe_tax", status: "authorized" }),
        cart({ collectionMode: "disabled" }),
        cart({ status: "error" }),
        cart({ sessionProvider: "pp_system" }),
      ]),
    ).toEqual({
      activityWindowDays: 30,
      frozenByCollectionMode: {
        collect: 3,
        disabled: 1,
      },
      frozenByProvider: {
        stripe_tax: 2,
        taxrate_io: 1,
      },
      paymentsFinalizing: 1,
      preparedCheckouts: 4,
    });
  });

  it("counts a cart once when it has multiple processable sessions", () => {
    const duplicateSessionCart = cart();
    duplicateSessionCart.payment_collection.payment_sessions.push({
      data: {
        metadata: {
          rr_tax_collection_mode: "collect",
          rr_tax_provider: "taxrate_io",
        },
      },
      provider_id: "pp_stripe_stripe",
      status: "pending_authorization",
    });

    expect(summarizeTaxControlImpact([duplicateSessionCart])).toMatchObject({
      paymentsFinalizing: 1,
      preparedCheckouts: 1,
    });
  });

  it("paginates the full activity window instead of returning a sample", async () => {
    const firstPage = Array.from({ length: 250 }, () => cart());
    const secondPage = [cart({ provider: "stripe_tax" })];
    const query: TaxControlImpactQuery = {
      graph: jest
        .fn()
        .mockResolvedValueOnce({
          data: firstPage,
          metadata: { count: 251, skip: 0, take: 250 },
        })
        .mockResolvedValueOnce({
          data: secondPage,
          metadata: { count: 251, skip: 250, take: 250 },
        }),
    };

    const impact = await loadTaxControlImpact(
      query,
      new Date("2026-07-26T12:00:00.000Z"),
    );

    expect(impact.preparedCheckouts).toBe(251);
    expect(query.graph).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pagination: expect.objectContaining({ skip: 250, take: 250 }),
      }),
    );
    expect(query.graph).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filters: {
          completed_at: null,
          updated_at: { $gte: "2026-06-26T12:00:00.000Z" },
        },
      }),
    );
  });
});
