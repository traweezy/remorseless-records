import {
  adminPermissionKey,
  adminPolicyOperations,
  contentAdminActions,
  contentAdminPolicyDefinitions,
  contentAdminResources,
  contentReadPermissionKeys,
  operationsAdminActions,
  operationsAdminPolicyDefinitions,
  operationsAdminResources,
  operationsReadPermissionKeys,
} from "./admin-permissions";

describe("content Admin permission contract", () => {
  it("defines each CRUD operation once for each content resource", () => {
    expect(contentAdminPolicyDefinitions).toHaveLength(8);

    const keys = contentAdminPolicyDefinitions.map(adminPermissionKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      new Set(contentAdminPolicyDefinitions.map(({ name }) => name)).size,
    ).toBe(contentAdminPolicyDefinitions.length);
    expect(new Set(keys)).toEqual(
      new Set(
        Object.values(contentAdminResources).flatMap((resource) =>
          Object.values(adminPolicyOperations).map(
            (operation) => `${resource}:${operation}`,
          ),
        ),
      ),
    );
  });

  it("uses stable native-compatible permission keys", () => {
    expect(adminPermissionKey(contentAdminActions.news.update)).toBe(
      "news:update",
    );
    expect(adminPermissionKey(contentAdminActions.discography.read)).toBe(
      "discography:read",
    );
    expect(contentReadPermissionKeys).toEqual([
      "news:read",
      "discography:read",
    ]);
  });
});

describe("operations Admin permission contract", () => {
  it("defines the six least-privilege operations policies exactly once", () => {
    expect(operationsAdminPolicyDefinitions).toHaveLength(6);

    const keys = operationsAdminPolicyDefinitions.map(adminPermissionKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      new Set(operationsAdminPolicyDefinitions.map(({ name }) => name)).size,
    ).toBe(operationsAdminPolicyDefinitions.length);
    expect(new Set(keys)).toEqual(
      new Set([
        "tax_control:read",
        "tax_control:update",
        "tax_records:read",
        "refund_operations:read",
        "media_cleanup:read",
        "media_cleanup:update",
      ]),
    );
  });

  it("keeps view-only and state-changing capabilities separate", () => {
    expect(adminPermissionKey(operationsAdminActions.taxControl.read)).toBe(
      "tax_control:read",
    );
    expect(adminPermissionKey(operationsAdminActions.taxControl.update)).toBe(
      "tax_control:update",
    );
    expect(
      adminPermissionKey(operationsAdminActions.mediaCleanup.update),
    ).toBe("media_cleanup:update");
    expect(Object.values(operationsAdminResources)).toEqual([
      "media_cleanup",
      "refund_operations",
      "tax_control",
      "tax_records",
    ]);
    expect(operationsReadPermissionKeys).toEqual([
      "tax_control:read",
      "tax_records:read",
      "refund_operations:read",
      "media_cleanup:read",
    ]);
  });
});
