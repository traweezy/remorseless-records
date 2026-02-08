import type { NextConfig } from "next"
import type { RemotePattern } from "next/dist/shared/lib/image-config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === "production"

const parseRemotePattern = (value?: string | null): RemotePattern | null => {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`)
    const pattern: RemotePattern = {
      protocol: (url.protocol.replace(":", "") as RemotePattern["protocol"]) ?? "https",
      hostname: url.hostname,
    }
    if (url.port) {
      pattern.port = url.port
    }
    return pattern
  } catch {
    const sanitized = value.replace(/^https?:\/\//, "")
    return {
      protocol: "https",
      hostname: sanitized,
    }
  }
}

const parseOrigin = (value?: string | null): string | null => {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

const unique = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))))

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

const dynamicOrigins = unique([
  parseOrigin(process.env.NEXT_PUBLIC_SITE_URL),
  parseOrigin(process.env.NEXT_PUBLIC_BASE_URL),
  parseOrigin(process.env.NEXT_PUBLIC_MEDUSA_URL),
  parseOrigin(process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL),
  parseOrigin(process.env.MEDUSA_BACKEND_URL),
  parseOrigin(process.env.NEXT_PUBLIC_MEDIA_URL),
  parseOrigin(process.env.NEXT_PUBLIC_ASSET_HOST),
  parseOrigin(process.env.NEXT_PUBLIC_CDN_HOST),
  parseOrigin(process.env.NEXT_PUBLIC_MEILI_HOST),
  parseOrigin(process.env.NEXT_PUBLIC_SEARCH_ENDPOINT),
])

const stripeOrigins = [
  "https://js.stripe.com",
  "https://api.stripe.com",
  "https://hooks.stripe.com",
  "https://m.stripe.network",
  "https://q.stripe.com",
  "https://checkout.stripe.com",
]

const imageOrigins = unique([
  "https://medusa-public-images.s3.eu-west-1.amazonaws.com",
  "https://medusa-server-testing.s3.amazonaws.com",
  "https://medusa-server-testing.s3.us-east-1.amazonaws.com",
  "https://assets.bigcartel.com",
  "https://images.unsplash.com",
  ...dynamicOrigins,
])

const scriptSrc = unique([
  "'self'",
  "'unsafe-inline'",
  !isProduction ? "'unsafe-eval'" : null,
  "https://js.stripe.com",
])

const styleSrc = ["'self'", "'unsafe-inline'"]

const connectSrc = unique([
  "'self'",
  ...dynamicOrigins,
  ...stripeOrigins,
])

const frameSrc = unique([
  "'self'",
  "https://js.stripe.com",
  "https://hooks.stripe.com",
  "https://checkout.stripe.com",
  "https://bandcamp.com",
  "https://*.bandcamp.com",
])

const cspDirectives = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  `style-src ${styleSrc.join(" ")}`,
  `img-src 'self' data: blob: ${imageOrigins.join(" ")}`,
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(" ")}`,
  `frame-src ${frameSrc.join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  ...(isProduction ? ["upgrade-insecure-requests", "block-all-mixed-content"] : []),
]

const contentSecurityPolicy = cspDirectives.join("; ")

const BUILD_YEAR = new Date().getUTCFullYear().toString()
const experimentalConfig: NonNullable<NextConfig["experimental"]> = {}

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_BUILD_YEAR: BUILD_YEAR,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      ...dynamicRemotePatterns,
      {
        protocol: "https",
        hostname: "medusa-public-images.s3.eu-west-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.us-east-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "assets.bigcartel.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  experimental: experimentalConfig,
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
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
              "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
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
    ]
  },
  turbopack: {
    root: path.resolve(currentDir, ".."),
  },
}

export default nextConfig
