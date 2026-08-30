import type { StripeTaxReadinessClient } from "./stripe-readiness-client";

jest.mock("../constants", () => ({
  STRIPE_API_KEY: "",
  STRIPE_TAX_SHIPPING_TAX_CODE: "txcd_92010001",
  TAX_RATE_LOOKUP_API_KEY: "",
}));

import { resolveStripeTaxReadiness } from "./readiness";

const settings = {
  defaults: {
    provider: "stripe",
    tax_behavior: "exclusive",
    tax_code: "txcd_99999999",
  },
  head_office: { address: { country: "US" } },
  livemode: false,
  object: "tax.settings",
  status: "active",
  status_details: { active: {} },
};

const registrations = {
  data: [
    {
      id: "taxreg_example",
      livemode: false,
      object: "tax.registration",
      status: "active",
    },
  ],
  has_more: false,
  object: "list",
};

const clientWith = ({
  list = jest.fn().mockResolvedValue(registrations),
  retrieve = jest.fn().mockResolvedValue(settings),
}: {
  list?: jest.Mock;
  retrieve?: jest.Mock;
} = {}): StripeTaxReadinessClient =>
  ({
    tax: {
      registrations: { list },
      settings: { retrieve },
    },
  }) as unknown as StripeTaxReadinessClient;

describe("Stripe Tax readiness", () => {
  it("returns an unconfigured result without contacting Stripe", async () => {
    const client = clientWith();

    await expect(
      resolveStripeTaxReadiness({ apiKey: "", client }),
    ).resolves.toMatchObject({
      accountMode: "unknown",
      configured: false,
      ready: false,
    });
    expect(client.tax.settings.retrieve).not.toHaveBeenCalled();
    expect(client.tax.registrations.list).not.toHaveBeenCalled();
  });

  it("reports ready only after every validated Stripe check passes", async () => {
    const client = clientWith();

    await expect(
      resolveStripeTaxReadiness({ apiKey: "sk_test_safe", client }),
    ).resolves.toMatchObject({
      accountMode: "sandbox",
      activeRegistrationCount: 1,
      configured: true,
      message: "Stripe Tax is ready in sandbox.",
      missingFields: [],
      ready: true,
    });
  });

  it("fails readiness when Stripe reports pending setup", async () => {
    const retrieve = jest.fn().mockResolvedValue({
      ...settings,
      head_office: null,
      status: "pending",
      status_details: {
        pending: { missing_fields: ["head_office"] },
      },
    });

    await expect(
      resolveStripeTaxReadiness({
        apiKey: "sk_test_safe",
        client: clientWith({ retrieve }),
      }),
    ).resolves.toMatchObject({
      message: "Stripe Tax sandbox setup is incomplete.",
      missingFields: ["head_office"],
      ready: false,
    });
  });

  it("fails readiness when the key prefix and Stripe mode disagree", async () => {
    await expect(
      resolveStripeTaxReadiness({
        apiKey: "sk_live_safe",
        client: clientWith(),
      }),
    ).resolves.toMatchObject({
      accountMode: "sandbox",
      message: "Stripe Tax sandbox setup is incomplete.",
      ready: false,
    });
  });

  it("logs only fixed retry metadata", async () => {
    const secret = "provider-message-must-not-be-logged";
    const logger = { warn: jest.fn() };
    const retrieve = jest
      .fn()
      .mockRejectedValueOnce({ message: secret, statusCode: 503 })
      .mockResolvedValueOnce(settings);

    await expect(
      resolveStripeTaxReadiness({
        apiKey: "sk_test_safe",
        client: clientWith({ retrieve }),
        logger,
      }),
    ).resolves.toMatchObject({ ready: true });
    expect(logger.warn).toHaveBeenCalledWith(
      "[tax-control] Stripe Tax settings readiness retry scheduled (status, attempt 2/2).",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(secret);
  });

  it("returns a fixed unavailable result for provider failures", async () => {
    const retrieve = jest.fn().mockRejectedValue({
      message: "provider detail must stay private",
      statusCode: 400,
    });

    await expect(
      resolveStripeTaxReadiness({
        apiKey: "sk_test_safe",
        client: clientWith({ retrieve }),
      }),
    ).resolves.toEqual({
      accountMode: "sandbox",
      activeRegistrationCount: 0,
      checks: [
        {
          detail:
            "Stripe Tax settings could not be read. Verify the key and try again.",
          id: "api_connection",
          label: "Stripe connection",
          ready: false,
        },
      ],
      configured: true,
      message: "Stripe Tax readiness could not be verified.",
      missingFields: [],
      ready: false,
    });
  });
});
