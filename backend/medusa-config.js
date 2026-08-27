import { loadEnv, Modules, defineConfig } from '@medusajs/utils';
import {
  ADMIN_CORS,
  AUTH_CORS,
  BACKEND_URL,
  COOKIE_SECRET,
  DATABASE_URL,
  JWT_SECRET,
  REDIS_URL,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  SENDGRID_API_KEY,
  SENDGRID_FROM_EMAIL,
  SHOULD_DISABLE_ADMIN,
  STORE_CORS,
  STRIPE_API_KEY,
  STRIPE_LIFECYCLE_WEBHOOK_SECRET,
  STRIPE_PAYMENT_METHOD_CONFIGURATION,
  STRIPE_TAX_QUOTE_TTL_MS,
  STRIPE_TAX_SHIPPING_TAX_CODE,
  STRIPE_WEBHOOK_SECRET,
  TAX_RATE_LOOKUP_API_KEY,
  TAX_RATE_LOOKUP_MODE,
  TAX_RATE_LOOKUP_PROVIDER,
  WORKER_MODE,
  MEILISEARCH_HOST,
  MEILISEARCH_ADMIN_KEY
} from './src/lib/constants';
import productSearchTransformer from './src/lib/meilisearch/product-transformer';
import { resolveAdminRbacModuleConfig } from './src/lib/admin-rbac-config';
import { buildBackendResponseHeaders } from './src/lib/security/security-headers';
import { resolveObjectStorageConfig } from './src/lib/storage/config';
import { WORKFLOW_JOB_WORKER_OPTIONS } from './src/lib/workflow-worker-options';
import meilisearchSettings from './config/meilisearch-settings.json' assert { type: 'json' };
import zodStrictCspVitePlugin from './src/admin/lib/zod-strict-csp-vite-plugin.cjs';

loadEnv(process.env.NODE_ENV, process.cwd());

const isDevelopment = process.env.NODE_ENV === "development";
const isProduction = process.env.NODE_ENV === "production";
const objectStorageConfig = resolveObjectStorageConfig({
  required: isProduction,
});
const responseHeaders = buildBackendResponseHeaders({
  isDevelopment,
  mediaUrls: [process.env.MINIO_FILE_URL, BACKEND_URL],
});
const productIndexSettings = meilisearchSettings.products;
const meilisearchCandidateIndex = process.env.MEILISEARCH_CANDIDATE_INDEX?.trim();
const meilisearchIndexPattern = /^[a-zA-Z0-9_-]+$/;
const meilisearchConfigurationValues = [
  MEILISEARCH_HOST,
  MEILISEARCH_ADMIN_KEY,
];
const hasAnyMeilisearchConfiguration =
  meilisearchConfigurationValues.some(Boolean);
const hasCompleteMeilisearchConfiguration =
  meilisearchConfigurationValues.every(Boolean);

if (
  meilisearchCandidateIndex &&
  (
    meilisearchCandidateIndex === "products" ||
    !meilisearchIndexPattern.test(meilisearchCandidateIndex)
  )
) {
  throw new Error(
    "MEILISEARCH_CANDIDATE_INDEX must be a valid non-live Meilisearch index UID."
  );
}
if (
  (hasAnyMeilisearchConfiguration && !hasCompleteMeilisearchConfiguration) ||
  (isProduction && !hasCompleteMeilisearchConfiguration)
) {
  throw new Error(
    "MEILISEARCH_HOST and MEILISEARCH_ADMIN_KEY must be configured together in production."
  );
}
if (isProduction && !REDIS_URL) {
  throw new Error("REDIS_URL is required in production.");
}

const productSearchIndex = {
  type: 'products',
  enabled: true,
  ...productIndexSettings,
  transformer: productSearchTransformer,
};
const stripeConfigurationValues = [
  STRIPE_API_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_PAYMENT_METHOD_CONFIGURATION,
];
const hasAnyStripeConfiguration = stripeConfigurationValues.some(Boolean);
const hasCompleteStripeConfiguration = stripeConfigurationValues.every(Boolean);

if (hasAnyStripeConfiguration && !hasCompleteStripeConfiguration) {
  throw new Error(
    "STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET, and " +
      "STRIPE_PAYMENT_METHOD_CONFIGURATION must be configured together."
  );
}
if (STRIPE_LIFECYCLE_WEBHOOK_SECRET && !STRIPE_API_KEY) {
  throw new Error(
    "STRIPE_API_KEY is required when STRIPE_LIFECYCLE_WEBHOOK_SECRET is configured."
  );
}

/** @type {import('@medusajs/types').ConfigModule} */
const medusaConfig = {
  projectConfig: {
    databaseUrl: DATABASE_URL,
    databaseLogging: false,
    redisUrl: REDIS_URL,
    workerMode: WORKER_MODE,
    http: {
      adminCors: ADMIN_CORS,
      authCors: AUTH_CORS,
      storeCors: STORE_CORS,
      jwtSecret: JWT_SECRET,
      cookieSecret: COOKIE_SECRET,
      responseHeaders
    },
    build: {
      rollupOptions: {
        external: ["@medusajs/dashboard", "@medusajs/admin-shared"]
      }
    }
  },
  admin: {
    backendUrl: BACKEND_URL,
    disable: SHOULD_DISABLE_ADMIN,
    vite: () => ({
      plugins: [zodStrictCspVitePlugin.createZodStrictCspVitePlugin()],
      build: {
        target: [
          "es2020",
          "edge88",
          "firefox78",
          "chrome87",
          "safari14.1",
        ],
      },
    }),
  },
  modules: [
    // Medusa 2.18 discovers its core RBAC flag after evaluating this config in
    // migration commands. Override the default declaration explicitly so an
    // enabled release cannot skip the RBAC schema and bootstrap silently.
    resolveAdminRbacModuleConfig(process.env.MEDUSA_FF_RBAC, {
      requireEnabled: isProduction,
    }),
    {
      key: Modules.FULFILLMENT,
      resolve: '@medusajs/fulfillment',
      options: {
        providers: [
          {
            resolve: '@medusajs/fulfillment-manual',
            id: 'manual',
            options: {},
          },
          {
            resolve: './src/modules/per-item-fulfillment',
            id: 'standard',
            options: {
              baseAmount: 5,
              additionalAmount: 0.5,
              currencyCode: 'usd',
            },
          },
        ],
      },
    },
    {
      key: Modules.FILE,
      resolve: '@medusajs/file',
      options: {
        providers: [
          ...(objectStorageConfig ? [{
            resolve: '@medusajs/file-s3',
            id: 'minio',
            options: {
              file_url: objectStorageConfig.fileUrl,
              access_key_id: objectStorageConfig.accessKeyId,
              secret_access_key: objectStorageConfig.secretAccessKey,
              region: objectStorageConfig.region,
              bucket: objectStorageConfig.bucket,
              endpoint: objectStorageConfig.endpoint,
              acl: false,
              cache_control: 'public, max-age=31536000, immutable',
              download_file_duration: 3600,
              additional_client_config: {
                forcePathStyle: true,
              },
            }
          }] : [{
            resolve: '@medusajs/file-local',
            id: 'local',
            options: {
              upload_dir: 'static',
              backend_url: `${BACKEND_URL}/static`
            }
          }])
        ]
      }
    },
    ...(REDIS_URL ? [{
      key: Modules.EVENT_BUS,
      resolve: '@medusajs/event-bus-redis',
      options: {
        redisUrl: REDIS_URL
      }
    },
    {
      key: Modules.WORKFLOW_ENGINE,
      resolve: '@medusajs/workflow-engine-redis',
      options: {
        redis: {
          redisUrl: REDIS_URL,
          jobWorkerOptions: WORKFLOW_JOB_WORKER_OPTIONS,
        }
      }
    },
    {
      key: Modules.LOCKING,
      resolve: '@medusajs/medusa/locking',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/locking-redis',
            id: 'locking-redis',
            is_default: true,
            options: {
              redisUrl: REDIS_URL,
            },
          },
        ],
      },
    }] : []),
    ...(SENDGRID_API_KEY && SENDGRID_FROM_EMAIL || RESEND_API_KEY && RESEND_FROM_EMAIL ? [{
      key: Modules.NOTIFICATION,
      resolve: '@medusajs/notification',
      options: {
        providers: [
          {
            resolve: './src/modules/feed-notifications',
            id: 'local',
            options: {
              channels: ['feed'],
            },
          },
          ...(SENDGRID_API_KEY && SENDGRID_FROM_EMAIL ? [{
            resolve: '@medusajs/notification-sendgrid',
            id: 'sendgrid',
            options: {
              channels: ['email'],
              api_key: SENDGRID_API_KEY,
              from: SENDGRID_FROM_EMAIL,
            }
          }] : []),
          ...(RESEND_API_KEY && RESEND_FROM_EMAIL ? [{
            resolve: './src/modules/email-notifications',
            id: 'resend',
            options: {
              channels: ['email'],
              api_key: RESEND_API_KEY,
              from: RESEND_FROM_EMAIL,
            },
          }] : []),
        ]
      }
    }] : []),
    ...(hasCompleteStripeConfiguration ? [{
      key: Modules.PAYMENT,
      resolve: '@medusajs/payment',
      options: {
        providers: [
          {
            resolve: '@medusajs/payment-stripe',
            id: 'stripe',
            options: {
              apiKey: STRIPE_API_KEY,
              webhookSecret: STRIPE_WEBHOOK_SECRET,
              capture: true,
              automaticPaymentMethods: true,
              paymentMethodConfiguration:
                STRIPE_PAYMENT_METHOD_CONFIGURATION,
              paymentDescription: 'Remorseless Records order',
              asyncPaymentMethodTypes: [],
            },
          },
        ],
      },
    }] : []),
    {
      key: Modules.TAX,
      resolve: '@medusajs/tax',
      options: {
        providers: [
          {
            resolve: './src/modules/tax-rate-provider',
            id: 'rate-lookup',
            options: {
              provider: TAX_RATE_LOOKUP_PROVIDER,
              apiKey: TAX_RATE_LOOKUP_API_KEY,
              mode: TAX_RATE_LOOKUP_MODE,
              stripeApiKey: STRIPE_API_KEY,
              stripeQuoteTtlMs: STRIPE_TAX_QUOTE_TTL_MS,
              stripeShippingTaxCode: STRIPE_TAX_SHIPPING_TAX_CODE,
            }
          }
        ]
      }
    },
    {
      key: "discography",
      resolve: "./src/modules/discography",
    },
    {
      key: "news",
      resolve: "./src/modules/news",
    },
    {
      key: "catalog",
      resolve: "./src/modules/catalog",
    },
    {
      key: "tax_control",
      resolve: "./src/modules/tax-control",
    },
    {
      key: "payment_lifecycle",
      resolve: "./src/modules/payment-lifecycle",
    }
  ],
  plugins: [
  ...(hasCompleteMeilisearchConfiguration ? [{
      resolve: '@rokmohar/medusa-plugin-meilisearch',
      options: {
        config: {
          host: MEILISEARCH_HOST,
          apiKey: MEILISEARCH_ADMIN_KEY
        },
        settings: {
          products: productSearchIndex,
          ...(meilisearchCandidateIndex ? {
            [meilisearchCandidateIndex]: {
              ...productSearchIndex,
            },
          } : {}),
        }
      }
    }] : [])
  ]
};

/** @type {import('@medusajs/types').ConfigModule} */
const config = defineConfig(medusaConfig);
export default config;
