# QA & Observability Runbook

This document outlines repeatable steps for validating Remorseless Records before shipping. It covers accessibility & performance, payments, and search consistency. Follow the sections sequentially; each can be run independently when relevant functionality changes.

---

## 1. Accessibility & Performance Sweep

> Quick automation: `QA_BASE_URL=http://127.0.0.1:3000 pnpm run qa:ci`
> (runs lint/typecheck, pa11y axe audits, Lighthouse assertions). Use the manual steps below to investigate failures.
> Set `QA_PATHS=/about,/accessibility` to replace the default dynamic route set
> when a deterministic, backend-independent local sweep is required.
> If Chrome is not discoverable on `PATH`, set `PA11Y_CHROME_EXECUTABLE_PATH`
> for pa11y and `CHROME_PATH` for Lighthouse to a sandbox-capable Chrome binary.
> Do not disable the browser sandbox to make a host pass.

### 1.1 Keyboard / Screen-reader

1. Start backend + storefront with production-like data.
2. Using only the keyboard:
   - Tab through global header (Nav → Quick Shop triggers → Cart). Verify focus ring and skip no elements.
   - On `/catalog`, open a Quick Shop modal and change variants; ensure focus is trapped and `Esc` closes it.
   - On a typed product detail route (`/music-release/[slug]`, `/bundle/[slug]`, or `/merch/[slug]`), confirm the variant selector is keyboard-operable and “Add to cart” updates the toast.
   - On `/bundle/[slug]`, confirm the fixed composition remains visible when an item is sold out, the card/detail sold-out indicators are textual, and the affected bundle variant cannot be added.
   - On `/cart`, adjust quantities and submit checkout.
3. Launch VoiceOver (macOS) or NVDA (Windows):
   - Read the product page, ensuring variant options announce the selected state.
   - Verify Quick Shop modal announces title, description, and product image alt text.

### 1.2 Mobile Device Rendering

Do not use a resized desktop viewport as mobile validation. Run the real browser
surface with Chrome device emulation so the user agent, device scale factor,
touch input, mobile viewport, and safe-area behavior match a phone.

1. Validate at least the `Pixel 7` and `iPhone 15 Pro` Chrome device profiles.
2. Check `/`, `/catalog`, a representative route for each typed product family,
   and `/cart`.
3. Confirm the document width matches the viewport width (`scrollWidth ===
clientWidth`); intentional carousels must clip or scroll within their own
   container instead of widening the page.
4. Confirm the app bar spans the viewport, content remains inside its side
   gutters, long product titles wrap, and every control remains touchable.
5. Capture and inspect a real rendered screenshot for each changed mobile
   surface before sign-off.

### 1.3 Lighthouse Baseline

Run Lighthouse (Chrome DevTools or CLI) for both Desktop and Mobile on:

- `/`
- `/catalog`
- `/music-release/{slug}`
- `/bundle/{slug}`
- `/merch/{slug}`
- `/cart`

Target metrics:

| Metric         | Desktop | Mobile |
| -------------- | ------- | ------ |
| Performance    | ≥ 90    | ≥ 85   |
| LCP            | < 2.5s  | < 2.5s |
| Accessibility  | ≥ 95    | ≥ 95   |
| Best Practices | ≥ 95    | ≥ 95   |

Capture JSON reports and stash in CI artifacts (or note scores in PR description). Investigate regressions immediately.

### 1.4 Automated Checks

```bash
# Static analysis and type safety
pnpm exec eslint --ext .ts,.tsx src
pnpm run typecheck

# Backend type safety (ensures transformers stay in sync)
pnpm --filter backend exec tsc --noEmit
```

---

## 2. Stripe Payment Matrix

### 2.1 Environment

- Ensure backend `.env` includes `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Start backend and listen for Stripe webhooks:

```bash
stripe login
stripe listen --forward-to localhost:9000/api/webhooks/stripe
```

Record the webhook secret printed by the CLI and mirror it in `.env`.

### 2.2 Test Cards

| Scenario           | Card                                                                                                                 | Expected                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Standard payment   | `4242 4242 4242 4242`                                                                                                | Checkout completes → Medusa order created |
| 3DS challenge      | `4000 0027 6000 3184`                                                                                                | 3DS modal appears, confirm success        |
| Insufficient funds | `4000 0000 0000 9995`                                                                                                | Stripe declines, storefront shows error   |
| Refund flow        | Run successful payment above, then trigger refund in Medusa admin/dashboard and confirm Stripe + order status update |

For each run:

1. Create cart with ≥1 item.
2. Checkout via storefront (Quick Shop or PDP).
3. After redirect, ensure `/order/confirmed` loads with correct data.
4. Inspect backend logs for webhook processing (`stripe_checkout_completed_event_id` metadata) to confirm idempotency.

Document results in PR or release notes.

---

## 3. Meilisearch Observability & Sync

### 3.1 Manual Rebuild

Whenever product schemas or the transformer change:

```bash
pnpm --filter backend run search:sync
```

Watch backend logs for completion message:

```
[meilisearch] Indexed N product(s) into 'products'
```

### 3.2 CRUD Consistency Check

Run the following sequence:

1. **Create**: Add a new product via Medusa admin/CLI, verify `products` index count increases (`GET /indexes/products/stats`).
2. **Update**: Change title, tags, and price; confirm Meilisearch document reflects changes (`GET /indexes/products/documents/{id}`).
3. **Delete**: Remove the product; ensure document disappears and storefront search no longer shows it.

Helper command: `pnpm --filter backend run search:check` compares Medusa product count against Meilisearch documents and reports mismatches.

Helpful Meilisearch queries:

```bash
# List documents
curl -H "Authorization: Bearer $MEILISEARCH_ADMIN_KEY" \
  "$MEILISEARCH_HOST/indexes/products/search" \
  -d '{ "q": "demo", "limit": 5 }'

# Index stats
curl -H "Authorization: Bearer $MEILISEARCH_ADMIN_KEY" \
  "$MEILISEARCH_HOST/indexes/products/stats"
```

Fill in observed counts in the release checklist.

### 3.3 Monitoring Hooks

- Add log shipping or dashboard alerting around the `search:sync` command in CI/CD if run automatically.
- For production, monitor webhook or background jobs that update products. Emit metrics (`products_indexed_total`) if integrating with a metrics stack.

---

## 4. Sign-off Checklist

- [ ] ESLint + TypeScript checks (storefront + backend) pass.
- [ ] Lighthouse thresholds met on target routes.
- [ ] Keyboard and screen-reader smoke tests completed.
- [ ] Stripe payment matrix executed, webhook confirmed.
- [ ] Meilisearch CRUD validation performed, counts recorded.
- [ ] README/QA runbook updated if new steps discovered.

Document results in PR description or release notes; failing any step is a blocker until resolved.
