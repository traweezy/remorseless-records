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

Order confirmations, refund notices, and administrator invites are side
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
one of the three known templates, a subject-only options object, and no
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

### Trigger an email notification

Build a validated, minimal projection and verify its durable result:

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

To add a new email template:

#### 1. Create the template component

Add a new file in the templates directory using the shared base template and
local primitives. For example, `new-template.tsx`:

```tsx
import * as React from 'react'
import { Base } from './base'
import { Text, Link } from './primitives'

export const NEW_TEMPLATE_KEY = 'new-template'

export interface NewTemplateProps {
  greeting: string
  actionUrl: string
  preview?: string
}

export const isNewTemplateData = (data: any): data is NewTemplateProps =>
  typeof data.greeting === 'string' && typeof data.actionUrl === 'string'

export const NewTemplate = ({ greeting, actionUrl, preview = 'You have a new message' }: NewTemplateProps) => (
  <Base preview={preview}>
    <Text>{greeting}</Text>
    <Text>Click <Link href={actionUrl}>here</Link> to take action.</Text>
  </Base>
)

// Add preview props for the email dev server
NewTemplate.PreviewProps = {
  greeting: 'Hello there!',
  actionUrl: 'https://example.com/action',
  preview: 'Preview of the new template'
} as NewTemplateProps
```

#### 2. Add the new template key to the `EmailTemplates` enum:

```typescript
import { NEW_TEMPLATE_KEY } from './new-template'

export enum EmailTemplates {
  // ...
  NEW_TEMPLATE = NEW_TEMPLATE_KEY, // Add new key here
}
```

#### 3. Add template handling to `generateEmailTemplate`
Update the `generateEmailTemplate` function to handle the new template:

```tsx
import NewTemplate, { NEW_TEMPLATE_KEY, isNewTemplateData } from './new-template'

export enum EmailTemplates {
  // ...
  NEW_TEMPLATE = NEW_TEMPLATE_KEY,
}

export function generateEmailTemplate(templateKey: string, data: unknown): ReactNode {
  switch (templateKey) {
    // ...
    case EmailTemplates.NEW_TEMPLATE:
      if (!isNewTemplateData(data)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid data for template "${EmailTemplates.NEW_TEMPLATE}"`
        )
      }
      return (<NewTemplate {...data} />)
    default:
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown template key: "${templateKey}"`,
      )
  }
}
```

#### 4. Trigger the new template in a subscriber
Finally, call `createNotifications` with the new template key and data

```typescript
await notificationModuleService.createNotifications({
  to: user.email,
  channel: 'email',
  template: EmailTemplates.NEW_TEMPLATE, // or 'new-template'
  data: {
    emailOptions: {
      subject: 'Action Required',
    },
    greeting: 'Hello there!',
    actionUrl: `${BACKEND_URL}/take-action?token=${user.token}`,
    preview: 'An important action is awaiting you...',
  },
})
```

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
