import type { CreateNotificationDTO } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";

const EMAIL_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,256}$/;
const PROVIDER_IDEMPOTENCY_FIELD = "idempotency_key";

type EmailIdempotencyFields = Pick<
  CreateNotificationDTO,
  "idempotency_key" | "provider_data"
>;

const normalizeEmailIdempotencyKey = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return EMAIL_IDEMPOTENCY_KEY_PATTERN.test(normalized) ? normalized : null;
};

export const emailIdempotencyFields = (
  idempotencyKey: string,
): EmailIdempotencyFields => {
  const normalized = normalizeEmailIdempotencyKey(idempotencyKey);
  if (!normalized) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The email idempotency key is invalid.",
    );
  }
  return {
    idempotency_key: normalized,
    provider_data: { [PROVIDER_IDEMPOTENCY_FIELD]: normalized },
  };
};

export const emailProviderIdempotencyKey = (
  providerData: Record<string, unknown> | null | undefined,
): string | null =>
  normalizeEmailIdempotencyKey(providerData?.[PROVIDER_IDEMPOTENCY_FIELD]);
