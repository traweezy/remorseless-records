const excludedPaths = ["/checkout", "/account/*"]
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_BASE_URL ??
  "https://www.remorselessrecords.com"

module.exports = {
  siteUrl,
  generateRobotsTxt: true,
  exclude: [...excludedPaths, "/sitemap.xml"],
  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/",
      },
      {
        userAgent: "*",
        disallow: excludedPaths,
      },
    ],
    additionalSitemaps: [`${siteUrl}/sitemap.xml`],
  },
}
