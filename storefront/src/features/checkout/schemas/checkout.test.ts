import { describe, expect, it } from "vitest"

import {
  checkoutAddressSchema,
  checkoutContactSchema,
  checkoutRevisionSchema,
} from "@/features/checkout/schemas/checkout"

const address = {
  first_name: " Test ",
  last_name: " Buyer ",
  address_1: " 354 Oyster Point Boulevard ",
  city: " South San Francisco ",
  province: " ca ",
  postal_code: "94080-1234",
  country_code: "US",
}

describe("checkout boundary schemas", () => {
  it("normalizes a complete US address", () => {
    expect(checkoutAddressSchema.parse(address)).toEqual({
      first_name: "Test",
      last_name: "Buyer",
      address_1: "354 Oyster Point Boulevard",
      city: "South San Francisco",
      province: "CA",
      postal_code: "94080-1234",
      country_code: "us",
    })
  })

  it.each(["XX", "California", "", "ca1"])(
    "rejects invalid state %s",
    (province) => {
      expect(
        checkoutAddressSchema.safeParse({ ...address, province }).success
      ).toBe(false)
    }
  )

  it.each(["9408", "940800", "A4080", "94080-123"])(
    "rejects invalid ZIP %s",
    (postal_code) => {
      expect(
        checkoutAddressSchema.safeParse({ ...address, postal_code }).success
      ).toBe(false)
    }
  )

  it("fixes checkout to the configured US region", () => {
    expect(
      checkoutAddressSchema.safeParse({
        ...address,
        country_code: "ca",
      }).success
    ).toBe(false)
  })

  it("accepts an email but rejects unknown contact fields", () => {
    expect(
      checkoutContactSchema.parse({ email: " buyer@example.test " })
    ).toEqual({ email: "buyer@example.test" })
    expect(
      checkoutContactSchema.safeParse({
        email: "buyer@example.test",
        cart_id: "cart_injected",
      }).success
    ).toBe(false)
  })

  it("accepts only opaque v1 revisions", () => {
    expect(
      checkoutRevisionSchema.safeParse({
        revision: `v1.${"a".repeat(43)}`,
      }).success
    ).toBe(true)
    expect(
      checkoutRevisionSchema.safeParse({ revision: "cart_01ABC" }).success
    ).toBe(false)
  })
})
