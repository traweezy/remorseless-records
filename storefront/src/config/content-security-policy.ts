const DYNAMIC_ORIGIN_ENVIRONMENT_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_MEDUSA_URL",
  "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
  "MEDUSA_BACKEND_URL",
  "NEXT_PUBLIC_MEDIA_URL",
  "NEXT_PUBLIC_ASSET_HOST",
  "NEXT_PUBLIC_CDN_HOST",
  "NEXT_PUBLIC_SEARCH_ENDPOINT",
] as const

type ContentSecurityPolicyEnvironment = Readonly<
  Record<string, string | undefined>
>

type ContentSecurityPolicyOptions = {
  environment?: ContentSecurityPolicyEnvironment
  isDevelopment: boolean
  nonce: string
}

const CONTENT_SECURITY_POLICY_NONCE_PATTERN = /^[A-Za-z\d+/_-]{16,128}={0,2}$/

const unique = (values: Array<string | null>): string[] =>
  Array.from(new Set(values.filter((value): value is string => value !== null)))

export const parseAllowedOrigin = (
  value: string | null | undefined
): string | null => {
  const candidate = value?.trim()
  if (!candidate) {
    return null
  }

  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`
    )
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export const resolveDynamicOrigins = (
  environment: ContentSecurityPolicyEnvironment
): string[] =>
  unique(
    DYNAMIC_ORIGIN_ENVIRONMENT_KEYS.map((key) =>
      parseAllowedOrigin(environment[key])
    )
  )

export const createContentSecurityPolicyNonce = (): string =>
  crypto.randomUUID().replaceAll("-", "")

export const buildContentSecurityPolicy = ({
  environment = process.env,
  isDevelopment,
  nonce,
}: ContentSecurityPolicyOptions): string => {
  if (!CONTENT_SECURITY_POLICY_NONCE_PATTERN.test(nonce)) {
    throw new Error("Content Security Policy nonce is invalid")
  }

  const dynamicOrigins = resolveDynamicOrigins(environment).filter(
    (origin) => isDevelopment || origin.startsWith("https://")
  )
  const scriptSources = unique([
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    isDevelopment ? "'unsafe-eval'" : null,
    "https://js.stripe.com",
    "https://*.js.stripe.com",
  ])
  const connectSources = unique([
    "'self'",
    ...dynamicOrigins,
    "https://api.stripe.com",
    "https://m.stripe.network",
    "https://q.stripe.com",
    "https://link.com",
    "https://*.link.com",
  ])
  const imageSources = unique([
    "'self'",
    "data:",
    "blob:",
    ...dynamicOrigins,
    "https://*.stripe.com",
    "https://link.com",
    "https://*.link.com",
  ])
  const frameSources = [
    "'self'",
    "https://js.stripe.com",
    "https://*.js.stripe.com",
    "https://hooks.stripe.com",
    "https://link.com",
    "https://*.link.com",
    "https://bandcamp.com",
    "https://*.bandcamp.com",
  ]
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    `frame-src ${frameSources.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(isDevelopment
      ? []
      : ["upgrade-insecure-requests", "block-all-mixed-content"]),
  ]

  return directives.join("; ")
}
