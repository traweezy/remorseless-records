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
