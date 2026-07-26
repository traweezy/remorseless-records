import { model } from "@medusajs/framework/utils";

import { taxProviderNames, taxQuoteEvidenceStatuses } from "../constants";

const TaxQuoteEvidence = model.define(
  {
    name: "tax_quote_evidence",
    tableName: "tax_quote_evidences",
  },
  {
    id: model.id({ prefix: "taxevidence" }).primaryKey(),
    cart_id: model.text().index(),
    order_id: model.text().index().nullable(),
    provider: model.enum([...taxProviderNames]),
    generation: model.number(),
    fingerprint: model.text().index(),
    calculation_id: model.text().nullable(),
    payment_intent_id: model.text().unique(),
    amount_minor: model.number(),
    currency_code: model.text(),
    status: model.enum([...taxQuoteEvidenceStatuses]).default("prepared"),
    linked_at: model.dateTime(),
    last_verified_at: model.dateTime(),
    tax_transaction_id: model.text().nullable(),
    association_status: model.text().nullable(),
    metadata: model.json().default({}),
  },
);

export default TaxQuoteEvidence;
