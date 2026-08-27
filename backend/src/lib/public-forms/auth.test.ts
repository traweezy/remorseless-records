import {
  PUBLIC_FORM_PROOF_MAX_SKEW_SECONDS,
  createPublicFormProof,
  verifyPublicFormProof,
} from "./auth";

const secret = ["unit", "test", "public", "form", "key"].join("-").repeat(2);
const alternateSecret = ["alternate", "public", "form", "key"]
  .join("-")
  .repeat(2);
const body = JSON.stringify({
  name: "Test Person",
  email: "person@example.com",
  reason: "other",
  message: "A deterministic public form payload.",
  honeypot: "",
});
const timestamp = 1_800_000_000;

describe("public-form BFF proof", () => {
  it("creates and verifies the shared deterministic fixture", () => {
    const proof = createPublicFormProof({
      body,
      purpose: "contact",
      secret,
      timestamp,
    });

    expect(proof).toBe("jjSQ7TKiv-TAwlb8PDvCY6Q5cQufbH7aAAENcCUNJfE");
    expect(
      verifyPublicFormProof({
        body,
        purpose: "contact",
        secret,
        timestamp,
        proof,
        nowSeconds: timestamp,
      }),
    ).toBe(true);
  });

  it.each([
    ["another body", `${body} `, "contact", timestamp, secret],
    ["another purpose", body, "privacy-request", timestamp, secret],
    ["another time", body, "contact", timestamp + 1, secret],
    ["another secret", body, "contact", timestamp, alternateSecret],
  ] as const)(
    "rejects a proof reused with %s",
    (_label, nextBody, purpose, nextTimestamp, key) => {
      const proof = createPublicFormProof({
        body,
        purpose: "contact",
        secret,
        timestamp,
      });

      expect(
        verifyPublicFormProof({
          body: nextBody,
          purpose,
          secret: key,
          timestamp: nextTimestamp,
          proof,
          nowSeconds: timestamp,
        }),
      ).toBe(false);
    },
  );

  it.each([
    timestamp - PUBLIC_FORM_PROOF_MAX_SKEW_SECONDS - 1,
    timestamp + PUBLIC_FORM_PROOF_MAX_SKEW_SECONDS + 1,
  ])("rejects a timestamp outside the replay window: %d", (nowSeconds) => {
    const proof = createPublicFormProof({
      body,
      purpose: "contact",
      secret,
      timestamp,
    });

    expect(
      verifyPublicFormProof({
        body,
        purpose: "contact",
        secret,
        timestamp,
        proof,
        nowSeconds,
      }),
    ).toBe(false);
  });

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
      }),
    ).toThrow();
  });

  it("accepts a proof signed by the previous key during rotation", () => {
    const proof = createPublicFormProof({
      body,
      purpose: "contact",
      secret: alternateSecret,
      timestamp,
    });

    expect(
      verifyPublicFormProof({
        body,
        purpose: "contact",
        secret,
        previousSecret: alternateSecret,
        timestamp,
        proof,
        nowSeconds: timestamp,
      }),
    ).toBe(true);
  });
});
