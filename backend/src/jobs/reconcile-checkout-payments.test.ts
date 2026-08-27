import type {
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";

import { CHECKOUT_RECONCILIATION_JOB_LOCK } from "../lib/checkout/reconciliation";
import reconcileCheckoutPaymentsJob from "./reconcile-checkout-payments";

const managedEnvironmentKeys = [
  "CHECKOUT_RECONCILIATION_ENABLED",
  "CHECKOUT_RECONCILIATION_MAX_ATTEMPTS",
  "CHECKOUT_RECONCILIATION_MAX_RUN_SECONDS",
  "CHECKOUT_RECONCILIATION_MAX_SCAN",
  "CHECKOUT_RECONCILIATION_MIN_AGE_SECONDS",
] as const;

const originalEnvironment = Object.fromEntries(
  managedEnvironmentKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof managedEnvironmentKeys)[number], string | undefined>;

const parseEvent = (write: jest.Mock): Record<string, unknown> =>
  JSON.parse(write.mock.calls[0]?.[0] ?? "{}") as Record<string, unknown>;

const fixtures = () => {
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
  const lockingService = {
    acquire: jest.fn(
      async (
        _keys: string | string[],
        _args?: { expire?: number; ownerId?: string | null },
      ): Promise<void> => undefined,
    ),
    release: jest.fn(
      async (
        _keys: string | string[],
        _args?: { ownerId?: string | null },
      ): Promise<boolean> => true,
    ),
  };
  const query = {
    graph: jest.fn(async () => ({ data: [] })),
  };
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "logger") {
        return logger as unknown as Logger;
      }
      if (key === Modules.LOCKING) {
        return lockingService as unknown as ILockingModule;
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return query;
      }
      throw new Error(`Unexpected container key: ${key}`);
    }),
  } as unknown as MedusaContainer;

  return { container, lockingService, logger, query };
};

describe("checkout reconciliation scheduled job", () => {
  beforeEach(() => {
    for (const key of managedEnvironmentKeys) {
      delete process.env[key];
    }
    process.env.CHECKOUT_RECONCILIATION_ENABLED = "true";
  });

  afterAll(() => {
    for (const key of managedEnvironmentKeys) {
      const value = originalEnvironment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("uses an owned lock and emits a bounded structured completion", async () => {
    const fixture = fixtures();

    await reconcileCheckoutPaymentsJob(fixture.container, {
      scheduledFor: new Date(),
    });

    expect(fixture.lockingService.acquire).toHaveBeenCalledWith(
      CHECKOUT_RECONCILIATION_JOB_LOCK,
      {
        expire: 300,
        ownerId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      },
    );
    const ownerId = fixture.lockingService.acquire.mock.calls[0]?.[1]?.ownerId;
    expect(fixture.lockingService.release).toHaveBeenCalledWith(
      CHECKOUT_RECONCILIATION_JOB_LOCK,
      { ownerId },
    );
    expect(fixture.query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ pagination: { order: { updated_at: "DESC" }, take: 2_000 } }),
    );
    expect(fixture.logger.info).toHaveBeenCalledTimes(1);
    expect(parseEvent(fixture.logger.info)).toMatchObject({
      event: "job.checkout_reconciliation.completed",
      lock_released: true,
      message: "Checkout reconciliation completed",
      scanWindowFull: false,
      scanned: 0,
      service: "backend",
      timeCapped: false,
    });
  });

  it("warns when scheduler delay crosses the former lock window", async () => {
    const fixture = fixtures();

    await reconcileCheckoutPaymentsJob(fixture.container, {
      scheduledFor: new Date(Date.now() - 35_000),
    });

    const event = parseEvent(fixture.logger.warn);
    expect(event).toMatchObject({
      event: "job.checkout_reconciliation.attention",
      message: "Checkout reconciliation needs attention",
    });
    expect(event.schedule_delay_ms).toEqual(expect.any(Number));
    expect(event.schedule_delay_ms as number).toBeGreaterThanOrEqual(35_000);
  });

  it("skips an overlapping retry without releasing another owner's lock", async () => {
    const fixture = fixtures();
    fixture.lockingService.acquire.mockRejectedValue(
      new MedusaError(MedusaError.Types.CONFLICT, "private lock detail"),
    );

    await reconcileCheckoutPaymentsJob(fixture.container, {
      scheduledFor: new Date(),
    });

    expect(fixture.query.graph).not.toHaveBeenCalled();
    expect(fixture.lockingService.release).not.toHaveBeenCalled();
    expect(parseEvent(fixture.logger.warn)).toMatchObject({
      event: "job.checkout_reconciliation.skipped",
      message: "Checkout reconciliation skipped because a run holds the lock",
      reason: "lock_held",
    });
    expect(fixture.logger.warn.mock.calls[0]?.[0]).not.toContain(
      "private lock detail",
    );
  });

  it("redacts reconciliation failures and releases the owned lock", async () => {
    const fixture = fixtures();
    fixture.query.graph.mockRejectedValue(
      new Error("provider failure for private@example.com"),
    );

    await expect(
      reconcileCheckoutPaymentsJob(fixture.container, {
        scheduledFor: new Date(),
      }),
    ).rejects.toThrow("provider failure");

    expect(fixture.lockingService.release).toHaveBeenCalledTimes(1);
    expect(parseEvent(fixture.logger.error)).toMatchObject({
      event: "job.checkout_reconciliation.failed",
      failure_stage: "reconciliation",
      lock_released: true,
      message: "Checkout reconciliation failed",
    });
    expect(fixture.logger.error.mock.calls[0]?.[0]).not.toContain(
      "private@example.com",
    );
  });
});
