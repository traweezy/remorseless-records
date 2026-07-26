import { model } from "@medusajs/framework/utils";

const TaxProviderQuota = model.define(
  {
    name: "tax_provider_quota",
    tableName: "tax_provider_quotas",
  },
  {
    id: model.id({ prefix: "taxquota" }).primaryKey(),
    provider: model.text().unique(),
    usage: model.number(),
    quota: model.number(),
    remaining: model.number(),
    usage_percent: model.number(),
    observed_at: model.dateTime(),
    source: model.text(),
    metadata: model.json().default({}),
  },
);

export default TaxProviderQuota;
