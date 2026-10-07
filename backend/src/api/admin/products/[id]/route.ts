import { POST as nativePost } from "@medusajs/medusa/api/admin/products/[id]/route"

import { guardNativeMediaHandler } from "@/lib/catalog/native-media-guard"

export const POST = guardNativeMediaHandler("product", nativePost)
