import type { MetadataRoute } from "next"

import { siteMetadata } from "@/config/site"
import { getAllProductHandles } from "@/lib/data/products"

const STATIC_ROUTES: Array<{ path: string; changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "/", changeFrequency: "weekly" },
  { path: "/catalog", changeFrequency: "daily" },
  { path: "/cart", changeFrequency: "weekly" },
  { path: "/order/confirmed", changeFrequency: "weekly" },
  { path: "/about", changeFrequency: "monthly" },
  { path: "/submissions", changeFrequency: "monthly" },
  { path: "/press", changeFrequency: "monthly" },
  { path: "/contact", changeFrequency: "weekly" },
  { path: "/help/shipping", changeFrequency: "weekly" },
  { path: "/faq", changeFrequency: "weekly" },
]

const sitemap = async (): Promise<MetadataRoute.Sitemap> => {
  const now = new Date()
  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: new URL(route.path, siteMetadata.siteUrl).toString(),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.path === "/" ? 1 : 0.8,
  }))

  const products = await getAllProductHandles()
  products.forEach((product) => {
    const pathSegment =
      product.handle?.trim()?.length
        ? product.handle.trim()
        : `${product.slug.artistSlug}-${product.slug.albumSlug}`
    const productUrl = `${siteMetadata.siteUrl}/products/${pathSegment}`
    entries.push({
      url: productUrl,
      lastModified: product.updatedAt ? new Date(product.updatedAt) : now,
      changeFrequency: "daily",
      priority: 0.7,
    })
  })

  return entries
}

export default sitemap
