import {
  collectionChoiceLabel,
  providerAvailabilityLabel,
  providerLabel,
  taxConfigurationNotice,
  taxControlTransitionIssues,
  taxControlTransitionFormSchema,
  taxControlTransitionWasApplied,
} from "./ui-state"
import { TAX_DISABLED_ACKNOWLEDGEMENT } from "../../../modules/tax-control/constants"

describe("tax control UI state", () => {
  it("uses merchant-facing provider names", () => {
    expect(providerLabel("taxrate_io")).toBe("TaxRate.io")
    expect(providerLabel("stripe_tax")).toBe("Stripe Tax")
  })

  it("distinguishes unavailable providers from incomplete setup", () => {
    expect(providerAvailabilityLabel({ configured: false, ready: false })).toBe(
      "Unavailable"
    )
    expect(providerAvailabilityLabel({ configured: true, ready: false })).toBe(
      "Needs setup"
    )
    expect(providerAvailabilityLabel({ configured: true, ready: true })).toBe(
      "Ready"
    )
  })

  it("flags an unavailable active provider and a disabled empty environment", () => {
    const unavailableProviders = {
      stripe_tax: { configured: false, ready: false },
      taxrate_io: { configured: false, ready: false },
    } as const

    expect(
      taxConfigurationNotice({
        activeProvider: "taxrate_io",
        collectionMode: "collect",
        providers: unavailableProviders,
      })
    ).toBe("active_provider_unavailable")
    expect(
      taxConfigurationNotice({
        activeProvider: "taxrate_io",
        collectionMode: "disabled",
        providers: unavailableProviders,
      })
    ).toBe("no_provider_available")
    expect(
      taxConfigurationNotice({
        activeProvider: "taxrate_io",
        collectionMode: "disabled",
        providers: {
          ...unavailableProviders,
          stripe_tax: { configured: true, ready: true },
        },
      })
    ).toBeNull()
  })

  it("normalizes and bounds the tax-control audit reason", () => {
    const schema = taxControlTransitionFormSchema("collect")
    expect(
      schema.parse({
        acknowledgement: "",
        reason: "  Approved after sandbox verification.  ",
      })
    ).toEqual({
      acknowledgement: "",
      reason: "Approved after sandbox verification.",
    })
    expect(() =>
      schema.parse({ acknowledgement: "", reason: "Too short" })
    ).toThrow()
    expect(() =>
      schema.parse({ acknowledgement: "", reason: "x".repeat(501) })
    ).toThrow()
  })

  it("requires the exact acknowledgement only when disabling collection", () => {
    const disabledSchema = taxControlTransitionFormSchema("disabled")
    const validInput = {
      acknowledgement: TAX_DISABLED_ACKNOWLEDGEMENT,
      reason: "Approved after reviewing the operating impact.",
    }

    expect(disabledSchema.parse(validInput)).toEqual(validInput)
    expect(() =>
      disabledSchema.parse({ ...validInput, acknowledgement: "I understand" })
    ).toThrow()
    expect(
      taxControlTransitionFormSchema("collect").safeParse({
        ...validInput,
        acknowledgement: "",
      }).success
    ).toBe(true)
    expect(
      taxControlTransitionIssues("disabled", {
        acknowledgement: "",
        reason: "short",
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: "tax-disabled-acknowledgement",
        }),
        expect.objectContaining({ targetId: "tax-transition-reason" }),
      ])
    )
  })

  it("uses plain-language labels for all three choices", () => {
    expect(collectionChoiceLabel("disabled", "stripe_tax")).toBe(
      "Do not collect tax"
    )
    expect(collectionChoiceLabel("collect", "taxrate_io")).toBe(
      "Collect with TaxRate.io"
    )
    expect(collectionChoiceLabel("collect", "stripe_tax")).toBe(
      "Collect with Stripe Tax"
    )
  })

  it("recognizes an ambiguously returned switch only after reconciliation", () => {
    const baseline = {
      activeProvider: "stripe_tax" as const,
      collectionMode: "collect" as const,
      currentGeneration: 3,
      expectedGeneration: 2,
      targetCollectionMode: "collect" as const,
      targetProvider: "stripe_tax" as const,
    }

    expect(taxControlTransitionWasApplied(baseline)).toBe(true)
    expect(
      taxControlTransitionWasApplied({
        ...baseline,
        activeProvider: "taxrate_io",
      })
    ).toBe(false)
    expect(
      taxControlTransitionWasApplied({
        ...baseline,
        collectionMode: "disabled",
      })
    ).toBe(false)
    expect(
      taxControlTransitionWasApplied({
        ...baseline,
        currentGeneration: baseline.expectedGeneration,
      })
    ).toBe(false)
    expect(
      taxControlTransitionWasApplied({
        ...baseline,
        currentGeneration: undefined,
      })
    ).toBe(false)
  })
})
