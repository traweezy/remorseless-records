import { Module } from "@medusajs/framework/utils";

import TaxControlModuleService from "./service";

const taxControlModule = Module("tax_control", {
  service: TaxControlModuleService,
});

export default taxControlModule;
