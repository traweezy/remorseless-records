# Custom subscribers

## Project payment subscribers

`stripe-lifecycle-event.ts` consumes only internal ledger IDs emitted after
`POST /webhooks/stripe/lifecycle` has verified the Stripe signature and
persisted a minimal receipt. It retrieves the current Stripe refund or dispute
object, links the PaymentIntent to the Medusa order when available, and invokes
the existing tax/payment evidence reconciliation under a distributed lock.
Duplicate and out-of-order delivery is safe because provider payloads are not
treated as current state.

`payment-tax-evidence.ts` handles Medusa's own capture/refund events, while
`refund-issued.ts` sends the idempotent customer notification for a refund that
Medusa actually recorded. A direct Stripe refund deliberately does not pretend
that Medusa emitted `payment.refunded`; it becomes an operator-visible ledger
mismatch so a second refund is not issued accidentally.

`order-placed.ts` and `refund-issued.ts` derive stable business keys from the
Medusa order or refund ID. Each key is persisted as Medusa notification
idempotency and forwarded unchanged to Resend provider idempotency. Delivery
errors propagate to the event worker, so a retry reuses the same key and cannot
create a second provider message after an ambiguous response.

Subscribers handle events emitted in the Medusa application.

The subscriber is created in a TypeScript or JavaScript file under the `src/subscribers` directory.

For example, create the file `src/subscribers/product-created.ts` with the following content:

```ts
import {
  type SubscriberConfig,
} from "@medusajs/medusa"

// subscriber function
export default async function productCreateHandler() {
  console.log("A product was created")
}

// subscriber config
export const config: SubscriberConfig = {
  event: "product.created",
}
```

A subscriber file must export:

- The subscriber function that is an asynchronous function executed whenever the associated event is triggered.
- A configuration object defining the event this subscriber is listening to.

## Subscriber Parameters

A subscriber receives an object having the following properties:

- `event`: An object holding the event's details. It has a `data` property, which is the event's data payload.
- `container`: The Medusa container. Use it to resolve modules' main services and other registered resources.

```ts
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/medusa"
import { IProductModuleService } from "@medusajs/types"
import { ModuleRegistrationName } from "@medusajs/utils"

export default async function productCreateHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const productId = data.id

  const productModuleService: IProductModuleService =
    container.resolve(ModuleRegistrationName.PRODUCT)

  const product = await productModuleService.retrieve(productId)

  console.log(`The product ${product.title} was created`)
}

export const config: SubscriberConfig = {
  event: "product.created",
}
```
