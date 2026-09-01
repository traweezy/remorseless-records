import type { ILockingModule } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import type { Knex } from "@mikro-orm/knex"
import { createClient } from "redis"

import { PAYMENT_LIFECYCLE_MODULE } from "../src/modules/payment-lifecycle/constants"
import type PaymentLifecycleModuleService from "../src/modules/payment-lifecycle/service"

const databaseName = "rr_disposable_integration"
const redisUrl = process.env.REDIS_URL?.trim()

if (process.env.INTEGRATION_TESTS_ENABLED !== "1") {
  throw new Error(
    "Disposable integration tests require INTEGRATION_TESTS_ENABLED=1."
  )
}
if (!redisUrl) {
  throw new Error("Disposable integration tests require REDIS_URL.")
}

const recordFrom = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

medusaIntegrationTestRunner({
  cwd: process.cwd(),
  dbName: databaseName,
  env: {
    INTEGRATION_TESTS_ENABLED: "1",
    NODE_ENV: "test",
    REDIS_URL: redisUrl,
  },
  moduleName: "RemorselessDisposableInfrastructure",
  testSuite: ({ api, getContainer }) => {
    describe("disposable PostgreSQL and Redis integration", () => {
      it("boots the real API with healthy disposable dependencies", async () => {
        const responses: unknown[] = await Promise.all([
          api.get("/live"),
          api.get("/ready"),
          api.get("/api/health"),
        ])

        for (const response of responses) {
          expect(recordFrom(response, "HTTP response").status).toBe(200)
        }
        const readinessResponse = recordFrom(responses[1], "Readiness response")
        const readiness = recordFrom(readinessResponse.data, "Readiness body")
        expect(readiness.status).toBe("ok")
        if (!Array.isArray(readiness.checks)) {
          throw new TypeError("Readiness checks must be an array.")
        }
        const checks = readiness.checks.map((check) => {
          const record = recordFrom(check, "Readiness check")
          return { name: record.name, status: record.status }
        })
        expect(checks).toEqual(
          expect.arrayContaining([
            { name: "database", status: "ok" },
            { name: "redis", status: "ok" },
          ])
        )
      })

      it("applies custom migrations and preserves the safe tax default", async () => {
        const database = getContainer().resolve<Knex>(
          ContainerRegistrationKeys.PG_CONNECTION
        )
        const tableResult = await database.raw<{
          rows: Array<{ table_name: string }>
        }>(
          `select table_name
           from information_schema.tables
           where table_schema = 'public'
             and table_name = any (?)
           order by table_name`,
          [
            [
              "stripe_lifecycle_events",
              "tax_provider_audits",
              "tax_provider_controls",
              "tax_quote_evidences",
            ],
          ]
        )
        expect(tableResult.rows.map(({ table_name }) => table_name)).toEqual([
          "stripe_lifecycle_events",
          "tax_provider_audits",
          "tax_provider_controls",
          "tax_quote_evidences",
        ])

        const controlResult = await database.raw<{
          rows: Array<{
            collection_mode: string
            generation: number
            last_switched_by: string | null
          }>
        }>(
          `select collection_mode, generation, last_switched_by
           from tax_provider_controls
           where id = 'taxctrl_default'`
        )
        expect(controlResult.rows).toEqual([
          {
            collection_mode: "disabled",
            generation: 2,
            last_switched_by: "system:migration",
          },
        ])

        const defaultResult = await database.raw<{
          rows: Array<{ column_default: string | null }>
        }>(
          `select column_default
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'tax_provider_controls'
             and column_name = 'collection_mode'`
        )
        expect(defaultResult.rows[0]?.column_default).toContain("disabled")

        const auditResult = await database.raw<{
          rows: Array<{
            acknowledgement_version: string
            from_collection_mode: string
            to_collection_mode: string
          }>
        }>(
          `select acknowledgement_version,
                  from_collection_mode,
                  to_collection_mode
           from tax_provider_audits
           where idempotency_key = '00000000-0000-4000-8000-000000000901'`
        )
        expect(auditResult.rows).toEqual([
          {
            acknowledgement_version: "tax-collection-safe-default-2026-09-01",
            from_collection_mode: "collect",
            to_collection_mode: "disabled",
          },
        ])
      })

      it("persists an idempotent payment failure and bounded retry", async () => {
        const service = getContainer().resolve<PaymentLifecycleModuleService>(
          PAYMENT_LIFECYCLE_MODULE
        )
        const receipt = {
          amountMinor: 2_500,
          chargeId: "ch_disposable",
          currencyCode: "usd" as const,
          eventCreatedAt: new Date("2026-09-01T12:00:00.000Z"),
          eventType: "refund.created" as const,
          livemode: false,
          objectId: "re_disposable",
          paymentIntentId: "pi_disposable",
          providerEventId: "evt_disposable",
          providerObjectStatus: "succeeded",
        }

        const first = await service.recordStripeLifecycleEvent(receipt)
        const replay = await service.recordStripeLifecycleEvent(receipt)
        expect(first.replayed).toBe(false)
        expect(replay).toEqual({
          lifecycleEvent: first.lifecycleEvent,
          replayed: true,
        })

        await expect(
          service.recordStripeLifecycleEvent({
            ...receipt,
            amountMinor: receipt.amountMinor + 1,
          })
        ).rejects.toThrow(
          "The Stripe event ID is already bound to different lifecycle data."
        )

        const processing = await service.markStripeLifecycleEventProcessing(
          first.lifecycleEvent.id
        )
        expect(processing).toEqual(
          expect.objectContaining({ attempt_count: 1, status: "processing" })
        )
        const failed = await service.markStripeLifecycleEventFailed(
          first.lifecycleEvent.id,
          "event_bus_unavailable"
        )
        expect(failed).toEqual(
          expect.objectContaining({
            attempt_count: 1,
            last_error_code: "event_bus_unavailable",
            status: "failed",
          })
        )
        expect(failed.next_retry_at?.getTime()).toBeGreaterThan(Date.now())
      })

      it("serializes distributed work and reacquires after release", async () => {
        const locking = getContainer().resolve<ILockingModule>(Modules.LOCKING)
        let active = 0
        let maximumActive = 0
        const runLocked = async (): Promise<void> => {
          await locking.execute(
            "integration:queue-recovery",
            async () => {
              active += 1
              maximumActive = Math.max(maximumActive, active)
              await new Promise<void>((resolve) => {
                setTimeout(resolve, 40)
              })
              active -= 1
            },
            { timeout: 5 }
          )
        }

        await Promise.all([runLocked(), runLocked()])
        expect(active).toBe(0)
        expect(maximumActive).toBe(1)

        const redis = createClient({
          disableOfflineQueue: true,
          socket: { connectTimeout: 2_000, reconnectStrategy: false },
          url: redisUrl,
        })
        redis.on("error", () => undefined)
        const key = "rr:integration:queue-recovery"
        try {
          await redis.connect()
          await redis.del(key)
          await expect(
            redis.set(key, "first", { EX: 30, NX: true })
          ).resolves.toBe("OK")
          await expect(
            redis.set(key, "duplicate", { EX: 30, NX: true })
          ).resolves.toBeNull()
          await expect(redis.get(key)).resolves.toBe("first")
          await expect(redis.ttl(key)).resolves.toBeGreaterThan(0)
          await redis.del(key)
          await expect(
            redis.set(key, "recovered", { EX: 30, NX: true })
          ).resolves.toBe("OK")
        } finally {
          if (redis.isOpen) {
            await redis.del(key)
            await redis.quit()
          }
        }
      })
    })
  },
})
