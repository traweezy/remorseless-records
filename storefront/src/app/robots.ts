import type { MetadataRoute } from "next"

import { siteMetadata } from "@/config/site"

const DISALLOWED_PATHS = ["/cart", "/checkout", "/order/confirmed", "/account", "/api"]

const robots = (): MetadataRoute.Robots => ({
  rules: [
    {
      userAgent: "*",
      allow: "/",
      disallow: DISALLOWED_PATHS,
    },
  ],
  sitemap: [`${siteMetadata.siteUrl}/sitemap.xml`],
})

export default robots
