# Tax collection client guide

## What this control does

Open **Settings → Tax control** to choose the operating decision for new or
refreshed checkouts:

1. **Do not collect tax** records an explicit $0.00 tax decision and does not
   call TaxRate.io or Stripe Tax for customer tax calculation.
2. **Collect using TaxRate.io** calculates a ZIP-based rate when TaxRate.io is
   ready and has quota.
3. **Collect using Stripe Tax** calculates address- and item-aware tax when the
   connected Stripe account, registrations, defaults, and shipping code are
   ready.

Tax collection starts off. If a provider's Backend environment variables are
missing, its card says **Unavailable**, its selection button is disabled, and
the page explains what must be configured. **Needs setup** means the runtime
credential exists but another readiness check still fails. Adding credentials
never turns collection on automatically; return here and make the audited
choice only after the provider says **Ready**.

The setting does not decide whether tax is legally owed. It does not register
or close a tax account, change a filing frequency, classify a sale as exempt,
or file/pay a return. The store owner remains responsible for those decisions
with their tax professional.

## Before changing the decision

- Confirm the intended effective time and reason with the store owner.
- Review **Decision-locked checkouts** and **Payments completing**. Those
  checkouts keep the decision already prepared and are not repriced.
- Review payment tax evidence for an incident that should be resolved first.
- When turning collection on, confirm every readiness row for the selected
  provider says **Ready**.

## Turn collection off

1. Select **Review turning off tax collection**.
2. Read the impact preview.
3. Enter a reason of at least ten characters.
4. Type the acknowledgement exactly as displayed.
5. Confirm **Turn off tax collection**.
6. Verify the current status says **Tax not collected** and the history contains
   one new transition.

New eligible checkouts now show **Tax not collected** and `$0.00`. A prepared
checkout may still display and pay its earlier provider-calculated tax because
its payment decision is frozen. Completed orders and receipts never change.

## Turn collection on

1. Choose **Collect using TaxRate.io** or **Collect using Stripe Tax**.
2. If the card says **Unavailable**, ask engineering to add the named Backend
   environment variables and restart the service. If it says **Needs setup**,
   complete the missing readiness rows first.
3. Review the frozen-checkout impact and enter the reason.
4. Confirm the provider choice.
5. Verify the current status says **Collecting tax** and history contains one
   new transition.

A checkout prepared while collection was off keeps its $0.00 decision. New or
refreshed unprepared checkouts adopt the new provider and generation.

## Tax records and refunds

Disabled-mode orders appear in **Operations → Tax records** as **Sales pending
tax review**. They are not automatically placed in taxable, nontaxable, or
exempt amounts. Use the **Collection decision** filter and retain the
transaction/destination CSVs with the accountant's final workpaper.

Always issue refunds through Medusa. A refund against a disabled-mode order has
no provider tax transaction to reverse, but the refund/payment evidence and
pending-review sales amount still reconcile. Never create a second refund or a
tax reversal directly in Stripe to compensate for a confusing status.

## If a change looks uncertain

- Refresh Tax Control before trying again. The page reconciles the durable mode,
  provider, and generation after a lost response.
- If history already shows the requested transition, do not submit another
  change.
- If a prepared checkout differs from the current status, compare its frozen
  decision instead of editing its PaymentIntent or tax lines.
- If the current runtime cannot honor the stored mode, stop new checkout
  traffic and follow the expand-only rollback in
  [`TAX_CONTROL_OPERATIONS.md`](TAX_CONTROL_OPERATIONS.md).

Detailed filing treatment is in
[`TAX_RECORDS_AND_FILING.md`](TAX_RECORDS_AND_FILING.md). Checkout and payment
recovery is in [`CHECKOUT_OPERATIONS.md`](CHECKOUT_OPERATIONS.md), and refund
exceptions are in [`REFUND_OPERATIONS.md`](REFUND_OPERATIONS.md).
