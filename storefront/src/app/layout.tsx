import type { Metadata, Viewport } from "next"
import {
  Bebas_Neue,
  Inter,
  JetBrains_Mono,
  Teko,
} from "next/font/google"

import "@/styles/globals.css"
import { runtimeEnv } from "@/config/env"
import SiteFooter from "@/components/site-footer"
import SiteHeader from "@/components/site-header"

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

const siteUrl = new URL(runtimeEnv.medusaBackendUrl)

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "Remorseless Records",
    template: "%s · Remorseless Records",
  },
  description:
    "Death. Doom. Grind. A brutal maximalist storefront for the underground heavy music scene.",
  applicationName: "Remorseless Records",
  keywords: [
    "metal",
    "death metal",
    "doom",
    "grindcore",
    "vinyl",
    "underground music",
    "records",
  ],
  authors: [{ name: "Remorseless Records" }],
  openGraph: {
    title: "Remorseless Records",
    description:
      "Death. Doom. Grind. A brutal maximalist storefront for the underground heavy music scene.",
    url: siteUrl.toString(),
    siteName: "Remorseless Records",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@remorseless_records",
    creator: "@remorseless_records",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
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
          "min-h-screen bg-background text-foreground antialiased",
        ].join(" ")}
      >
        <div className="relative flex min-h-screen flex-col bg-background">
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}
