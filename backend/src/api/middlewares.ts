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
  sendApiProblem,
} from "../lib/http/correlation";
import { resolveClientIp } from "../lib/security/client-ip";
import {
  buildBackendSecurityHeaders,
  shouldDefaultToNoStore,
} from "../lib/security/security-headers";
import {
  consumeRateLimit,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "../lib/security/rate-limit";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "../lib/uploads/validation";

type RateLimitConsumer = (
  identity: string,
  policy: RateLimitPolicy,
) => Promise<RateLimitDecision>;

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
  attachRequestCorrelation(req, res);
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

export const createRateLimitMiddleware = (
  rule: RateLimitPolicy,
  consume: RateLimitConsumer = consumeRateLimit,
) =>
  async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction,
  ): Promise<void> => {
    const decision = await consume(resolveClientIp(req), rule);

    if (decision.status === "allowed") {
      next();
      return;
    }

    if (decision.status === "unavailable") {
      console.error(
        JSON.stringify({
          event: "rate_limit.unavailable",
          message: "Distributed rate limiting unavailable",
          route_class: rule.key,
        }),
      );
      sendApiProblem(req, res, {
        code: "rate_limit_unavailable",
        title: "Service temporarily unavailable",
        status: 503,
        detail: "Please wait a moment and try again.",
        instance: req.path,
      });
      return;
    }

    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    sendApiProblem(req, res, {
      code: "rate_limit_exceeded",
      title: "Too many requests",
      status: 429,
      detail: "Too many requests. Please try again shortly.",
      instance: req.path,
    });
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
  onUnavailable: "reject",
});

const catalogReadRateLimit = createRateLimitMiddleware({
  key: "store:catalog-read",
  max: 240,
  windowMs: 60_000,
  onUnavailable: "local-fallback",
});

const checkoutStatusRateLimit = createRateLimitMiddleware({
  key: "store:checkout-status",
  max: 600,
  windowMs: 60_000,
  onUnavailable: "local-fallback",
});

const publicFormRateLimit = createRateLimitMiddleware({
  key: "store:public-form",
  max: 15,
  windowMs: 60_000,
  onUnavailable: "reject",
});

const adminTaxControlReadRateLimit = createRateLimitMiddleware({
  key: "admin:tax-control",
  max: 30,
  windowMs: 60_000,
  onUnavailable: "local-fallback",
});

const adminTaxControlMutationRateLimit = createRateLimitMiddleware({
  key: "admin:tax-control",
  max: 30,
  windowMs: 60_000,
  onUnavailable: "reject",
});

const adminTaxRecordsRateLimit = createRateLimitMiddleware({
  key: "admin:tax-records",
  max: 60,
  windowMs: 60_000,
  onUnavailable: "local-fallback",
});

const adminRefundOperationsRateLimit = createRateLimitMiddleware({
  key: "admin:refund-operations",
  max: 60,
  windowMs: 60_000,
  onUnavailable: "local-fallback",
});

const adminCatalogMediaMutationRateLimit = createRateLimitMiddleware({
  key: "admin:catalog-media-mutation",
  max: 60,
  windowMs: 60_000,
  onUnavailable: "reject",
});

const adminCatalogMediaReadRateLimit = createRateLimitMiddleware({
  key: "admin:catalog-media-read",
  max: 120,
  windowMs: 60_000,
  onUnavailable: "local-fallback",
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

export const rejectUnsafeNativeCatalogDeletion = (
  req: MedusaRequest,
  res: MedusaResponse,
): void => {
  res.setHeader("Cache-Control", "private, no-store");
  sendApiProblem(req, res, {
    code: "catalog_hard_deletion_disabled",
    type: "urn:remorseless-records:problem:catalog-hard-deletion-disabled",
    title: "Catalog hard deletion is disabled",
    status: 409,
    detail:
      "Use an audited, version-checked update, archive, restore, or quarantine workflow.",
    instance: req.path,
  });
};

export const operationsAdminMiddlewareRoutes = [
  {
    matcher: "/admin/tax-control",
    methods: ["GET"],
    middlewares: [adminTaxControlReadRateLimit],
  },
  {
    matcher: "/admin/tax-control/switch",
    methods: ["POST"],
    middlewares: [adminTaxControlMutationRateLimit],
    bodyParser: {
      sizeLimit: "8kb",
    },
  },
  {
    matcher: "/admin/tax-control/taxrate-io/refresh",
    methods: ["POST"],
    middlewares: [adminTaxControlMutationRateLimit],
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

export const disabledNativeCatalogDeletionAdminRoutes = [
  {
    matcher: /^\/admin\/collections\/[^/]+\/?$/i,
    methods: ["DELETE"],
    bodyParser: false,
    middlewares: [rejectUnsafeNativeCatalogDeletion],
    policies: [nativeAdminActions.productCollection.delete],
  },
  {
    matcher: /^\/admin\/product-categories\/[^/]+\/?$/i,
    methods: ["DELETE"],
    bodyParser: false,
    middlewares: [rejectUnsafeNativeCatalogDeletion],
    policies: [nativeAdminActions.productCategory.delete],
  },
  {
    matcher: /^\/admin\/product-options\/[^/]+\/?$/i,
    methods: ["DELETE"],
    bodyParser: false,
    middlewares: [rejectUnsafeNativeCatalogDeletion],
    policies: [nativeAdminActions.productOption.delete],
  },
  {
    matcher: /^\/admin\/product-options\/[^/]+\/values\/[^/]+\/?$/i,
    methods: ["DELETE"],
    bodyParser: false,
    middlewares: [rejectUnsafeNativeCatalogDeletion],
    policies: [
      nativeAdminActions.productOption.update,
      nativeAdminActions.productOptionValue.delete,
    ],
  },
  {
    matcher: /^\/admin\/product-tags\/[^/]+\/?$/i,
    methods: ["DELETE"],
    bodyParser: false,
    middlewares: [rejectUnsafeNativeCatalogDeletion],
    policies: [nativeAdminActions.productTag.delete],
  },
  {
    matcher: /^\/admin\/product-types\/[^/]+\/?$/i,
    methods: ["DELETE"],
    bodyParser: false,
    middlewares: [rejectUnsafeNativeCatalogDeletion],
    policies: [nativeAdminActions.productType.delete],
  },
  {
    matcher: /^\/admin\/products\/[^/]+\/?$/i,
    methods: ["DELETE"],
    bodyParser: false,
    middlewares: [rejectUnsafeNativeCatalogDeletion],
    policies: [nativeAdminActions.product.delete],
  },
  {
    matcher: /^\/admin\/products\/[^/]+\/variants\/[^/]+\/?$/i,
    methods: ["DELETE"],
    bodyParser: false,
    middlewares: [rejectUnsafeNativeCatalogDeletion],
    policies: [nativeAdminActions.productVariant.delete],
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
      matcher: /^\/store\/(contact|privacy-request)$/,
      methods: ["POST"],
      middlewares: [publicFormRateLimit, enforceStoreOrigin],
      bodyParser: {
        preserveRawBody: true,
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
    ...disabledNativeCatalogDeletionAdminRoutes,
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
