import type { TaxProviderName } from "../../modules/tax-control/constants";
import { createTaxContextFingerprint } from "./context";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const sorted = (values: unknown[]): unknown[] =>
  [...values].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );

const adjustmentsFrom = (value: unknown): UnknownRecord[] =>
  (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((adjustment): adjustment is UnknownRecord => adjustment !== null);

export const createTaxSubjectFingerprint = ({
  generation,
  orderOrCart,
  provider,
}: {
  generation: number;
  orderOrCart: UnknownRecord;
  provider: TaxProviderName;
}): string => {
  const address = asRecord(orderOrCart.shipping_address);
  const items = Array.isArray(orderOrCart.items)
    ? orderOrCart.items
        .map(asRecord)
        .filter((item): item is UnknownRecord => item !== null)
        .map((item) => ({
          id: text(item.id),
          productId: text(item.product_id),
          productTypeId: text(item.product_type_id),
          quantity: String(item.quantity ?? ""),
          unitPrice: String(item.unit_price ?? ""),
          adjustments: sorted(
            adjustmentsFrom(item.adjustments).map((adjustment) => ({
              amount: String(adjustment.amount ?? ""),
              inclusive: adjustment.is_tax_inclusive === true,
            })),
          ),
        }))
    : [];
  const shippingMethods = Array.isArray(orderOrCart.shipping_methods)
    ? orderOrCart.shipping_methods
        .map(asRecord)
        .filter((method): method is UnknownRecord => method !== null)
        .map((method) => ({
          amount: String(method.amount ?? ""),
          optionId: text(method.shipping_option_id),
          adjustments: sorted(
            adjustmentsFrom(method.adjustments).map((adjustment) => ({
              amount: String(adjustment.amount ?? ""),
              inclusive: adjustment.is_tax_inclusive === true,
            })),
          ),
        }))
    : [];

  return createTaxContextFingerprint({
    address: {
      address1: text(address?.address_1),
      address2: text(address?.address_2),
      city: text(address?.city),
      countryCode: text(address?.country_code)?.toLowerCase(),
      postalCode: text(address?.postal_code),
      province: text(address?.province)?.toLowerCase(),
    },
    currencyCode: text(orderOrCart.currency_code)?.toLowerCase(),
    generation,
    items: sorted(items),
    provider,
    shippingMethods: sorted(shippingMethods),
    subjectId: text(orderOrCart.id),
  });
};
