import type { Metadata, Viewport } from "next"
import {
  Bebas_Neue,
  Inter,
  JetBrains_Mono,
  Teko,
} from "next/font/google"

import "@/styles/globals.css"
import SiteFooter from "@/components/site-footer"
import SiteHeader from "@/components/site-header"
import QueryProvider from "@/components/providers/query-provider"
import SpeculationRules from "@/components/providers/speculation-rules"
import QuicklinkProvider from "@/components/providers/quicklink-provider"
import ProximityPrefetch from "@/components/providers/proximity-prefetch"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { organizationJsonLd, webSiteJsonLd } from "@/lib/seo/structured-data"
import { Suspense } from "react"
import Script from "next/script"

const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bebas-neue",
})

const teko = Teko({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-teko",
})

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
})

const jetBrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
})

const siteUrl = new URL(siteMetadata.siteUrl)

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: siteMetadata.name,
    template: `%s · ${siteMetadata.name}`,
  },
  description: siteMetadata.description,
  applicationName: siteMetadata.name,
  category: "music",
  keywords: siteMetadata.keywords,
  authors: [{ name: siteMetadata.name }],
  creator: siteMetadata.name,
  publisher: siteMetadata.name,
  alternates: {
    canonical: siteMetadata.siteUrl,
    languages: {
      "en-US": siteMetadata.siteUrl,
    },
    types: {
      "application/rss+xml": new URL(siteMetadata.rssPath, siteMetadata.siteUrl).toString(),
    },
  },
  openGraph: {
    title: siteMetadata.name,
    description: siteMetadata.description,
    url: siteMetadata.siteUrl,
    siteName: siteMetadata.name,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: siteMetadata.assets.ogImage,
        alt: `${siteMetadata.name} hero`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@remorseless_records",
    creator: "@remorseless_records",
    title: siteMetadata.name,
    description: siteMetadata.description,
    images: [siteMetadata.assets.ogImage],
  },
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  appLinks: {
    web: {
      url: siteMetadata.siteUrl,
      should_fallback: true,
    },
  },
}

export const viewport: Viewport = {
  themeColor: "#060606",
}

type RootLayoutProps = {
  readonly children: React.ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="bg-background text-foreground"
    >
      <body
        className={[
          bebasNeue.variable,
          teko.variable,
          inter.variable,
          jetBrains.variable,
          "min-h-screen bg-background text-foreground antialiased overflow-x-hidden",
        ].join(" ")}
      >
        <QueryProvider>
          <Suspense fallback={null}>
            <QuicklinkProvider />
            <ProximityPrefetch>
              <div className="relative flex min-h-screen flex-col bg-background">
                <SiteHeader />
                <main className="flex-1 min-h-0">{children}</main>
                <SiteFooter />
              </div>
            </ProximityPrefetch>
          </Suspense>
        </QueryProvider>
        <SpeculationRules />
        <JsonLd id="remorseless-organization" data={organizationJsonLd} />
        <JsonLd id="remorseless-website" data={webSiteJsonLd} />
        <Script
          src="https://instant.page/5.2.0"
          strategy="afterInteractive"
          type="module"
          integrity="sha384-NhcfmErBuYkPpF8d6WvX2jc7Rbw7QvwszFTui2k+1XUuK3qjfbHwPzYIK5FjwZIj"
        />
      </body>
    </html>
  )
}
