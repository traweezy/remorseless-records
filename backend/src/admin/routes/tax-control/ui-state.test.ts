import {
  canReviewProviderSwitch,
  getProviderCardState,
  isProviderName,
  normalizeTargetProvider,
  resolveProviderSelection,
} from "./ui-state";

describe("tax control UI state", () => {
  it("recognizes only supported providers", () => {
    expect(isProviderName("taxrate_io")).toBe(true);
    expect(isProviderName("stripe_tax")).toBe(true);
    expect(isProviderName("manual")).toBe(false);
  });

  it("treats choosing the active provider as canceling a pending change", () => {
    expect(normalizeTargetProvider("taxrate_io", "taxrate_io")).toBeNull();
    expect(resolveProviderSelection("taxrate_io", null)).toBe("taxrate_io");
  });

  it("keeps the active provider highlighted while marking the target pending", () => {
    expect(
      getProviderCardState({
        activeProvider: "taxrate_io",
        provider: "taxrate_io",
        targetProvider: "stripe_tax",
      }),
    ).toEqual({
      active: true,
      highlighted: true,
      pending: false,
    });
    expect(
      getProviderCardState({
        activeProvider: "taxrate_io",
        provider: "stripe_tax",
        targetProvider: "stripe_tax",
      }),
    ).toEqual({
      active: false,
      highlighted: true,
      pending: true,
    });
  });

  it("requires a distinct ready target and an auditable reason", () => {
    const baseline = {
      activeProvider: "taxrate_io" as const,
      reason: "Approved after sandbox verification.",
      saving: false,
      targetProvider: "stripe_tax" as const,
      targetReady: true,
    };

    expect(canReviewProviderSwitch(baseline)).toBe(true);
    expect(canReviewProviderSwitch({ ...baseline, reason: "Too short" })).toBe(
      false,
    );
    expect(canReviewProviderSwitch({ ...baseline, targetReady: false })).toBe(
      false,
    );
    expect(
      canReviewProviderSwitch({
        ...baseline,
        targetProvider: "taxrate_io",
      }),
    ).toBe(false);
    expect(canReviewProviderSwitch({ ...baseline, saving: true })).toBe(false);
  });
});
