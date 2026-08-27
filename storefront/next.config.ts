import type { NextConfig } from "next"
import type { RemotePattern } from "next/dist/shared/lib/image-config"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { parseAllowedOrigin } from "./src/config/content-security-policy"

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = process.env.NODE_ENV === "development"

const parseRemotePattern = (value?: string | null): RemotePattern | null => {
  const origin = parseAllowedOrigin(value)
  if (!origin) {
    return null
  }

  const url = new URL(origin)
  if (!isDevelopment && url.protocol !== "https:") {
    return null
  }

  const pattern: RemotePattern = {
    protocol: url.protocol === "http:" ? "http" : "https",
    hostname: url.hostname,
  }
  if (url.port) {
    pattern.port = url.port
  }
  return pattern
}

const dynamicRemotePatterns: RemotePattern[] = [
  parseRemotePattern(process.env.NEXT_PUBLIC_MEDUSA_URL),
  parseRemotePattern(process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL),
  parseRemotePattern(process.env.MEDUSA_BACKEND_URL),
  parseRemotePattern(process.env.NEXT_PUBLIC_MEDIA_URL),
  parseRemotePattern(process.env.NEXT_PUBLIC_ASSET_HOST),
  parseRemotePattern(process.env.NEXT_PUBLIC_CDN_HOST),
  parseRemotePattern(process.env.NEXT_PUBLIC_MEILI_HOST),
  parseRemotePattern(process.env.NEXT_PUBLIC_SEARCH_ENDPOINT),
].filter((pattern): pattern is RemotePattern => Boolean(pattern))

const BUILD_YEAR = new Date().getUTCFullYear().toString()
const experimentalConfig: NonNullable<NextConfig["experimental"]> = {
  sri: {
    algorithm: "sha256",
  },
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_BUILD_YEAR: BUILD_YEAR,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: dynamicRemotePatterns,
  },
  experimental: experimentalConfig,
  reactCompiler: true,
  async redirects() {
    return await Promise.resolve([
      {
        source: "/products",
        destination: "/catalog",
        permanent: true,
      },
      {
        source: "/products/music-release-:slug",
        destination: "/music-release/:slug",
        permanent: true,
      },
      {
        source: "/products/fixed-bundle-:slug",
        destination: "/bundle/:slug",
        permanent: true,
      },
      {
        source: "/products/mystery-bundle-:slug",
        destination: "/bundle/:slug",
        permanent: true,
      },
      {
        source: "/products/merch-:slug",
        destination: "/merch/:slug",
        permanent: true,
      },
    ])
  },
  async headers() {
    return await Promise.resolve([
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(self "https://js.stripe.com" "https://hooks.stripe.com"), usb=()',
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-site",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ])
  },
  turbopack: {
    root: path.resolve(currentDir, ".."),
  },
}

export default nextConfig
