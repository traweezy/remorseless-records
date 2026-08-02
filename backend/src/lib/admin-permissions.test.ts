import {
  adminPermissionKey,
  adminPolicyOperations,
  contentAdminActions,
  contentAdminPolicyDefinitions,
  contentAdminResources,
  contentReadPermissionKeys,
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
