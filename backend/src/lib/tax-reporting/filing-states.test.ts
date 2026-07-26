import {
  filingBucketFor,
  filingStateName,
  TAX_FILING_PROFILES,
  TAX_FILING_STATES,
} from "./filing-states";
import type { TaxRecordDestination } from "./types";

const destination = (
  overrides: Partial<TaxRecordDestination> = {},
): TaxRecordDestination => ({
  city: "Pittsburgh",
  countryCode: "US",
  county: "Allegheny",
  jurisdictionLevel: null,
  jurisdictionName: null,
  postalCode: "15222",
  stateCode: "PA",
  ...overrides,
});

describe("tax filing states", () => {
  it("defines a complete operator profile for every supported state", () => {
    expect(Object.keys(TAX_FILING_PROFILES).sort()).toEqual([
      ...TAX_FILING_STATES,
    ]);
    for (const profile of Object.values(TAX_FILING_PROFILES)) {
      expect(profile.name).toBeTruthy();
      expect(profile.portalUrl).toMatch(/^https:\/\//);
      expect(profile.returnName).toBeTruthy();
    }
  });

  it.each([
    ["CT", destination({ stateCode: "CT" }), "Connecticut statewide"],
    ["NY", destination({ stateCode: "NY" }), "Allegheny"],
    ["PA", destination(), "Allegheny local"],
    [
      "PA",
      destination({
        city: "Philadelphia",
        county: null,
        postalCode: "19103",
      }),
      "Philadelphia local",
    ],
    [
      "PA",
      destination({
        city: "Erie",
        county: null,
        jurisdictionName: null,
        postalCode: "16501",
      }),
      "Pennsylvania locality — verify",
    ],
  ] as const)(
    "classifies the %s filing bucket",
    (filingState, value, expected) => {
      expect(
        filingBucketFor({ destination: value, filingState }),
      ).toBe(expected);
    },
  );

  it("names individual and consolidated scopes", () => {
    expect(filingStateName("CT")).toBe("Connecticut");
    expect(filingStateName("ALL")).toBe("All destinations");
  });
});
