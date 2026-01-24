import type { HttpTypes } from "@medusajs/types"

export type StoreCartAddressInput = Omit<
  HttpTypes.StoreCartAddress,
  "id" | "created_at" | "updated_at"
>
