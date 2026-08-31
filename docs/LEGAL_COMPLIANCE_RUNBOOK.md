# Legal & Compliance Runbook

This implementation guidance is not legal advice. Final policy text, jurisdiction coverage, and operating procedures must be approved by qualified counsel before production launch.

---

## 1. Public Policy Surface (Storefront)

The storefront now publishes and links these legal pages:

- `/terms`
- `/privacy`
- `/shipping`
- `/returns`
- `/accessibility`
- `/cookies`
- `/contact`

All are linked from the footer. Checkout also links Terms, Privacy, Shipping, and Returns before payment submission.

---

## 2. Client-Provided Inputs (Must Be Verified Before Launch)

Confirm these values with the business owner and legal counsel:

1. Legal business name and registered mailing address.
2. Support contact email and support phone.
3. Shipping processing window and domestic/international transit estimates.
4. Preorder and backorder handling language.
5. Return window, condition requirements, exclusions, and who pays return shipping.
6. Refund settlement timeline.
7. Jurisdictions where tax is collected and any exemptions handled.
8. Whether the business is subject to CCPA/CPRA or other state privacy frameworks requiring additional notices or opt-out controls.
9. Whether SMS marketing is enabled (if yes, counsel-approved consent copy is required).

---

## 3. Operational Workflows

### 3.1 Shipping Delay Workflow (FTC Order Rule)

When shipping will miss the promised or policy window:

1. Notify customer immediately by email.
2. Offer two options:
   - Consent to delayed shipment
   - Cancel for refund
3. Record customer response and timestamp in order notes/support system.
4. If no consent is received, follow refund path promptly.

### 3.2 Returns and Refund Workflow

1. Validate return eligibility against `/returns`.
2. Log return request date, item condition, resolution type (refund/exchange/deny), and operator.
3. For approved refunds, log:
   - refund amount
   - payment method
   - timestamp
   - processor reference ID

### 3.3 Privacy Request Workflow

1. Customer submits request via `/privacy` form (or email).
2. Storefront forwards request to backend endpoint:
   - `POST /api/privacy-request` (storefront)
   - `POST /store/privacy-request` (backend)
3. Backend creates a request ID and sends request details to operations email.
4. Operations team verifies identity and completes response within policy/legal deadlines.
5. Keep request and response records for audit trail.

### 3.4 Marketing Email (CAN-SPAM Basics)

1. Every campaign message must include:
   - unsubscribe mechanism
   - sender identification
   - physical postal address
2. Honor unsubscribe requests within legal deadlines.
3. Retain suppression records and do not re-add opted-out recipients without new consent.

### 3.5 SMS Marketing (Only If Enabled)

1. No prechecked consent boxes.
2. Store consent proof:
   - timestamp
   - IP/device metadata
   - consent language/version
3. Provide clear STOP/opt-out handling.

---

## 4. Cookie Consent Behavior

Cookie controls are managed at `/cookies` and via first-visit banner:

- Default: strictly necessary cookies only.
- User choices:
  - Accept all
  - Reject non-essential
  - Save granular preferences
- Consent is persisted in cookie + local storage with timestamp metadata.

---

## 5. Recordkeeping Expectations

Retain and protect:

1. Orders, invoices, and itemized tax lines.
2. Shipping and tracking records.
3. Return/refund records.
4. Privacy request submissions and responses.
5. Marketing suppression/consent logs.

Apply retention rules from policy and counsel guidance; update policy text if retention durations change.

---

## 6. Launch Gate Checklist

- [ ] All legal page copy approved by counsel/client.
- [ ] Checkout disclosures verified before payment action.
- [ ] Cookie default behavior validated (necessary only before consent).
- [ ] Privacy request submissions verified end-to-end.
- [ ] Shipping delay and refund operational playbooks trained with support staff.
- [ ] Contact methods monitored and staffed.

---

## 7. Current Local Acceptance Handoff (August 31, 2026)

No legal/launch implementation was changed during the final audit session.
The next local slice must close these testable gaps before requesting counsel
or client sign-off:

1. Put the exact amount and policy/fulfillment disclosure immediately before
   every paid or free order submit control and bind it with accessible
   description semantics.
2. Gate optional Web Vitals telemetry on analytics consent, then use a fresh
   browser profile to prove that no optional cookie, storage entry, external
   request, or Bandcamp frame operates before consent. Exercise accept,
   reject, granular selection, persistence, and later revocation.
3. Return the Backend privacy request's opaque request ID through the
   Storefront and present it in a focused, announced success state. Exercise
   validation, redacted failure/retry, signed Storefront-to-Backend delivery,
   and the monitored mailbox procedure without putting customer data in test
   reports or screenshots.
4. Run one deterministic launch matrix across commerce, recovery, content,
   privacy, and cookie states for keyboard order, visible/unobscured focus,
   error summaries, screen-reader semantics, WCAG 2.2 AA contrast and
   24-pixel targets, 320-pixel reflow, reduced motion, and runtime errors.
5. Run repeated production-like Lighthouse checks with explicit Core Web
   Vital and resource budgets, and inspect real graphical-desktop screenshots
   for every representative customer journey.

Qualified counsel must still approve policy wording, jurisdiction scope,
retention, consumer-request deadlines, and operating procedures. Automated
acceptance proves implementation behavior; it does not provide legal approval.
