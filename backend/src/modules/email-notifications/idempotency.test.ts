import {
  emailIdempotencyFields,
  emailProviderIdempotencyKey,
} from "./idempotency";

describe("email idempotency contract", () => {
  it("uses the same stable key for Medusa and the provider", () => {
    expect(emailIdempotencyFields("order-placed:order_01")).toEqual({
      idempotency_key: "order-placed:order_01",
      provider_data: {
        idempotency_key: "order-placed:order_01",
      },
    });
  });

  it.each(["", "contains spaces", "x".repeat(257)])(
    "rejects invalid key %p",
    (value) => {
      expect(() => emailIdempotencyFields(value)).toThrow(
        "email idempotency key is invalid",
      );
    },
  );

  it("does not accept malformed persisted provider data", () => {
    expect(
      emailProviderIdempotencyKey({ idempotency_key: "invalid value" }),
    ).toBeNull();
    expect(emailProviderIdempotencyKey(null)).toBeNull();
  });
});
