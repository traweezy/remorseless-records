import { Modules } from "@medusajs/framework/utils";

import {
  isAdminRbacEnabled,
  resolveAdminRbacModuleConfig,
} from "./admin-rbac-config";

describe("Admin RBAC module configuration", () => {
  it.each(["true", "TRUE", "True"])(
    "enables the module when Medusa enables the feature for %s",
    (value) => {
      expect(isAdminRbacEnabled(value)).toBe(true);
      expect(resolveAdminRbacModuleConfig(value)).toEqual({
        disable: false,
        key: Modules.RBAC,
        resolve: "@medusajs/medusa/rbac",
      });
    },
  );

  it.each([undefined, "", "false", "1", " true "])(
    "keeps the module disabled when Medusa disables the feature for %s",
    (value) => {
      expect(isAdminRbacEnabled(value)).toBe(false);
      expect(resolveAdminRbacModuleConfig(value)).toEqual({
        disable: true,
        key: Modules.RBAC,
        resolve: "@medusajs/medusa/rbac",
      });
    },
  );
});
