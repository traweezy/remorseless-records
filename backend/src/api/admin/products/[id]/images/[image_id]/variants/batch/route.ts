import { POST as nativePost } from "@medusajs/medusa/api/admin/products/[id]/images/[image_id]/variants/batch/route"

import { guardNativeMediaHandler } from "@/lib/catalog/native-media-guard"

export const POST = guardNativeMediaHandler("image-variants", nativePost)
