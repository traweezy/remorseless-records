# Medusa Admin support guide

This guide is for the person helping a store operator when a project-owned
Admin workflow does not complete as expected. Start with the operator's task
and visible message. Do not ask them to copy raw provider payloads, browser
storage, tokens, customer data, or database records into chat or a ticket.

The ordinary operating walkthrough is in the
[Medusa Admin client guide](ADMIN_CLIENT_GUIDE.md). Provider and incident
runbooks remain authoritative for payment, tax, media, and release operations.

## First response

1. Record the workspace, action, approximate time, and the visible request ID
   or incident code if the screen provides one. Do not collect a screenshot
   containing customer addresses, email addresses, payment data, or secrets.
2. Ask whether the screen says **Unsaved changes**, **Saving**, **Checking the
   server**, **Saved**, **Needs refresh**, or **Unavailable**.
3. Keep the affected editor open. Do not refresh until its recovery state is
   understood.
4. Use the visible **Retry**, **Check again**, or **Refresh data** action once.
   Do not create a replacement Product, shelf, post, release, refund, or tax
   decision to make two systems agree.
5. If the same incident remains, follow the workspace decision below and
   escalate with the privacy-minimized evidence.

## Safe browser and accessibility checks

- Use a current Chromium, Firefox, or Safari-class browser at 100% or 200%
  zoom. The project-owned Admin remains operable at the narrow 760-pixel
  acceptance width and at 200%-equivalent content width.
- Keyboard users can move through controls with `Tab` and `Shift+Tab`, activate
  buttons with `Enter` or `Space`, close a dialog with `Escape`, and follow the
  task links without losing form state. Focus is automatically brought above a
  project-owned sticky action bar when necessary.
- A validation summary links to the exact invalid section or field. Fix the
  first named issue, then submit again; do not clear the whole form.
- If a browser extension changes the page, repeat in a clean browser profile
  before escalating. Never disable transport security, content-security
  controls, authentication, or the browser sandbox.
- Product creation, News, and historical Discography drafts are retained in
  that browser for up to seven days. A successful save or confirmed discard
  removes the draft. Browser storage is recovery state, not a shared backup.

## Save and recovery decisions

| Visible state | Meaning | Safe response |
| --- | --- | --- |
| **Unsaved changes** | The browser has edits the server has not accepted. | Keep the page open; save or deliberately discard. |
| **Saving** | One mutation is in flight and duplicate controls are locked. | Wait for the result; do not open a second tab to repeat it. |
| **Checking the server** | The response was ambiguous and the editor is reconciling the saved version. | Let the check finish. Use the offered retry only if it cannot confirm the result. |
| **Saved** | The exact server state was read back successfully. | Continue to the next task or follow the supplied link. |
| **Needs refresh** or version conflict | Another administrator saved a newer version. | Preserve a note of the intended edit, refresh, review the newer state, and reapply only that edit. |
| Validation summary | The request did not cross the write boundary. | Follow its first linked issue and correct the named fields. |
| Provider or evidence incident | The application cannot prove the external or historical state. | Stop the mutation and use the linked operations runbook. |
| Permission denied | The signed-in administrator lacks one or more required capabilities. | Request the smallest documented role change; do not bypass the route or call its API directly. |

Retrying an unchanged supported action is safe because the editor retains its
idempotency identity. Changing the request creates a new operation. A stale
version is never overwritten silently.

## Catalog support

### Product creation

- The supported entry is **Products → Add product**. The old Catalog bookmark
  redirects to the same guided five-step route.
- A Product cannot be created with a blank or duplicate fulfillment SKU, a
  duplicate customer label, or a price of `$0.00`. **Fill missing SKUs** makes
  editable suggestions; it does not waive review.
- Templates choose common formats or sizes only. They intentionally do not
  infer price or inventory.
- If creation becomes ambiguous, keep the review page open and let it check
  the server. Search the Product list before attempting another create.
- After success, use **Catalog details** for customer-facing classification and
  presentation. Use **Default Medusa editor** only for its native price and
  inventory authorities.

### Maintainer repair of a proven failed creation

Use this procedure only for an owned failed creation whose native Product and
Variants are absent, whose parent operation is compensated, and whose exact
successful child operations prove ownership of the remaining version-one
profiles and media links. Do not retry the failed browser draft or write SQL
to remove these records. Other failure shapes require investigation.

Use the initialized **Operations → Catalog repair** workspace only after its
exact deployed revision has passed the release gates in
[the handoff](NEXT_SESSION_HANDOFF.md). The October 8 correction is still local;
this procedure is unavailable on the older deployed revision. Keep the existing
native Admin session and required conjunctive catalog/Product/Variant
permissions. Do not export credentials or launch a second application.

Enter the exact running staging Backend SHA, compensated creation-operation ID
and absent Product ID. The preview reads through the existing initialized
request scope and returns an ID-only manifest with full-row digests. Review its
profiles, variants, media, active assets and child history before confirming.
The authenticated user must remain the same through preview and confirmation.

The workspace retains a new repair UUID and the immutable reviewed request
before its first send. An uncertain acknowledgement must retry that same
request and UUID; do not start a new preview, change identities, or generate
another UUID. An account, origin or deployed-SHA change requires investigation
before retrying. A deployment during uncertainty can make the old exact-SHA
request return a conflict; do not silently substitute the newer SHA. Storage or
cross-tab coordination failure prevents a first send. Only a validated matching
success acknowledgement or replay enables **Start another repair**, which
checks the same signed-in user again before clearing the confirmed command.
Keep independent private read-back evidence of assets, history and owned rows.

Do not use `repair-failed-catalog-creation` through Medusa `exec`, including for
preview. Full application bootstrap occurs before the script and can update
provider settings, defaults and scheduled queues. Its preview flag does not
make that bootstrap read-only. The repository launcher blocks this repair
entrypoint before starting a child process; bare Medusa CLI invocation is not
a supported alternative.

The initialized API rejects other projects, environments, services, revisions,
changed users and ambiguous ownership. The server derives audit authority
from the native authenticated user. A serializable catalog transaction
soft-deletes only the
proven dangling media links and profiles, retaining uploaded assets and the
original operation history. It records one successful
`catalog.failed-creation.repair` operation. Completion failure rolls back the
whole repair; an identical successful retry returns that operation's result.
Independently verify retained assets/history and the absence of active owned
links afterward. Keep private receipts outside Git and preserve native Medusa
authorization; this procedure does not grant production or client access.

### Existing Products and Variants

- A **Needs refresh** state means the loaded version is stale. Refresh before
  editing; never copy an old raw request into a direct API call.
- Product and Variant customer presentation is separate from native price and
  inventory. A mismatch is evidence to review, not permission to write both
  from one screen.
- Bundle membership, quantities, fulfillment mode, and inventory provenance
  must agree after save. If the read-back check fails, leave the bundle
  unchanged and escalate rather than repairing relationships manually.

### Catalog merchandising

- Manual shelves cannot contain the same Product twice. Automatic shelves need
  a rule. A scheduled end must be later than its start.
- Switching shelves with edits or closing a changed creation dialog requires a
  discard decision.
- Archive is reversible and keeps membership. Restore returns a shelf as
  inactive so the operator can inspect it before publication. No direct shelf
  deletion is supported.

## Content support

- News uses exactly three save decisions: draft, future schedule, or publish
  now. A schedule must be in the future. Archive and Restore are reversible.
- Store-linked Discography entries are projections of published Products and
  must be corrected in Products. **Add historical release** is only for label
  history that is not sold through the store.
- If a News or historical Discography editor is closed accidentally, reopen
  the same workflow in the same browser and use the announced recovery draft.
  Do not import browser storage into another account or device.

## Tax support

- **Do not collect tax** is an explicit audited operating decision, not an
  exemption. It requires the displayed acknowledgement and an audit reason.
- Existing prepared checkouts and completed orders retain their historical tax
  decision. Never rewrite them to match the current setting.
- Provider changes must pass readiness checks. If a provider, registration,
  quota, or evidence incident appears, stop and use the
  [Tax Control operations runbook](TAX_CONTROL_OPERATIONS.md).
- Tax Records is read-only. It distinguishes collected, not collected, pending
  review, refunds, disputes, and incidents without changing the ledger.

## Payment and refund support

- The Order's Stripe panel is evidence and a mode-correct investigation link;
  it is not a second refund surface.
- If mode is unavailable, do not guess a Stripe Dashboard environment. If
  payment data is unavailable or amounts disagree, do not refund again.
- Refund Operations is read-only. The native Medusa Order workflow is the only
  authorized mutation surface. Follow the
  [Refund operations runbook](REFUND_OPERATIONS.md) for mismatches, direct
  provider refunds, disputes, failed refunds, and missing tax reversals.

## Media support

- Quarantine removes an unlinked asset from active reuse but retains the
  underlying file. Restore returns it to the library without attaching it to a
  Product.
- The displayed 30-day date is a review point, not an automatic purge date.
  Physical deletion is not available from Admin.
- After an ambiguous response, retry the unchanged confirmation so the same
  operation identity is reconciled. Do not upload a duplicate file as a
  substitute for restoring evidence.

## Escalation package

Provide only:

- environment and exact Admin workspace;
- approximate timestamp and administrator role, not their session or token;
- visible request ID, operation ID, or incident code;
- the attempted action and visible state/message;
- whether one unchanged retry or server check completed; and
- whether another administrator was editing the same resource.

Use structured application and Railway logs to correlate that identifier.
Logs and tickets must not contain secrets, auth headers, browser storage,
payment details, customer contact data, addresses, provider payloads, uploaded
filenames, or raw form content. For a deployed incident, verify the exact
commit SHA through health/readiness before attributing behavior to a release.
