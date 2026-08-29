import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import {
  createCheckoutStatusProof,
  createCheckoutTaxLinkProof,
} from "../../../../lib/checkout/internal-status-auth";
import { bindCheckoutTaxToPayment } from "../../../../lib/tax-control/payment-binding";

import { POST } from "./route";

jest.mock("../../../../lib/tax-control/payment-binding", () => ({
  bindCheckoutTaxToPayment: jest.fn(),
}));
jest.mock("../../../../lib/constants", () => ({
  STRIPE_API_KEY: "synthetic-stripe-unit-test-key",
}));

const bindingMock = bindCheckoutTaxToPayment as jest.MockedFunction<
  typeof bindCheckoutTaxToPayment
>;
const secret = ["unit", "test", "checkout", "key"].join("-").repeat(2);
const cartId = "cart_01K123ABC";
const originalSecret = process.env.CHECKOUT_BFF_SECRET;
const originalStripeKey = process.env.STRIPE_API_KEY;

type ResponseState = {
  body: unknown;
  headers: Record<string, string>;
  status: number;
};

const responseFixture = (): {
  res: MedusaResponse;
  state: ResponseState;
} => {
  const state: ResponseState = { body: null, headers: {}, status: 200 };
  const response = {} as MedusaResponse;
  response.setHeader = jest.fn((name: string, value: string) => {
    state.headers[name.toLowerCase()] = value;
    return response;
  }) as MedusaResponse["setHeader"];
  response.status = jest.fn((status: number) => {
    state.status = status;
    return response;
  }) as MedusaResponse["status"];
  response.json = jest.fn((body: unknown) => {
    state.body = body;
    return response;
  }) as MedusaResponse["json"];
  return { res: response, state };
};

const requestFixture = ({
  proof,
  timestamp = Math.floor(Date.now() / 1000),
}: {
  proof?: string;
  timestamp?: number;
} = {}) => {
  const cart = { id: cartId };
  const query = { graph: jest.fn(async () => ({ data: [cart] })) };
  const service = {};
  const locking = {
    execute: jest.fn(async (_key: string, operation: () => Promise<unknown>) =>
      operation(),
    ),
  };
  const resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) {
      return query;
    }
    if (key === Modules.LOCKING) {
      return locking;
    }
    if (key === "tax_control") {
      return service;
    }
    throw new Error(`Unexpected dependency: ${key}`);
  });

  return {
    cart,
    locking,
    query,
    req: {
      body: { cart_id: cartId },
      headers: {
        ...(proof ? { "x-rr-checkout-proof": proof } : {}),
        "x-rr-checkout-timestamp": String(timestamp),
      },
      scope: { resolve },
    } as unknown as MedusaStoreRequest,
    resolve,
    service,
  };
};

beforeEach(() => {
  process.env.CHECKOUT_BFF_SECRET = secret;
  process.env.STRIPE_API_KEY = "synthetic-stripe-unit-test-key";
  bindingMock.mockReset();
  bindingMock.mockResolvedValue({
    generation: 3,
    provider: "stripe_tax",
    replayed: false,
  });
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.CHECKOUT_BFF_SECRET;
  } else {
    process.env.CHECKOUT_BFF_SECRET = originalSecret;
  }
  if (originalStripeKey === undefined) {
    delete process.env.STRIPE_API_KEY;
  } else {
    process.env.STRIPE_API_KEY = originalStripeKey;
  }
});

describe("POST /store/checkout/tax-link", () => {
  it("binds a cart only with a valid purpose-specific proof", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const proof = createCheckoutTaxLinkProof({
      cartId,
      timestamp,
      secret,
    });
    const fixture = requestFixture({ proof, timestamp });
    const { res, state } = responseFixture();

    await POST(fixture.req, res);

    expect(state).toEqual({
      body: {
        generation: 3,
        linked: true,
        provider: "stripe_tax",
        replayed: false,
      },
      headers: { "cache-control": "no-store" },
      status: 200,
    });
    expect(fixture.locking.execute).toHaveBeenCalledTimes(1);
    expect(fixture.query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "cart",
        fields: expect.arrayContaining([
          "credit_lines.amount",
          "credit_lines.raw_amount",
          "items.quantity",
          "items.unit_price",
          "items.raw_unit_price",
          "items.is_tax_inclusive",
          "items.adjustments.amount",
          "items.adjustments.raw_amount",
          "items.adjustments.is_tax_inclusive",
          "items.tax_lines.rate",
          "shipping_methods.amount",
          "shipping_methods.raw_amount",
          "shipping_methods.is_tax_inclusive",
          "shipping_methods.adjustments.amount",
          "shipping_methods.adjustments.raw_amount",
          "shipping_methods.tax_lines.rate",
        ]),
        filters: { id: cartId },
      }),
    );
    expect(bindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cart: fixture.cart,
        service: fixture.service,
      }),
    );
  });

  it("rejects a status proof replay before resolving dependencies", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const proof = createCheckoutStatusProof({
      cartId,
      timestamp,
      secret,
    });
    const fixture = requestFixture({ proof, timestamp });
    const { res } = responseFixture();

    await expect(POST(fixture.req, res)).rejects.toThrow(
      "proof is missing or invalid",
    );
    expect(fixture.resolve).not.toHaveBeenCalled();
  });
});
