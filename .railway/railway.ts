import { defineRailway, github, preserve, project, service } from "railway/iac"

// Keep this stable: Railway uses the partial name to scope omit-as-delete.
export const partial = "applications"

const SHARED_BUILD_WATCH_PATTERNS = [
  "/.nvmrc",
  "/package.json",
  "/pnpm-lock.yaml",
  "/pnpm-workspace.yaml",
  "/patches/**",
] as const

export default defineRailway(() => {
  if (process.env.RAILWAY_IAC_TARGET_ENVIRONMENT !== "staging") {
    throw new Error(
      "Railway IaC is staging-only until production is explicitly approved."
    )
  }

  const remorselessRecords = github("traweezy/remorseless-records", {
    branch: "staging",
    checkSuites: true,
    rootDirectory: "/",
  })

  const Backend = service("Backend", {
    source: remorselessRecords,
    build: {
      builder: "RAILPACK",
      buildCommand: "pnpm --filter backend run build",
      buildEnvironment: "V3",
      watchPatterns: ["/backend/**", ...SHARED_BUILD_WATCH_PATTERNS],
    },
    healthcheck: "/ready",
    healthcheckTimeout: 300,
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: {
      preDeployCommand: ["pnpm --filter backend --silent run release:prepare"],
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    start: "pnpm --filter backend --silent run start",
    networking: { privateNetworkEndpoint: "backend" },
    env: {
      ABANDONED_CHECKOUT_RETENTION_DAYS: preserve(),
      ABANDONED_CHECKOUT_RETENTION_ENABLED: preserve(),
      ABANDONED_CHECKOUT_RETENTION_MAX_DELETIONS: preserve(),
      ADMIN_CORS: preserve(),
      ANONYMOUS_CART_RETENTION_DAYS: preserve(),
      ANONYMOUS_CART_RETENTION_ENABLED: preserve(),
      ANONYMOUS_CART_RETENTION_MAX_DELETIONS: preserve(),
      AUTH_CORS: preserve(),
      CHECKOUT_BFF_SECRET: preserve(),
      CHECKOUT_BFF_SECRET_PREVIOUS: preserve(),
      CHECKOUT_RECONCILIATION_ENABLED: preserve(),
      CHECKOUT_RECONCILIATION_MAX_ATTEMPTS: preserve(),
      CHECKOUT_RECONCILIATION_MIN_AGE_SECONDS: preserve(),
      COOKIE_SECRET: preserve(),
      DATABASE_MIGRATION_URL: preserve(),
      DATABASE_ROLE_SPLIT_REQUIRED: preserve(),
      DATABASE_URL: preserve(),
      JWT_SECRET: preserve(),
      MEDUSA_FF_RBAC: preserve(),
      MEDUSA_FF_VIEW_CONFIGURATIONS: preserve(),
      MEDUSA_PUBLISHABLE_KEY: preserve(),
      MEILISEARCH_ADMIN_KEY: preserve(),
      MEILISEARCH_HOST: preserve(),
      MEILISEARCH_MASTER_KEY: preserve(),
      MINIO_ACCESS_KEY: preserve(),
      MINIO_ENDPOINT: preserve(),
      MINIO_SECRET_KEY: preserve(),
      NODE_ENV: preserve(),
      OTEL_EXPORTER_OTLP_ENDPOINT: preserve(),
      OTEL_EXPORTER_OTLP_HEADERS: preserve(),
      OTEL_EXPORTER_OTLP_PROTOCOL: preserve(),
      OTEL_METRICS_EXPORTER: preserve(),
      OTEL_SDK_DISABLED: preserve(),
      OTEL_TRACES_EXPORTER: preserve(),
      PUBLIC_FORM_BFF_SECRET: preserve(),
      PUBLIC_FORM_BFF_SECRET_PREVIOUS: preserve(),
      RAILWAY_HEALTHCHECK_TIMEOUT_SEC: preserve(),
      RAILWAY_PUBLIC_DOMAIN_VALUE: preserve(),
      REDIS_URL: preserve(),
      RESEND_API_KEY: preserve(),
      RESEND_FROM: preserve(),
      STORE_CORS: preserve(),
      STRIPE_API_KEY: preserve(),
      STRIPE_LIFECYCLE_WEBHOOK_SECRET: preserve(),
      STRIPE_PAYMENT_METHOD_CONFIGURATION: preserve(),
      STRIPE_TAX_SHIPPING_TAX_CODE: preserve(),
      STRIPE_WEBHOOK_SECRET: preserve(),
      TAX_RATE_LOOKUP_API_KEY: preserve(),
      TAX_RATE_LOOKUP_CACHE_TTL_MS: preserve(),
      TAX_RATE_LOOKUP_MODE: preserve(),
      TAX_RATE_LOOKUP_PROVIDER: preserve(),
      TEMPLATE_REPORTER_URL: preserve(),
    },
  })
  const Storefront = service("Storefront", {
    source: remorselessRecords,
    build: {
      builder: "RAILPACK",
      buildCommand: "pnpm --filter remorseless-records-storefront run build",
      watchPatterns: ["/storefront/**", ...SHARED_BUILD_WATCH_PATTERNS],
    },
    start: "pnpm --filter remorseless-records-storefront --silent run start",
    healthcheck: "/ready",
    healthcheckTimeout: 180,
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: {
      preDeployCommand: [],
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    networking: { privateNetworkEndpoint: "storefront" },
    env: {
      CART_COOKIE_SECRET: preserve(),
      CART_COOKIE_SECRET_PREVIOUS: preserve(),
      CHECKOUT_BFF_SECRET: preserve(),
      CHECKOUT_RECEIPT_SECRET: preserve(),
      CHECKOUT_RECEIPT_SECRET_PREVIOUS: preserve(),
      MEDUSA_BACKEND_URL: preserve(),
      MEILISEARCH_API_KEY: preserve(),
      MEILISEARCH_HOST: "${{Backend.MEILISEARCH_HOST}}",
      NEXT_PUBLIC_BANDCAMP_ALBUM_ID: preserve(),
      NEXT_PUBLIC_BANDCAMP_ALBUM_SLUG: preserve(),
      NEXT_PUBLIC_BASE_URL: preserve(),
      NEXT_PUBLIC_INDEX_NAME: preserve(),
      NEXT_PUBLIC_MEDIA_URL: preserve(),
      NEXT_PUBLIC_MEDUSA_BACKEND_URL: preserve(),
      NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: preserve(),
      NEXT_PUBLIC_MINIO_ENDPOINT: preserve(),
      NEXT_PUBLIC_SEARCH_ENDPOINT: preserve(),
      NEXT_PUBLIC_STRIPE_KEY: preserve(),
      NEXT_PUBLIC_STRIPE_PK: preserve(),
      NPM_CONFIG_FORCE: preserve(),
      OTEL_EXPORTER_OTLP_ENDPOINT: preserve(),
      OTEL_EXPORTER_OTLP_HEADERS: preserve(),
      OTEL_EXPORTER_OTLP_PROTOCOL: preserve(),
      OTEL_METRICS_EXPORTER: preserve(),
      OTEL_SDK_DISABLED: preserve(),
      OTEL_TRACES_EXPORTER: preserve(),
      PUBLIC_FORM_BFF_SECRET: preserve(),
      REDIS_URL:
        "redis://${{Redis.REDISUSER}}:${{Redis.REDISPASSWORD}}@${{Redis.RAILWAY_PRIVATE_DOMAIN}}:6379",
    },
  })
  return project("store", {
    resources: [Backend, Storefront],
  })
})
