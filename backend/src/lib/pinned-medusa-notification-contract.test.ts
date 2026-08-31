import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const notificationPackage = require.resolve(
  "@medusajs/notification/package.json"
)
const notificationRoot = dirname(notificationPackage)

const readPackageFile = (path: string): string =>
  readFileSync(join(notificationRoot, path), "utf8")

describe("pinned Medusa notification persistence contract", () => {
  it("retains the 2.18 idempotency, replay, and generated-update boundary", () => {
    const packageJson = JSON.parse(readPackageFile("package.json")) as {
      version?: unknown
    }
    const modelSource = readPackageFile("dist/models/notification.js")
    const serviceSource = readPackageFile(
      "dist/services/notification-module-service.js"
    )
    const serviceTypes = readPackageFile(
      "dist/services/notification-module-service.d.ts"
    )

    expect(packageJson.version).toBe("2.18.0")
    expect(modelSource).toContain(
      "idempotency_key: utils_1.model.text().unique().nullable()"
    )
    expect(serviceSource).toContain("idempotency_key: idempotencyKeys")
    expect(serviceSource).toContain(
      "return Array.isArray(data) ? serialized : serialized[0]"
    )
    expect(serviceSource).toContain(
      "const createdNotifications = toCreate.length"
    )
    expect(serviceTypes).toContain("NotificationModuleService_base")
    expect(serviceTypes).toContain("MedusaServiceReturnType")
  })
})
