import type { NextConfig } from "next"
import type { RemotePattern } from "next/dist/shared/lib/image-config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const currentDir = path.dirname(fileURLToPath(import.meta.url))

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

const dynamicRemotePatterns: RemotePattern[] = [
  parseRemotePattern(process.env.NEXT_PUBLIC_MEDUSA_URL),
  parseRemotePattern(process.env.NEXT_PUBLIC_MEDIA_URL),
  parseRemotePattern(process.env.NEXT_PUBLIC_ASSET_HOST),
].filter((pattern): pattern is RemotePattern => Boolean(pattern))

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
    ],
  },
  reactCompiler: true,
  turbopack: {
    root: path.resolve(currentDir, ".."),
  },
}

export default nextConfig
