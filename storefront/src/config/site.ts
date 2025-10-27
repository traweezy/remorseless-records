import { runtimeEnv } from "@/config/env"

const FALLBACK_SITE_URL = "https://www.remorselessrecords.com"

const resolveUrl = (path: string): string => {
  const base = runtimeEnv.siteUrl ?? FALLBACK_SITE_URL
  return new URL(path, base).toString()
}

export const siteMetadata = {
  name: "Remorseless Records",
  shortName: "Remorseless",
  tagline: "Death, doom, sludge, and subterranean rituals.",
  description:
    "Remorseless Records is an underground metal label curating limited-run doom, sludge, death, and stoner releases with archival-grade packaging and global fulfillment.",
  siteUrl: runtimeEnv.siteUrl ?? FALLBACK_SITE_URL,
  defaultLocale: "en-US",
  keywords: [
    "remorseless records",
    "doom metal vinyl",
    "death metal merch",
    "sludge metal label",
    "underground metal store",
    "limited edition cassettes",
    "extreme music",
    "metal record label",
  ],
  socials: {
    instagram: "https://www.instagram.com/remorseless_records/",
    bandcamp: null,
    youtube: null,
    threads: null,
  },
  contact: {
    email: "ops@remorselessrecords.com",
    phone: "+1-602-969-6660",
    address: {
      street: "PO Box 666",
      locality: "Phoenix",
      region: "AZ",
      postalCode: "85001",
      country: "US",
    },
  },
  assets: {
    heroLogo: resolveUrl("/remorseless-hero-logo.png"),
    headerLogo: resolveUrl("/remorseless-header-logo.png"),
    ogImage: resolveUrl("/remorseless-hero-logo.png"),
  },
  searchPathTemplate: "/products?query={search_term_string}",
  rssPath: "/feed.xml",
}

export const seoHelpers = {
  absolute: resolveUrl,
}
