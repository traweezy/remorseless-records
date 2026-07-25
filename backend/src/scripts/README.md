# Custom CLI Script

A custom CLI script is a function to execute through Medusa's CLI tool. This is useful when creating custom Medusa tooling to run as a CLI tool.

## How to Create a Custom CLI Script?

To create a custom CLI script, create a TypeScript or JavaScript file under the `src/scripts` directory. The file must default export a function.

For example, create the file `src/scripts/my-script.ts` with the following content:

```ts title="src/scripts/my-script.ts"
import { 
  ExecArgs,
  IProductModuleService
} from "@medusajs/types"
import { ModuleRegistrationName } from "@medusajs/utils"

export default async function myScript ({
  container
}: ExecArgs) {
  const productModuleService: IProductModuleService = 
    container.resolve(ModuleRegistrationName.PRODUCT)

  const [, count] = await productModuleService.listAndCount()

  console.log(`You have ${count} product(s)`)
}
```

The function receives as a parameter an object having a `container` property, which is an instance of the Medusa Container. Use it to resolve resources in your Medusa application.

---

## How to Run Custom CLI Script?

To run the custom CLI script, run the `exec` command:

```bash
pnpm exec medusa exec ./src/scripts/my-script.ts
```

---

## Custom CLI Script Arguments

Your script can accept arguments from the command line. Arguments are passed to the function's object parameter in the `args` property.

For example:

```ts
import { ExecArgs } from "@medusajs/types"

export default async function myScript ({
  args
}: ExecArgs) {
  console.log(`The arguments you passed: ${args}`)
}
```

Then, pass the arguments in the `exec` command after the file path:

```bash
pnpm exec medusa exec ./src/scripts/my-script.ts arg1 arg2
```

## Monetary-unit audit and guarded migration

Run the checkout monetary-unit audit before any Medusa v2 major-unit
migration from the monorepo root:

```bash
pnpm --filter backend run money:audit
```

The command connects only to PostgreSQL, opens a read-only transaction, and
inventories active product prices, incomplete-cart amounts,
calculated-shipping configuration, and shipping-option prices. It does not
bootstrap Redis, object storage, Medusa plugins, or the HTTP application. It
also verifies Medusa's numeric and
`raw_amount` representations agree, refuses to pass when transactional or
discount records need manual review, and prints a SHA-256 fingerprint of the
exact migration candidate set.

The audit never changes data. A passing result is evidence for a separately
reviewed migration; it does not authorize or apply that migration. It prints
the proposed conversion count and a SHA-256 fingerprint for the exact reviewed
record set.

The migration command is also a dry run unless `--apply` is present:

```bash
pnpm --filter backend run money:migrate-major
```

Apply mode is intentionally difficult to invoke accidentally. It requires the
exact count and fingerprint from an approved dry run:

```bash
pnpm --filter backend run money:migrate-major \
  --apply \
  --expected-count=<reviewed-count> \
  --expected-manifest-sha256=<reviewed-sha256>
```

Apply mode repeats the audit under table locks in one PostgreSQL transaction.
It converts legacy active-product, active incomplete-cart, and calculated
shipping amounts to major units; preserves fixed shipping prices already in
major units; writes a region migration marker; and verifies every post-migration
amount before commit. A mismatch or blocker rolls the transaction back. Once
the marker says `major`, a second apply is rejected rather than dividing values
again.

When running from a workstation against Railway, use the Postgres service so
the public proxy URL is injected without printing credentials:

```bash
railway run --service Postgres --environment staging \
  pnpm --filter backend run money:audit
```

After a successful apply, rerun the audit and rebuild Meilisearch. Never reuse
one environment's count or fingerprint in another environment.

## Shipping and inventory-location repair

Shipping eligibility is location-scoped in Medusa: a shipping option is usable
only when its service zone belongs to the stock location that can fulfill every
cart line. Run the idempotent repair after importing inventory into a new
location or restoring a database:

```bash
pnpm --filter backend run shipping:update
```

The script targets the stock location named `HQ` by default. Override that
explicitly when an environment uses a different canonical location:

```bash
SHIPPING_STOCK_LOCATION_NAME="Warehouse A" \
  pnpm --filter backend run shipping:update
```

It fails closed if the name is missing or ambiguous. For the selected location
it enables the `per_item_standard` provider, narrows its service zones to the
United States, converts its single shipping option to calculated Standard
Shipping (`$5` plus `$0.50` per additional unit), and removes legacy Express
options. It never moves inventory or changes stocked/reserved quantities.

Afterward, validate a real addressed cart through
`GET /store/shipping-options?cart_id=...`: the selected option must have
`insufficient_inventory: false` before checkout is enabled.
