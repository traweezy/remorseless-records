import { POST as nativePost } from "@medusajs/medusa/api/admin/products/batch/route"

import { guardNativeMediaHandler } from "@/lib/catalog/native-media-guard"

export const POST = guardNativeMediaHandler("products-batch", nativePost)
