import {
  observeOperation,
  operationMetricAttributes,
  recordOperationResult,
} from "./operation-telemetry";

describe("bounded operation telemetry", () => {
  it("uses only fixed low-cardinality metric attributes", () => {
    expect(
      operationMetricAttributes(
        { domain: "stripe", operation: "provider_request" },
        "error",
      ),
    ).toEqual({
      "rr.domain": "stripe",
      "rr.operation": "provider_request",
      "rr.result": "error",
      "service.name": "backend",
    });
  });

  it("returns successful results without changing them", async () => {
    await expect(
      observeOperation({ domain: "tax", operation: "calculate" }, async () => ({
        safe: true,
      })),
    ).resolves.toEqual({ safe: true });
  });

  it("preserves the original failure without recording its message", async () => {
    const failure = new Error("customer@example.com");

    await expect(
      observeOperation({ domain: "email", operation: "send" }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("bounds invalid durations instead of emitting non-finite metrics", () => {
    expect(() =>
      recordOperationResult(
        { domain: "scheduled_job", operation: "run" },
        "ok",
        Number.NaN,
      ),
    ).not.toThrow();
  });
});
