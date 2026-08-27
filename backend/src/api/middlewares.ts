import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
  type MiddlewareRoute,
} from "@medusajs/framework/http";
import multer from "multer";

import {
  adminAuthorizationPolicyRoutes,
  adminAuthorizationPolicyRoutesForArea,
} from "../lib/admin-authorization-manifest";
import {
  nativeAdminActions,
  productImportAdminActions,
} from "../lib/admin-permissions";
import { STORE_CORS } from "../lib/constants";
import {
  attachRequestCorrelation,
  logCompletedRequest,
  sendApiProblem,
} from "../lib/http/correlation";
import {
  buildBackendSecurityHeaders,
  shouldDefaultToNoStore,
} from "../lib/security/security-headers";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "../lib/uploads/validation";

type RateLimitRule = {
  key: string;
  max: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();
const MAX_RATE_LIMIT_BUCKETS = 10_000;

const backendSecurityHeaders = buildBackendSecurityHeaders({
  isDevelopment: process.env.NODE_ENV === "development",
  mediaUrls: [process.env.MINIO_FILE_URL, process.env.BACKEND_PUBLIC_URL],
});

export const applySecurityBoundaryHeaders = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void => {
  res.removeHeader("X-Powered-By");
  Object.entries(backendSecurityHeaders).forEach(([name, value]) => {
    res.setHeader(name, value);
  });
  if (shouldDefaultToNoStore(req.method, req.path)) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
};

export const applyRequestObservability = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void => {
  const startedAt = process.hrtime.bigint();
  attachRequestCorrelation(req, res);
  res.once("finish", () => {
    logCompletedRequest(req, res, startedAt);
  });
  next();
};

const allowedStoreOriginHosts = new Set(
  STORE_CORS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).host.toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean),
);

const extractIp = (req: MedusaRequest): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim().length) {
    return realIp.trim();
  }

  if (typeof req.ip === "string" && req.ip.trim().length) {
    return req.ip.trim();
  }

  return "unknown";
};

const createRateLimitMiddleware =
  (rule: RateLimitRule) =>
  (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void => {
    const now = Date.now();
    const ip = extractIp(req);
    const key = `${rule.key}:${ip}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.resetAt <= now) {
            buckets.delete(bucketKey);
          }
        }
        if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
          const oldestKey = buckets.keys().next().value;
          if (typeof oldestKey === "string") {
            buckets.delete(oldestKey);
          }
        }
      }
      buckets.set(key, {
        count: 1,
        resetAt: now + rule.windowMs,
      });
      next();
      return;
    }

    if (current.count >= rule.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((current.resetAt - now) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      sendApiProblem(req, res, {
        code: "rate_limit_exceeded",
        title: "Too many requests",
        status: 429,
        detail: "Too many requests. Please try again shortly.",
        instance: req.path,
      });
      return;
    }

    current.count += 1;
    buckets.set(key, current);
    next();
  };

const enforceStoreOrigin = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void => {
  const origin = req.headers.origin;

  if (!origin || typeof origin !== "string") {
    next();
    return;
  }

  let originHost = "";
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    sendApiProblem(req, res, {
      code: "invalid_origin",
      title: "Origin is not allowed",
      status: 403,
      detail: "Origin is not allowed.",
      instance: req.path,
    });
    return;
  }

  if (!allowedStoreOriginHosts.has(originHost)) {
    sendApiProblem(req, res, {
      code: "invalid_origin",
      title: "Origin is not allowed",
      status: 403,
      detail: "Origin is not allowed.",
      instance: req.path,
    });
    return;
  }

  next();
};

const strictStoreMutationRateLimit = createRateLimitMiddleware({
  key: "store:mutation",
  max: 120,
  windowMs: 60_000,
});

const catalogReadRateLimit = createRateLimitMiddleware({
  key: "store:catalog-read",
  max: 240,
  windowMs: 60_000,
});

const checkoutStatusRateLimit = createRateLimitMiddleware({
  key: "store:checkout-status",
  max: 600,
  windowMs: 60_000,
});

const contactRateLimit = createRateLimitMiddleware({
  key: "store:contact",
  max: 15,
  windowMs: 60_000,
});

const adminTaxControlRateLimit = createRateLimitMiddleware({
  key: "admin:tax-control",
  max: 30,
  windowMs: 60_000,
});

const adminTaxRecordsRateLimit = createRateLimitMiddleware({
  key: "admin:tax-records",
  max: 60,
  windowMs: 60_000,
});

const adminRefundOperationsRateLimit = createRateLimitMiddleware({
  key: "admin:refund-operations",
  max: 60,
  windowMs: 60_000,
});

const adminCatalogMediaMutationRateLimit = createRateLimitMiddleware({
  key: "admin:catalog-media-mutation",
  max: 60,
  windowMs: 60_000,
});

const adminCatalogMediaReadRateLimit = createRateLimitMiddleware({
  key: "admin:catalog-media-read",
  max: 120,
  windowMs: 60_000,
});

const managedUpload = multer({
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: MAX_UPLOAD_FILES,
    fieldSize: 128,
    fields: 1,
    parts: MAX_UPLOAD_FILES + 1,
  },
  storage: multer.memoryStorage(),
});

const rejectPresignedUploads = (
  req: MedusaRequest,
  res: MedusaResponse,
): void => {
  sendApiProblem(req, res, {
    code: "not_allowed",
    title: "Presigned uploads are disabled",
    status: 400,
    detail:
      "Presigned uploads are disabled; use the validated managed upload endpoint.",
    instance: req.path,
  });
};

export const rejectDeprecatedProductImport = (
  req: MedusaRequest,
  res: MedusaResponse,
): void => {
  res.setHeader("Cache-Control", "private, no-store");
  sendApiProblem(req, res, {
    code: "deprecated_product_import",
    type: "urn:remorseless-records:problem:deprecated-product-import",
    title: "Deprecated product import route",
    status: 410,
    detail:
      "Upload a validated CSV and prepare it through POST /admin/products/imports.",
    instance: req.path,
  });
};

export const operationsAdminMiddlewareRoutes = [
  {
    matcher: "/admin/tax-control",
    methods: ["GET"],
    middlewares: [adminTaxControlRateLimit],
  },
  {
    matcher: "/admin/tax-control/switch",
    methods: ["POST"],
    middlewares: [adminTaxControlRateLimit],
    bodyParser: {
      sizeLimit: "8kb",
    },
  },
  {
    matcher: "/admin/tax-control/taxrate-io/refresh",
    methods: ["POST"],
    middlewares: [adminTaxControlRateLimit],
    bodyParser: {
      sizeLimit: "8kb",
    },
  },
  {
    matcher: "/admin/tax-records",
    methods: ["GET"],
    middlewares: [adminTaxRecordsRateLimit],
  },
  {
    matcher: "/admin/tax-records/export",
    methods: ["GET"],
    middlewares: [adminTaxRecordsRateLimit],
  },
  {
    matcher: "/admin/refund-operations",
    methods: ["GET"],
    middlewares: [adminRefundOperationsRateLimit],
  },
  {
    matcher: "/admin/catalog/media/orphans",
    methods: ["GET"],
    middlewares: [adminCatalogMediaReadRateLimit],
  },
  {
    matcher:
      /^\/admin\/catalog\/media\/assets\/[^/]+\/(quarantine|restore)\/?$/i,
    methods: ["POST"],
    middlewares: [adminCatalogMediaMutationRateLimit],
  },
] satisfies MiddlewareRoute[];

export const contentAdminPolicyRoutes =
  adminAuthorizationPolicyRoutesForArea("content");

export const operationsAdminPolicyRoutes =
  adminAuthorizationPolicyRoutesForArea("operations");

const productImportPreparePolicies = [
  nativeAdminActions.product.read,
  nativeAdminActions.file.create,
  productImportAdminActions.productImport.create,
];

const productImportConfirmPolicies = [
  nativeAdminActions.product.read,
  productImportAdminActions.productImport.update,
];

export const deprecatedProductImportAdminRoutes = [
  {
    matcher: /^\/admin\/products\/import\/?$/i,
    methods: ["POST"],
    bodyParser: false,
    middlewares: [rejectDeprecatedProductImport],
    policies: productImportPreparePolicies,
  },
  {
    matcher: /^\/admin\/products\/import\/[^/]+\/confirm\/?$/i,
    methods: ["POST"],
    bodyParser: false,
    middlewares: [rejectDeprecatedProductImport],
    policies: productImportConfirmPolicies,
  },
] satisfies MiddlewareRoute[];

export const productImportAdminPolicyRoutes = [
  ...adminAuthorizationPolicyRoutesForArea("product_import"),
  ...deprecatedProductImportAdminRoutes,
];

export const nativeAdminPolicyOverlayRoutes = [
  {
    matcher: /^\/admin\/products\/prod_[^/]+\/?$/i,
    methods: ["POST"],
    policies: [nativeAdminActions.product.update],
  },
  {
    matcher: /^\/admin\/products\/prod_[^/]+\/variants\/variant_[^/]+\/?$/i,
    methods: ["POST"],
    policies: [nativeAdminActions.productVariant.update],
  },
] satisfies MiddlewareRoute[];

export default defineMiddlewares({
  routes: [
    {
      matcher: /.*/,
      middlewares: [applySecurityBoundaryHeaders, applyRequestObservability],
    },
    {
      matcher: /^\/store\/(carts|checkout)(\/.*)?$/,
      methods: ["POST", "PUT", "PATCH", "DELETE"],
      middlewares: [strictStoreMutationRateLimit, enforceStoreOrigin],
    },
    {
      matcher: /^\/store\/catalog\/products\/[^/]+\/bundle$/,
      methods: ["GET"],
      middlewares: [catalogReadRateLimit],
    },
    {
      matcher: /^\/store\/checkout\/(status|tax-link)$/,
      methods: ["POST"],
      middlewares: [checkoutStatusRateLimit],
      bodyParser: {
        sizeLimit: "2kb",
      },
    },
    {
      matcher: "/webhooks/stripe/lifecycle",
      methods: ["POST"],
      bodyParser: {
        preserveRawBody: true,
        sizeLimit: "256kb",
      },
    },
    {
      matcher: "/store/contact",
      methods: ["POST"],
      middlewares: [contactRateLimit, enforceStoreOrigin],
      bodyParser: {
        sizeLimit: "16kb",
      },
    },
    {
      matcher: "/admin/managed-uploads",
      methods: ["POST"],
      middlewares: [managedUpload.array("files")],
    },
    ...adminAuthorizationPolicyRoutes,
    ...nativeAdminPolicyOverlayRoutes,
    ...operationsAdminMiddlewareRoutes,
    ...deprecatedProductImportAdminRoutes,
    {
      matcher: "/admin/catalog/media/uploads",
      methods: ["POST"],
      middlewares: [
        adminCatalogMediaMutationRateLimit,
        managedUpload.array("files"),
      ],
    },
    {
      matcher: "/admin/uploads/presigned-urls",
      methods: ["POST"],
      middlewares: [rejectPresignedUploads],
    },
  ],
});
