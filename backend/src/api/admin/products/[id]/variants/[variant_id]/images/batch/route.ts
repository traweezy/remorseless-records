import { POST as nativePost } from "@medusajs/medusa/api/admin/products/[id]/variants/[variant_id]/images/batch/route"

import { guardNativeMediaHandler } from "@/lib/catalog/native-media-guard"

export const POST = guardNativeMediaHandler("variant-images", nativePost)
