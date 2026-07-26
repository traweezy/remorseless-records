import { model } from "@medusajs/framework/utils";

import { taxProviderNames } from "../constants";

const TaxProviderAudit = model.define(
  {
    name: "tax_provider_audit",
    tableName: "tax_provider_audits",
  },
  {
    id: model.id({ prefix: "taxaudit" }).primaryKey(),
    idempotency_key: model.text().unique(),
    actor_id: model.text(),
    from_provider: model.enum([...taxProviderNames]),
    to_provider: model.enum([...taxProviderNames]),
    from_generation: model.number(),
    to_generation: model.number(),
    reason: model.text(),
    metadata: model.json().default({}),
  },
);

export default TaxProviderAudit;
