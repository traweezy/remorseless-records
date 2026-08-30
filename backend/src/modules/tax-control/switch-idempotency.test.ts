import { matchesTaxControlTransitionReplay } from "./switch-idempotency";

const audit = {
  acknowledgement_version: "tax-collection-control-2026-08-30",
  actor_id: "user_admin",
  from_generation: 4,
  reason: "Validated Stripe Tax in sandbox.",
  to_collection_mode: "collect" as const,
  to_generation: 5,
  to_provider: "stripe_tax" as const,
};

describe("tax control transition idempotency", () => {
  it("accepts an exact replay of the original transition request", () => {
    expect(
      matchesTaxControlTransitionReplay(audit, {
        acknowledgementVersion: "tax-collection-control-2026-08-30",
        actorId: "user_admin",
        expectedGeneration: 4,
        reason: "Validated Stripe Tax in sandbox.",
        targetCollectionMode: "collect",
        targetProvider: "stripe_tax",
      }),
    ).toBe(true);
  });

  it.each([
    ["actor", { actorId: "user_other" }],
    ["acknowledgement", { acknowledgementVersion: "different-version" }],
    ["generation", { expectedGeneration: 3 }],
    ["reason", { reason: "A different operational reason." }],
    ["mode", { targetCollectionMode: "disabled" as const }],
    ["provider", { targetProvider: "taxrate_io" as const }],
  ])("rejects reuse with a different %s", (_field, overrides) => {
    expect(
      matchesTaxControlTransitionReplay(audit, {
        acknowledgementVersion: "tax-collection-control-2026-08-30",
        actorId: "user_admin",
        expectedGeneration: 4,
        reason: "Validated Stripe Tax in sandbox.",
        targetCollectionMode: "collect",
        targetProvider: "stripe_tax",
        ...overrides,
      }),
    ).toBe(false);
  });

  it("rejects malformed audit generations", () => {
    expect(
      matchesTaxControlTransitionReplay(
        { ...audit, to_generation: 6 },
        {
          acknowledgementVersion: "tax-collection-control-2026-08-30",
          actorId: "user_admin",
          expectedGeneration: 4,
          reason: "Validated Stripe Tax in sandbox.",
          targetCollectionMode: "collect",
          targetProvider: "stripe_tax",
        },
      ),
    ).toBe(false);
  });
});
