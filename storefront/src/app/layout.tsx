import type { Metadata, Viewport } from "next"
import { cookies, headers } from "next/headers"
import { Suspense } from "react"

import "@/styles/globals.css"
import "@/styles/fonts.css"
import fontSources from "../../public/fonts/sources.json"
import BackToTopButton from "@/components/back-to-top-button"
import SiteFooter from "@/components/site-footer"
import SiteHeader from "@/components/site-header"
import QueryProvider from "@/components/providers/query-provider"
import { Toaster } from "@/components/ui/sonner"
import { CartProvider } from "@/providers/cart-provider"
import JsonLd from "@/components/json-ld"
import CookieConsentBanner from "@/components/legal/cookie-consent-banner"
import { CookieConsentProvider } from "@/components/legal/cookie-consent-provider"
import ConsentAwareWebVitalsReporter from "@/components/consent-aware-web-vitals-reporter"
import { siteMetadata } from "@/config/site"
import { organizationJsonLd, webSiteJsonLd } from "@/lib/seo/structured-data"
import {
  COOKIE_PREFERENCES_COOKIE_NAME,
  parseCookiePreferences,
} from "@/lib/legal/cookie-consent"

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
      "application/rss+xml": new URL(
        siteMetadata.rssPath,
        siteMetadata.siteUrl
      ).toString(),
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

const RootLayout = async ({ children }: RootLayoutProps) => {
  const [requestHeaders, cookieStore] = await Promise.all([
    headers(),
    cookies(),
  ])
  const nonce = requestHeaders.get("x-nonce") ?? undefined
  const initialCookiePreferences = parseCookiePreferences(
    cookieStore.get(COOKIE_PREFERENCES_COOKIE_NAME)?.value
  )

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="site-fonts bg-background text-foreground"
    >
      <head>
        {Array.from(fontSources.preloads).map((href) => (
          <link
            key={href}
            rel="preload"
            href={href}
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        ))}
      </head>
      <body
        className={[
          "min-h-screen bg-background text-foreground antialiased overflow-x-hidden",
        ].join(" ")}
      >
        <QueryProvider>
          <CartProvider>
            <CookieConsentProvider
              initialPreferences={initialCookiePreferences}
            >
              <ConsentAwareWebVitalsReporter />
              <div className="relative flex min-h-screen flex-col bg-background">
                <Suspense
                  fallback={
                    <div
                      className="relative h-16 w-full shrink-0 border-b border-border/40 bg-background/80"
                      aria-hidden="true"
                    />
                  }
                >
                  <SiteHeader />
                </Suspense>
                <main
                  id="main-content"
                  tabIndex={-1}
                  className="flex-1 min-h-0 flex flex-col"
                >
                  {children}
                </main>
                <SiteFooter />
                <BackToTopButton />
              </div>
              <CookieConsentBanner />
            </CookieConsentProvider>
          </CartProvider>
          <Toaster />
        </QueryProvider>
        <JsonLd
          id="remorseless-organization"
          data={organizationJsonLd}
          {...(nonce ? { nonce } : {})}
        />
        <JsonLd
          id="remorseless-website"
          data={webSiteJsonLd}
          {...(nonce ? { nonce } : {})}
        />
      </body>
    </html>
  )
}

export default RootLayout
