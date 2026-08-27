type SecurityHeaderOptions = {
  isDevelopment: boolean;
  mediaUrls?: ReadonlyArray<string | null | undefined>;
};

const unique = (values: Array<string | null>): string[] =>
  Array.from(
    new Set(values.filter((value): value is string => value !== null)),
  );

export const parseSecurityHeaderOrigin = (
  value: string | null | undefined,
): string | null => {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`,
    );
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

export const buildBackendContentSecurityPolicy = ({
  isDevelopment,
  mediaUrls = [],
}: SecurityHeaderOptions): string => {
  const mediaOrigins = unique(mediaUrls.map(parseSecurityHeaderOrigin)).filter(
    (origin) => isDevelopment || origin.startsWith("https://"),
  );
  const scriptSources = ["'self'", ...(isDevelopment ? ["'unsafe-eval'"] : [])];
  const connectSources = [
    "'self'",
    ...(isDevelopment
      ? ["http://localhost:*", "ws://localhost:*", "ws://127.0.0.1:*"]
      : []),
  ];
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${mediaOrigins.length ? ` ${mediaOrigins.join(" ")}` : ""}`,
    `media-src 'self' blob:${mediaOrigins.length ? ` ${mediaOrigins.join(" ")}` : ""}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(isDevelopment
      ? []
      : ["upgrade-insecure-requests", "block-all-mixed-content"]),
  ];

  return directives.join("; ");
};

export const buildBackendSecurityHeaders = (
  options: SecurityHeaderOptions,
): Readonly<Record<string, string>> => {
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildBackendContentSecurityPolicy(options),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };

  if (!options.isDevelopment) {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }

  return headers;
};

export const shouldDefaultToNoStore = (
  method: string | undefined,
  path: string | undefined,
): boolean => {
  const normalizedMethod = method?.toUpperCase() ?? "GET";
  const normalizedPath = path ?? "/";
  const isPublicAsset =
    normalizedPath.startsWith("/app/assets/") ||
    normalizedPath.startsWith("/static/");

  return (
    (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") ||
    !isPublicAsset
  );
};
