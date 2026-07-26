# Tax records and filing workpapers

## Purpose

The Admin **Tax records** workspace turns Medusa order, refund, destination,
and tax-line data into reviewable sales-tax records and downloadable
workpapers. Medusa remains the commerce source of truth. The workspace does
not file a return, make a payment, change a provider, or replace review by the
store's accountant.

Raw provider requests are deliberately not the ledger:

- one TaxRate.io lookup can be cached and reused by several carts;
- many carts never become sales;
- provider calls do not prove that payment was captured; and
- returns require completed sales, credits, and tax by destination.

The report therefore starts with completed Medusa payment records and their
refunds. Provider identifiers, generations, Stripe calculation IDs, and
destination details are retained as supporting evidence when available.

## New York reporting model

Remorseless Records is based in Buffalo, New York. New York sales tax is
destination-based, so a sale is grouped by where the order was delivered.
New York sales-tax years run from March through February. Quarterly periods
are March–May, June–August, September–November, and December–February.

The extension uses an end-exclusive period in `America/New_York`. A report
from `2026-03-01` to `2027-03-01`, for example, includes local timestamps on
or after March 1, 2026 and before March 1, 2027. This avoids double-counting
transactions at midnight and handles daylight-saving changes explicitly.

The summary provides:

- gross sales excluding tax;
- taxable and nontaxable sales;
- sales and tax refunded during the selected period;
- net sales and net tax;
- transaction-quality counts; and
- destination groups by country, state, locality, postal code, and rate.

Sales are recorded in the period in which the order was placed and captured.
Refunds are credits in the period in which the refund occurred. A full refund
has an exact proportional tax reversal. A partial, amount-only Medusa refund
does not identify which item was refunded, so its tax portion is shown as an
estimate and is marked for review.

## Record quality

The report never silently promotes incomplete history to filing-ready data:

- **Complete** means the Medusa record has a consistent provider identity,
  destination, and usable locality evidence.
- **Review** means the monetary record is usable but needs an external
  workpaper or accountant decision. Examples include legacy tax lines,
  Stripe sub-state detail, or a partial-refund estimate.
- **Incomplete** means required destination or tax identity data is absent or
  inconsistent.

Orders created before provider generation tracking have legacy `sales_tax`
lines with only a combined rate. They remain visible and exportable, but the
extension labels them for review. It does not invent a locality.

When Stripe Tax is active, use Stripe's itemized tax report to confirm the
sub-state jurisdiction rows. Stripe documents that its calculation object and
its finalized reports serve different purposes, and that itemized exports can
contain multiple rows per line item for multiple jurisdictions.

## Exports

Two UTF-8 CSV exports are available for the selected period:

1. **Transaction detail** contains one signed row per sale or refund with
   Medusa IDs, provider evidence, destination, taxable and nontaxable amounts,
   tax, quality, and review notes.
2. **Destination summary** groups sales, refunds, and tax by destination and
   rate. It also includes the period totals used by the Admin summary.

Exports protect spreadsheet users from CSV formula injection, exclude
customer names, emails, phone numbers, and street addresses, and are served as
private, non-cacheable attachments. Source invoices remain in Medusa for
audit support.

If the bounded source scan reaches its safety limit, the UI reports that the
result is truncated and the export endpoint refuses to generate an incomplete
file. Narrow the period before exporting.

## Filing workflow

1. Select the exact filing period shown in New York Online Services.
2. Resolve every **Incomplete** record and review every **Review** record.
3. Download both workpapers.
4. Reconcile gross sales, credits, taxable sales, and tax to Medusa orders,
   refunds, payment evidence, and the accounting ledger.
5. For Stripe Tax periods, reconcile the Stripe itemized report to the Medusa
   transaction export.
6. Have the store's accountant confirm jurisdiction codes, business use-tax
   purchases, exemption certificates, special taxes, and adjustments that do
   not originate in storefront orders.
7. File and pay through New York Online Services. Keep the filed return,
   workpapers, invoices, and source records together.

New York requires registered vendors to file even when a period has no
taxable sales. The extension may correctly show an empty period; that is not
an instruction to skip a required return.

## Retention and limitations

New York generally requires sales-tax records for at least three years from
the later of the return due date or filing date, and longer when an audit or
other proceeding remains open. Backups and retention policies must preserve
Medusa orders, payment/refund data, tax lines, and filed workpapers.

This storefront report does not currently model:

- business purchases subject to use tax;
- exemption-certificate management;
- marketplace-facilitator statements;
- bad-debt adjustments not represented as refunds;
- special taxes or fees; or
- tax returns for jurisdictions in which the business later registers.

Those items belong in the accountant reconciliation rather than being guessed
from storefront data.

## Primary references

- New York, Filing Requirements for Sales and Use Tax Returns:
  https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/filing_requirements_for_sales_and_use_tax_returns.htm
- New York, Recordkeeping Requirements for Sales Tax Vendors:
  https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/record-keeping_requirements_for_sales_tax_vendors.htm
- New York, Sales Tax Rates and destination rules:
  https://www.tax.ny.gov/bus/st/rates.htm
- New York, Form ST-100 instructions:
  https://www.tax.ny.gov/forms/html-instructions/2024/st/st100i-0224.htm
- Stripe Tax reporting:
  https://docs.stripe.com/tax/reports
- Medusa order tax lines:
  https://docs.medusajs.com/resources/commerce-modules/order/tax-lines
- Medusa order transactions:
  https://docs.medusajs.com/resources/commerce-modules/order/transactions
