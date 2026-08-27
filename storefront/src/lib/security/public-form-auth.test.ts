import { describe, expect, it } from "vitest"

import { createPublicFormProof } from "@/lib/security/public-form-auth"

const secret = ["unit", "test", "public", "form", "key"].join("-").repeat(2)
const body = JSON.stringify({
  name: "Test Person",
  email: "person@example.com",
  reason: "other",
  message: "A deterministic public form payload.",
  honeypot: "",
})
const timestamp = 1_800_000_000

describe("public-form BFF proof", () => {
  it("matches the Backend proof fixture exactly", () => {
    expect(
      createPublicFormProof({
        body,
        purpose: "contact",
        secret,
        timestamp,
      })
    ).toBe("jjSQ7TKiv-TAwlb8PDvCY6Q5cQufbH7aAAENcCUNJfE")
  })

  it("binds the proof to its purpose, body, and timestamp", () => {
    const proof = createPublicFormProof({
      body,
      purpose: "contact",
      secret,
      timestamp,
    })

    expect(
      createPublicFormProof({
        body,
        purpose: "privacy-request",
        secret,
        timestamp,
      })
    ).not.toBe(proof)
    expect(
      createPublicFormProof({
        body: `${body} `,
        purpose: "contact",
        secret,
        timestamp,
      })
    ).not.toBe(proof)
    expect(
      createPublicFormProof({
        body,
        purpose: "contact",
        secret,
        timestamp: timestamp + 1,
      })
    ).not.toBe(proof)
  })

  it.each([
    ["empty body", "", timestamp, secret],
    ["invalid timestamp", body, 0, secret],
    ["short secret", body, timestamp, "too-short"],
  ])("refuses to sign an %s", (_label, nextBody, nextTimestamp, key) => {
    expect(() =>
      createPublicFormProof({
        body: nextBody,
        purpose: "contact",
        secret: key,
        timestamp: nextTimestamp,
      })
    ).toThrow()
  })
})
