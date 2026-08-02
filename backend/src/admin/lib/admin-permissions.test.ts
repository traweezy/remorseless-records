import {
  adminPermissionKey,
  contentAdminActions,
} from "../../lib/admin-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
  isAdminPermissionGranted,
} from "./admin-permissions"

describe("Admin permission client", () => {
  it("uses Medusa Dashboard's native cache keys", () => {
    expect(adminFeatureFlagsQueryKey).toEqual(["admin", "feature-flags"])
    expect(adminPermissionsQueryKey).toEqual(["me-permissions"])
  })

  it("preserves current access while RBAC is disabled", () => {
    expect(
      isAdminPermissionGranted(
        false,
        new Set(),
        contentAdminActions.news.delete,
      ),
    ).toBe(true)
  })

  it("requires an exact effective permission while RBAC is enabled", () => {
    const permissions = new Set([
      adminPermissionKey(contentAdminActions.news.read),
    ])

    expect(
      isAdminPermissionGranted(
        true,
        permissions,
        contentAdminActions.news.read,
      ),
    ).toBe(true)
    expect(
      isAdminPermissionGranted(
        true,
        permissions,
        contentAdminActions.news.update,
      ),
    ).toBe(false)
  })
})
