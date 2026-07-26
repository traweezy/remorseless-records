import { matchesProviderSwitchReplay } from "./switch-idempotency";

const audit = {
  actor_id: "user_admin",
  from_generation: 4,
  reason: "Validated Stripe Tax in sandbox.",
  to_generation: 5,
  to_provider: "stripe_tax" as const,
};

describe("tax provider switch idempotency", () => {
  it("accepts an exact replay of the original switch request", () => {
    expect(
      matchesProviderSwitchReplay(audit, {
        actorId: "user_admin",
        expectedGeneration: 4,
        reason: "Validated Stripe Tax in sandbox.",
        targetProvider: "stripe_tax",
      }),
    ).toBe(true);
  });

  it.each([
    ["actor", { actorId: "user_other" }],
    ["generation", { expectedGeneration: 3 }],
    ["reason", { reason: "A different operational reason." }],
    ["provider", { targetProvider: "taxrate_io" as const }],
  ])("rejects reuse with a different %s", (_field, overrides) => {
    expect(
      matchesProviderSwitchReplay(audit, {
        actorId: "user_admin",
        expectedGeneration: 4,
        reason: "Validated Stripe Tax in sandbox.",
        targetProvider: "stripe_tax",
        ...overrides,
      }),
    ).toBe(false);
  });

  it("rejects malformed audit generations", () => {
    expect(
      matchesProviderSwitchReplay(
        { ...audit, to_generation: 6 },
        {
          actorId: "user_admin",
          expectedGeneration: 4,
          reason: "Validated Stripe Tax in sandbox.",
          targetProvider: "stripe_tax",
        },
      ),
    ).toBe(false);
  });
});
