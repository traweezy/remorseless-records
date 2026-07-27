import { model } from "@medusajs/framework/utils";

import { stripeLifecycleEventStatuses } from "../constants";

const StripeLifecycleEvent = model.define(
  {
    name: "stripe_lifecycle_event",
    tableName: "stripe_lifecycle_events",
  },
  {
    id: model.id({ prefix: "stripelinevt" }).primaryKey(),
    provider_event_id: model.text().unique(),
    event_type: model.text().index(),
    object_id: model.text().index(),
    payment_intent_id: model.text().index().nullable(),
    charge_id: model.text().index().nullable(),
    order_id: model.text().index().nullable(),
    livemode: model.boolean(),
    event_created_at: model.dateTime(),
    status: model
      .enum([...stripeLifecycleEventStatuses])
      .default("received"),
    attempt_count: model.number().default(0),
    received_at: model.dateTime(),
    processing_started_at: model.dateTime().nullable(),
    processed_at: model.dateTime().nullable(),
    next_retry_at: model.dateTime().nullable(),
    last_error_code: model.text().nullable(),
    amount_minor: model.number().nullable(),
    currency_code: model.text().nullable(),
    provider_object_status: model.text().nullable(),
    metadata: model.json().default({}),
  },
);

export default StripeLifecycleEvent;
