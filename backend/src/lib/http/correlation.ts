import { randomBytes, randomUUID } from "node:crypto";

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

type HeaderValue = string | string[] | undefined;

type HeaderSource = Record<string, HeaderValue>;

export type RequestCorrelation = {
  requestId: string;
  traceId: string;
  spanId: string;
  traceFlags: string;
  traceparent: string;
};

export type ApiProblemInput = {
  code: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  type?: string;
  extensions?: Record<string, unknown>;
};

type StructuredLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TRACEPARENT_PATTERN =
  /^(?<version>[0-9a-f]{2})-(?<traceId>[0-9a-f]{32})-(?<parentId>[0-9a-f]{16})-(?<traceFlags>[0-9a-f]{2})$/u;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
const requestCorrelations = new WeakMap<object, RequestCorrelation>();

const randomHex = (bytes: number): string => randomBytes(bytes).toString("hex");

const firstHeader = (value: HeaderValue): string | undefined =>
  typeof value === "string" ? value.trim() : undefined;

const acceptedRequestId = (value: HeaderValue): string | undefined => {
  const candidate = firstHeader(value);
  return candidate && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : undefined;
};

const acceptedTraceparent = (
  value: HeaderValue,
): { traceId: string; traceFlags: string } | undefined => {
  const candidate = firstHeader(value)?.toLowerCase();
  if (!candidate) {
    return undefined;
  }

  const match = TRACEPARENT_PATTERN.exec(candidate);
  const version = match?.groups?.version;
  const traceId = match?.groups?.traceId;
  const parentId = match?.groups?.parentId;
  const traceFlags = match?.groups?.traceFlags;
  if (
    !version ||
    !traceId ||
    !parentId ||
    !traceFlags ||
    version === "ff" ||
    traceId === ZERO_TRACE_ID ||
    parentId === ZERO_SPAN_ID
  ) {
    return undefined;
  }

  return {
    traceId,
    traceFlags,
  };
};

export const createRequestCorrelation = (
  headers: HeaderSource,
): RequestCorrelation => {
  const incomingTrace = acceptedTraceparent(headers.traceparent);
  const traceId = incomingTrace?.traceId ?? randomHex(16);
  const spanId = randomHex(8);
  const traceFlags = incomingTrace?.traceFlags ?? "01";

  return {
    requestId: acceptedRequestId(headers["x-request-id"]) ?? randomUUID(),
    traceId,
    spanId,
    traceFlags,
    traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
  };
};

export const attachRequestCorrelation = (
  req: MedusaRequest,
  res: MedusaResponse,
): RequestCorrelation => {
  const correlation = createRequestCorrelation(req.headers ?? {});
  requestCorrelations.set(req, correlation);
  req.headers["x-request-id"] = correlation.requestId;
  req.headers.traceparent = correlation.traceparent;
  res.setHeader("X-Request-Id", correlation.requestId);
  res.setHeader("traceparent", correlation.traceparent);
  return correlation;
};

export const getRequestCorrelation = (
  req: MedusaRequest,
): RequestCorrelation => {
  const existing = requestCorrelations.get(req);
  if (existing) {
    return existing;
  }

  const correlation = createRequestCorrelation(req.headers ?? {});
  requestCorrelations.set(req, correlation);
  return correlation;
};

const resolveLogger = (req: MedusaRequest): StructuredLogger => {
  try {
    const logger = req.scope?.resolve("logger") as StructuredLogger | undefined;
    return logger ?? console;
  } catch {
    return console;
  }
};

const deploymentIdentity = {
  commit_sha:
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    "unknown",
  environment:
    process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "unknown",
  service: "backend",
} as const;

const writeStructuredLog = (
  req: MedusaRequest,
  level: "info" | "warn" | "error",
  event: Record<string, unknown>,
): void => {
  const logger = resolveLogger(req);
  const write = logger[level] ?? logger.info;
  write?.call(logger, JSON.stringify({ ...deploymentIdentity, ...event }));
};

export const logCompletedRequest = (
  req: MedusaRequest,
  res: MedusaResponse,
  startedAt: bigint,
): void => {
  const correlation = getRequestCorrelation(req);
  const status = res.statusCode;
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  const problemCode = res.locals?.problemCode;
  writeStructuredLog(req, level, {
    duration_ms: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    event: "http.request.completed",
    method: req.method,
    request_id: correlation.requestId,
    span_id: correlation.spanId,
    status,
    trace_id: correlation.traceId,
    ...(typeof problemCode === "string" ? { problem_code: problemCode } : {}),
  });
};

export const sendApiProblem = (
  req: MedusaRequest,
  res: MedusaResponse,
  input: ApiProblemInput,
): void => {
  const correlation = getRequestCorrelation(req);
  res.locals ??= {};
  res.locals.problemCode = input.code;
  res.setHeader("X-Request-Id", correlation.requestId);
  res.setHeader("traceparent", correlation.traceparent);
  res.type("application/problem+json");
  res.status(input.status).json({
    ...input.extensions,
    type: input.type ?? `https://remorselessrecords.com/problems/${input.code}`,
    title: input.title,
    status: input.status,
    detail: input.detail,
    code: input.code,
    instance: input.instance,
    request_id: correlation.requestId,
    trace_id: correlation.traceId,
  });
};
