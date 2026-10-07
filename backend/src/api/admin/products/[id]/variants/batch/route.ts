import { POST as nativePost } from "@medusajs/medusa/api/admin/products/[id]/variants/batch/route"

import { guardNativeMediaHandler } from "@/lib/catalog/native-media-guard"

export const POST = guardNativeMediaHandler("variants-batch", nativePost)
