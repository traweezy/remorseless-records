import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { resolveRemoteImagePatterns } from "./src/config/image-optimization"
import { validateStorefrontRuntimeSecrets } from "./src/config/runtime-secret-policy"

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = process.env.NODE_ENV === "development"
validateStorefrontRuntimeSecrets({
  isProduction: process.env.NODE_ENV === "production",
})

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
    remotePatterns: resolveRemoteImagePatterns({ isDevelopment }),
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
