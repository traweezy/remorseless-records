import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { GET } from "@/app/checkout/return/route"

describe("GET /checkout/return", () => {
  it("strips all provider parameters before rendering recovery UI", () => {
    const request = new NextRequest(
      "https://storefront.test/checkout/return?payment_intent=pi_private&payment_intent_client_secret=secret_private&redirect_status=succeeded"
    )

    const response = GET(request)

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://storefront.test/checkout/recover"
    )
    expect(response.headers.get("location")).not.toContain("pi_private")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("cache-control")).toContain("no-store")
  })
})
