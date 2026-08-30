# Tax records and filing workpapers

## Purpose and boundary

The Medusa Admin **Operations → Tax records** workspace builds reviewable sales-tax
workpapers for Connecticut, New York, and Pennsylvania. It projects completed
Medusa sales, refunds, destination evidence, and preserved tax-provider
evidence into:

- period totals by currency;
- transaction-detail records;
- destination and filing-jurisdiction groups; and
- private CSV workpapers.

Medusa remains the commerce source of truth. The workspace does not register
or close a state account, decide whether nexus exists, file a return, make a
payment, or replace the store's accountant. A tax-provider request is also not
a ledger entry: quotes can be cached, carts can be abandoned, and a provider
call does not prove that payment was captured.

## The filing-jurisdiction control

The operator must select **Connecticut**, **New York**, or **Pennsylvania**
before using a report. This selection scopes the totals, records, destination
workpaper, and both exports to orders delivered to that state. It is not a
cosmetic table filter.

The selector also supplies state-appropriate period presets and filing
guidance:

| State        | Return and portal                            | Presets                                                                              | General due-date pattern                                                               |
| ------------ | -------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Connecticut  | Form OS-114 in myconneCT                     | calendar month, quarter, year, or custom                                             | last day of the month after the assigned period                                        |
| New York     | ST-809, ST-100, or ST-101 in Online Services | calendar month, New York sales-tax quarter, March–February sales-tax year, or custom | generally within 20 days after the period                                              |
| Pennsylvania | PA-3 in myPATH                               | calendar month, quarter, half-year, or custom                                        | current REV-819 calendar; generally the 20th, with semiannual dates shown by the state |

These are workpaper presets, not a filing-frequency decision. The operator
must use the frequency and exact obligation assigned in the official state
portal. High-liability Pennsylvania accounts can also have accelerated
prepayments that this workspace does not schedule.

All three states require an active registrant to file assigned returns even
when no taxable transactions occurred. An empty workpaper is therefore not an
instruction to skip a return.

## Connecticut-to-Pennsylvania relocation

A change in the owner's or business's physical location does not merge,
transfer, or automatically close state tax accounts.

Before and during the move:

1. Review the business's Connecticut account in myconneCT and update the
   address or request closure only when the business and its adviser determine
   that the Connecticut obligation has ended.
2. Continue every assigned Connecticut return, including zero or final
   returns, until Connecticut DRS confirms the relevant change.
3. Determine the Pennsylvania registration date with the accountant.
   Pennsylvania directs new and existing businesses to register sales-tax
   accounts through myPATH. Property, inventory, or another physical presence
   in Pennsylvania can create state obligations.
4. Keep filing New York separately for as long as its registration or nexus
   remains active. A move between Connecticut and Pennsylvania does not close a
   New York Certificate of Authority.
5. Preserve workpapers and official confirmations for each state. Never
   combine a Connecticut final period, a Pennsylvania opening period, and a
   New York ongoing period into one return.

This extension does not mutate registrations or infer effective dates. The
state selector deliberately remains available for all three states so historic,
transition, amended, zero, and final-period work can remain separate.

## State-specific destination workpapers

### Connecticut

Connecticut has no additional local sales taxes. The workpaper groups
Connecticut records into a statewide filing bucket while retaining each
destination and effective rate. Connecticut has special rates for some
transactions, so the operator must reconcile any nonstandard rate to the
current OS-114 instructions.

### New York

New York is destination-based and requires local-jurisdiction reporting. The
workpaper uses preserved provider jurisdiction evidence when available. If a
taxed New York row lacks county or jurisdiction evidence, the row is marked for
review; the system never invents a locality or return schedule.

New York sales-tax quarters are:

- March through May;
- June through August;
- September through November; and
- December through February.

The sales-tax year runs from March through February.

### Pennsylvania

Pennsylvania's general state sales-tax rate is separate from the additional
local tax in Allegheny County and Philadelphia. The destination export
therefore identifies one of four filing buckets:

- `Philadelphia local`;
- `Allegheny local`;
- `Pennsylvania state only`; or
- `Pennsylvania locality — verify`.

Only explicit Philadelphia, Allegheny, or other county evidence is used to
classify a local bucket. A city or postal code without sufficient county
evidence stays in **verify** rather than being guessed. The operator must
reconcile the state and local amounts to PA-3/myPATH requirements.

## Record projection

Sales are recorded at the final positive payment-capture timestamp. The report
loads linked payments directly from Medusa's Payment Module in bounded batches,
so capture and refund records remain authoritative even when an order graph
omits computed nested amounts. It reads:

1. the paid-order summary;
2. explicit capture records, including incremental captures; and
3. the payment collection's captured total.

The report fails closed if a linked payment cannot be hydrated. A legacy paid
order without a capture timestamp uses the order timestamp and is marked for
review. A captured amount that differs from the original order total is marked
incomplete instead of silently reporting a full sale. Zero-value orders are
omitted because they do not create a sales-tax amount.

Workflow, Query Graph, and nested relationship data is runtime-validated before
projection. A missing envelope, primitive row, malformed relationship member,
or coercive monetary value fails the report with a fixed message instead of
dropping a record or converting it to zero. Monetary inputs accept Medusa
BigNumber values, explicit finite number/string values, and validated value
wrappers. Capture, order, and refund timestamps must be Date values or complete
offset-aware ISO timestamps; ambiguous date coercion is not used in a filing
period.

Refunds are credits in the period in which the refund occurred. Each refund is
classified as:

- **same-period credit**;
- **prior-period credit**; or
- **unknown timing**.

Prior-period credits are marked for review because the correct state and
locality treatment can require another schedule, claim, or supporting
workpaper. A full refund has an exact proportional tax reversal. A partial,
amount-only Medusa refund does not identify the refunded item, so its tax
portion is estimated proportionally and marked for review. Cumulative refunds
above the original order total are incomplete.

The report uses the `America/New_York` time zone for all three states, which
share Eastern time. Period ends are exclusive. For example, `2026-07-01` to
`2026-10-01` includes local timestamps on or after July 1 and before October 1,
including daylight-saving transitions without double-counting midnight.

## Quality states

The report never silently promotes incomplete history to filing-ready data:

- **Complete** means the Medusa record has consistent provider identity,
  destination, and required locality evidence.
- **Review** means the monetary row is usable but needs an accountant decision
  or external workpaper. Examples include legacy tax lines, a partial-refund
  estimate, a prior-period credit, or a non-USD row.
- **Incomplete** means required destination or tax identity data is absent or
  inconsistent.

Legacy `sales_tax` lines remain visible but are labeled for review because they
do not preserve provider-generation evidence. Stripe Tax periods still require
reconciliation to Stripe's finalized itemized tax report when sub-state rows
are not preserved on the Medusa tax line.

### Explicit disabled collection

An order with the audited `disabled` collection mode is not a provider zero,
exemption, nontaxable sale, or missing legacy row. The report preserves its
mode/generation identity, uses provider **Not applicable**, requires a zero tax
amount, and marks the row **Review** with an explicit instruction to confirm
the operating decision and filing treatment.

Its gross amount is assigned to **Sales pending tax review**. Both taxable and
nontaxable amounts remain zero until the store owner's tax professional decides
the appropriate filing classification outside the application. A disabled row
with nonzero tax is **Incomplete** because its evidence contradicts its amount.

Refunds retain the original collection mode. A refund against a disabled sale
reduces **Sales pending tax review** proportionally and never invents a provider
tax reversal. Use the **Collection decision** filter to isolate collecting,
not-collecting, or unknown evidence before reconciliation.

A United States or country-unknown record with no destination state cannot be
safely assigned to Connecticut, New York, or Pennsylvania. The UI surfaces the
affected orders, and the state-specific export endpoint returns a conflict
response until the source shipping address is corrected.

## Totals and exports

Monetary totals are grouped by ISO currency and never added across currencies.
The on-screen currency selector changes the summary cards and destination
workpaper being viewed. It does not convert currencies.

Two UTF-8 CSV exports cover the full selected filing state and period:

1. **Transaction detail** contains one signed row per sale or refund with
   Medusa IDs, filing state and bucket, collection decision, provider evidence,
   destination, taxable, nontaxable, and pending-review sales, tax, refund
   timing, quality, and notes.
2. **Destination summary** groups sales, refunds, and tax by filing bucket,
   destination, rate, and currency, followed by period totals.

Search, provider, quality, record-type, pagination, and the on-screen currency
selector do not change exports. Every filename includes the filing-state code.
Exports neutralize spreadsheet formulas, exclude names, emails, phone numbers,
and street addresses, and are private non-cacheable attachments.

Transaction, destination, and period-summary workpapers include
`collection_mode` or `unclassified_sales_pending_review` as appropriate. Do not
copy the pending-review value into an exempt/nontaxable return line without the
external filing decision and supporting workpaper.

The bounded source scan reads orders created before the selected end so a
current-period refund for an older sale is not missed. If the scan reaches
50,000 orders, the UI marks the report incomplete and exports fail closed.

## Filing workflow

Repeat this workflow separately for each active state:

1. Select the filing jurisdiction.
2. Confirm the assigned frequency and exact period in the official portal.
3. Resolve every **Incomplete** row and review every **Review** row.
4. Reconcile prior-period refunds to the original destination and required
   state support.
5. Download transaction and destination CSVs.
6. Reconcile gross sales, credits, taxable sales, and tax to Medusa orders,
   refunds, payment evidence, the accounting ledger, and provider reports.
7. Add amounts this storefront cannot derive, including business use tax,
   exemption support, marketplace statements, special taxes or fees, and
   adjustments.
8. Have the accountant confirm the return lines and local schedules.
9. File and pay through myconneCT, New York Online Services, or myPATH.
10. Retain the filed return, confirmation, workpapers, invoices, exemption
    support, and source records together.

## Retention

The state minimums are not identical:

| State        | Official baseline                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Connecticut  | generally at least three years; Connecticut DRS materials recommend six years for some exemption and supporting records |
| New York     | at least three years from the return due date or filing date, whichever is later; longer for an audit or proceeding     |
| Pennsylvania | at least three years from the end of the calendar year to which the records relate                                      |

The operational policy for this project is to retain the complete electronic
filing package for **at least six years**, and longer when an audit, appeal,
claim, amended return, or adviser hold remains open. This conservative project
policy does not shorten any category-specific legal requirement.

## Items the storefront cannot derive

The workpaper does not calculate or maintain:

- nexus and registration effective dates;
- official account status, assigned frequency, or accelerated prepayments;
- business purchases subject to use tax;
- exemption-certificate management;
- marketplace-facilitator statements;
- bad-debt adjustments not represented as Medusa refunds;
- Connecticut special-rate return-line classification;
- Pennsylvania special taxes or fees;
- the final state/local schedule for a row lacking jurisdiction evidence; or
- filing-currency conversion for non-USD sales.

These belong in the accountant reconciliation and official state portal, not
inferred from storefront data.

## Primary official references

### Connecticut

- DRS sales-tax information, OS-114 filing, frequency, due dates, rates, and no
  local sales tax:
  https://portal.ct.gov/drs/sales-tax/tax-information
- Current sales and use tax returns:
  https://portal.ct.gov/drs/drs-forms/sales-tax-forms/sut-returns
- Register, update, and close DRS accounts:
  https://portal.ct.gov/drs/businesses/new-business-resource-center/registering-with-drs

### New York

- File sales-tax returns and zero/final return guidance:
  https://www.tax.ny.gov/bus/st/filing_sales_tax_returns.htm
- Filing Requirements for Sales and Use Tax Returns:
  https://www.tax.ny.gov/pdf/tg_bulletins/sales/b15_275s.pdf
- Current ST-100 instructions:
  https://www.tax.ny.gov/forms/html-instructions/2026/st/st100i-126.htm
- Recordkeeping Requirements for Sales Tax Vendors:
  https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/record-keeping_requirements_for_sales_tax_vendors.htm
- New York Online Services:
  https://www.tax.ny.gov/online/bus.htm

### Pennsylvania

- Sales, Use, and Hotel Occupancy Tax:
  https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax
- Current tax rates:
  https://www.pa.gov/agencies/revenue/resources/tax-rates
- 2026 filing and administrative due-date calendar (REV-819):
  https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/formsandpublications/formsforbusinesses/sut/documents/2026_rev-819.pdf
- Register through myPATH:
  https://www.pa.gov/services/revenue/register-my-business-for-taxes
- Online-retailer physical-presence guidance:
  https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/tax-obligations-for-online-retailers
- Required sales-tax records and retention:
  https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F061%2Fchapter34%2Fs34.2.html
  and
  https://www.pacodeandbulletin.gov/Display/pacode?d=reduce&file=%2Fsecure%2Fpacode%2Fdata%2F061%2Fchapter35%2Fs35.1.html

### Platform evidence

- Stripe Tax reports: https://docs.stripe.com/tax/reports
- Medusa order tax lines:
  https://docs.medusajs.com/resources/commerce-modules/order/tax-lines
- Medusa order transactions:
  https://docs.medusajs.com/resources/commerce-modules/order/transactions
- Medusa order totals:
  https://docs.medusajs.com/resources/commerce-modules/order/order-totals
