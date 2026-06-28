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

### Trigger an email notification

To send a notification using an email template, specify the template key and required data when calling `createNotifications`:

```typescript
await notificationModuleService.createNotifications({
  to: invite.email,
  channel: 'email',
  template: EmailTemplates.INVITE_USER, // Use the enum for the template key
  data: {
    emailOptions: {
      replyTo: 'info@example.com',
      subject: "You've been invited!",
    },
    inviteLink: `${BACKEND_URL}/app/invite?token=${invite.token}`,
    preview: 'Get started with your invitation...',
  },
})
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
      replyTo: 'support@example.com',
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
