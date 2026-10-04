# Email templates

This directory contains all email templates used by the application. Templates are
plain React components rendered by Resend through `@react-email/render`, with
local email-safe primitives in `templates/primitives.tsx`.

Run the following command to start the development server:

```bash
pnpm email:dev
```

This fetches the pinned React Email preview CLI on demand and starts a preview
server at `http://localhost:3002`. The CLI is intentionally not installed as a
backend dependency so production builds do not carry preview tooling.

## Base Template

All email templates use a shared base template (`base.tsx`) that provides consistent styling across all emails. The base template includes:

- Consistent font family and sizing
- Email body container
- Background color

This ensures a unified look and feel across all email communications while allowing individual templates to focus on their specific content.

## Usage

### Transactional notification delivery safety

Order confirmations, refund notices, fulfillment updates, and administrator invites are side
effects of retryable events. Build every message with
`emailIdempotencyFields`: it stores one validated key in Medusa's
`idempotency_key` and forwards the same key through
`provider_data.idempotency_key` to Resend. Orders and refunds use stable opaque
business identifiers. Invites use the invite ID plus a truncated SHA-256 token
digest so a resent invite gets a new operation without storing the raw token in
the key. Never use an email address or raw credential as an idempotency key.

Subscribers call `createAndVerifyNotifications`, not the generated create
method directly. Medusa may return an empty acknowledgement for a successful
idempotent replay, so the helper always re-reads by the pinned Medusa
idempotency filter and requires exactly one successful row per request. The
stored recipient, channel, template, trigger, resource, receiver, provider
key, provider ID, external delivery ID, data projection, and timestamp must
match. Missing, duplicate, failed, or malformed state propagates an error so
the event can retry.

An invite needs its one-time URL only while Resend renders the message. After a
verified send, the subscriber replaces the stored template data with a stable
non-secret redaction marker, validates the update acknowledgement, and re-reads
the final row. A replay accepts that already-redacted state without sending
again. If redaction fails after delivery, the unchanged provider idempotency
key prevents another email while the retry completes redaction.

The Resend provider accepts one validated recipient, the configured sender,
one of the four known templates, a subject-only options object, and no
attachments or per-message sender. Every template requires provider
idempotency. Calls have a five-second deadline and success requires Resend's
exact non-empty external ID response. Errors and logs include no recipient,
provider message, template data, or response payload.

Customer-facing money must use the shared `formatCurrencyAmount` helper. Medusa
retains high-precision major-unit values for accounting and tax calculations;
never interpolate those raw values into an email. The formatter validates the
input and applies the currency's display precision at this presentation
boundary. Numeric strings must be explicit decimal literals; hexadecimal,
trailing text, booleans, arrays, empty strings, non-finite values, negative
amounts, and malformed value wrappers fail closed instead of being coerced by
JavaScript.

### Fulfillment status notifications

`fulfillment-status.ts` consumes the pinned native `order.fulfillment_created`,
`shipment.created` and `delivery.created` workflow events. The notification
checkbox maps to `no_notification`; a true opt-out skips the query and send.
Native Query resolves the fulfillment's order link and the persisted timestamp
for the requested stage. Wrong IDs, missing/duplicate rows, malformed states
and mismatched creation-order links fail closed. Canceled fulfillments/orders,
orders without email and generic fulfillments with no order link are skipped.

Each stage uses `fulfillment-status:<fulfillment-id>:<stage>` in both Medusa and
Resend. The immutable template projection is the order number and stage; it
excludes tracking labels, addresses and item data that can change during a
retry. Separate partial fulfillments have separate keys. Copy explicitly
covers one shipment, so a partial fulfillment never claims the whole order is
shipped or delivered. No carrier booking or tracking link is created by email.
Durable verification and the configured sender/deadline remain unchanged.

The shared email shell now places preview text within the body, uses English
left-to-right attributes on the document and body containers, and provides a
head title. The fulfillment template uses its specific stage title and one
semantic heading. Local render/fixture checks do not establish compatibility
with every recipient email client or actual inbox delivery.

### Trigger an email notification

Build a validated, minimal projection and verify its durable result. The
template data must include a validated `emailOptions: { subject }` plus only
the fields required by that template; `validatedRecipient` is a validated
single mailbox and `order.id` is an opaque, validated order ID:

```typescript
const idempotencyKey = `order-placed:${order.id}`
const payload = {
  ...emailIdempotencyFields(idempotencyKey),
  channel: "email",
  data: validatedMinimalTemplateData,
  resource_id: order.id,
  resource_type: "order",
  template: EmailTemplates.ORDER_PLACED,
  to: validatedRecipient,
  trigger_type: "order.placed",
}

await createAndVerifyNotifications(notificationModuleService, [payload])
```

### Adding a new template

1. Add a named component under `templates/` using `Base` and the local
   email-safe primitives. Give it a unique key and a type guard that accepts
   `unknown`, validates the complete minimal data projection, and rejects
   malformed or oversized values. Use non-secret preview fixtures.
2. Register the key, guard, and component in `templates/index.tsx`. Add the
   exact key to `SUPPORTED_TEMPLATES` in `services/resend.ts`; the provider
   rejects unregistered templates. Keep `emailOptions` limited to one validated
   subject.
3. In the subscriber, resolve and validate recipient and business identifiers
   at the boundary, build only the template's required projection, and pass a
   stable opaque idempotency key through `emailIdempotencyFields`. Call
   `createAndVerifyNotifications` and require its durable acknowledgement.
   `order-placed.ts` and `invite-created.ts` show the supported patterns.
4. If the message contains a one-time link, construct it from a validated,
   configured HTTPS origin and encoded token, validate its exact path and query,
   redact the stored secret after verified delivery. The invite subscriber and
   `buildInviteNotificationLink` provide the existing implementation. Never
   derive a link by interpolating an untrusted token into a base URL.
5. Cover invalid template data, recipient, URL, provider response, retry,
   replay, and redaction behavior with focused tests before enabling the new
   event.

## Additional Info & Documentation

I based this module off of [@typed-dev/medusa-notification-resend](https://github.com/typed-development/medusa-notification-resend) but added
the ability to send React email templates and extended the functionality to include more Resend options.

In the original module, you're limited to just `subject`, `from`, `to`, the body, and the attachments. You also could
only send HTML, which means you have to render the email body yourself instead of using the
`react` email option which renders it through `@react-email/render`.

### Medusa

* Guide: [How to Create a Notification Provider Module](https://docs.medusajs.com/resources/references/notification-provider-module)
* Getting Started: [Events & Subscribers](https://docs.medusajs.com/learn/basics/events-and-subscribers) 

### React Email

For more information on email rendering and preview tooling, refer to the official [React Email documentation](https://react.email/).

You can also use [these example templates](https://demo.react.email/preview/magic-links/aws-verify-email) as a reference.

### Resend

* Docs: [Node.js Quickstart](https://resend.com/docs/send-with-nodejs)
