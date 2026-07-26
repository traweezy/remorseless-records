import {
  canConfirmProviderSwitch,
  providerLabel,
} from "./ui-state";

describe("tax control UI state", () => {
  it("uses merchant-facing provider names", () => {
    expect(providerLabel("taxrate_io")).toBe("TaxRate.io");
    expect(providerLabel("stripe_tax")).toBe("Stripe Tax");
  });

  it("requires a distinct ready target and an auditable reason", () => {
    const baseline = {
      activeProvider: "taxrate_io" as const,
      reason: "Approved after sandbox verification.",
      saving: false,
      targetProvider: "stripe_tax" as const,
      targetReady: true,
    };

    expect(canConfirmProviderSwitch(baseline)).toBe(true);
    expect(canConfirmProviderSwitch({ ...baseline, reason: "Too short" })).toBe(
      false,
    );
    expect(canConfirmProviderSwitch({ ...baseline, targetReady: false })).toBe(
      false,
    );
    expect(
      canConfirmProviderSwitch({
        ...baseline,
        targetProvider: "taxrate_io",
      }),
    ).toBe(false);
    expect(canConfirmProviderSwitch({ ...baseline, saving: true })).toBe(false);
  });
});
