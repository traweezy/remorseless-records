import {
  providerLabel,
  providerSwitchWasApplied,
  taxProviderSwitchFormSchema,
} from "./ui-state";

describe("tax control UI state", () => {
  it("uses merchant-facing provider names", () => {
    expect(providerLabel("taxrate_io")).toBe("TaxRate.io");
    expect(providerLabel("stripe_tax")).toBe("Stripe Tax");
  });

  it("normalizes and bounds the provider-switch audit reason", () => {
    expect(
      taxProviderSwitchFormSchema.parse({
        reason: "  Approved after sandbox verification.  ",
      }),
    ).toEqual({
      reason: "Approved after sandbox verification.",
    });
    expect(() =>
      taxProviderSwitchFormSchema.parse({ reason: "Too short" }),
    ).toThrow();
    expect(() =>
      taxProviderSwitchFormSchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });

  it("recognizes an ambiguously returned switch only after reconciliation", () => {
    const baseline = {
      activeProvider: "stripe_tax" as const,
      currentGeneration: 3,
      expectedGeneration: 2,
      targetProvider: "stripe_tax" as const,
    };

    expect(providerSwitchWasApplied(baseline)).toBe(true);
    expect(
      providerSwitchWasApplied({
        ...baseline,
        activeProvider: "taxrate_io",
      }),
    ).toBe(false);
    expect(
      providerSwitchWasApplied({
        ...baseline,
        currentGeneration: baseline.expectedGeneration,
      }),
    ).toBe(false);
    expect(
      providerSwitchWasApplied({
        ...baseline,
        currentGeneration: undefined,
      }),
    ).toBe(false);
  });
});
