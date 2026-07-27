# Scheduled jobs

Medusa loads each default export in this directory and schedules it from the
file's exported `config`. Deployed jobs use Medusa's Locking Module so only one
replica performs a run.

| Job                                | Schedule (UTC)    | Default  | Purpose                                                                                                          |
| ---------------------------------- | ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `reconcile-checkout-payments`      | Every two minutes | Disabled | Complete an old incomplete cart with exactly one authorized/captured official Stripe session and no linked order |
| `reconcile-stripe-lifecycle-events` | Every five minutes | Enabled | Retry received, failed, or stale refund/dispute receipts under a distributed event lock                              |
| `reconcile-tax-evidence`           | Hourly at `:23`   | Enabled  | Recheck tax-bound Stripe payments, refund reversals, disputes, and failed Stripe Tax associations                |
| `remove-expired-anonymous-carts`   | `04:17` daily     | Disabled | Soft-delete old incomplete carts with no customer or email                                                       |
| `remove-abandoned-guest-checkouts` | `04:37` daily     | Disabled | Cancel only safe unused sessions, then soft-delete old guest checkouts containing PII                            |

Every job is bounded, rechecks mutable state, and emits only aggregate results.
Payment reconciliation never creates or confirms a payment. Retention never
deletes completed, order-linked, customer-owned, recently updated, or
unresolved/successful-payment carts.

Configuration and incident procedures are documented in
[`../../../docs/CHECKOUT_OPERATIONS.md`](../../../docs/CHECKOUT_OPERATIONS.md).
