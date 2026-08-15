import { Modules } from "@medusajs/framework/utils";

import {
  isAdminRbacEnabled,
  resolveAdminRbacModuleConfig,
} from "./admin-rbac-config";

describe("Admin RBAC module configuration", () => {
  it.each([true, "true", "TRUE", "True"] as const)(
    "enables the module when Medusa enables the feature for %s",
    (value) => {
      expect(isAdminRbacEnabled(value)).toBe(true);
      expect(
        resolveAdminRbacModuleConfig(value, { requireEnabled: false }),
      ).toEqual({
        disable: false,
        key: Modules.RBAC,
        resolve: "@medusajs/medusa/rbac",
      });
    },
  );

  it.each([false, undefined, "", "false", "1", " true "] as const)(
    "keeps the module disabled when Medusa disables the feature for %s",
    (value) => {
      expect(isAdminRbacEnabled(value)).toBe(false);
      expect(
        resolveAdminRbacModuleConfig(value, { requireEnabled: false }),
      ).toEqual({
        disable: true,
        key: Modules.RBAC,
        resolve: "@medusajs/medusa/rbac",
      });
    },
  );

  it.each([false, undefined, "", "false", "1", " true "] as const)(
    "fails closed when production receives %s",
    (value) => {
      expect(() =>
        resolveAdminRbacModuleConfig(value, { requireEnabled: true }),
      ).toThrow("MEDUSA_FF_RBAC must be set to true in production.");
    },
  );

  it("allows an explicitly enabled production configuration", () => {
    expect(
      resolveAdminRbacModuleConfig("true", { requireEnabled: true }),
    ).toEqual({
      disable: false,
      key: Modules.RBAC,
      resolve: "@medusajs/medusa/rbac",
    });
  });
});
