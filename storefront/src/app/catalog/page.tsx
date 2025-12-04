import type { Metadata } from "next"

import ProductsPage, { metadata as productsMetadata, revalidate as productsRevalidate } from "@/app/products/page"

export const metadata: Metadata = productsMetadata
export const revalidate = productsRevalidate

export default ProductsPage
