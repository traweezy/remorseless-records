import { isIP } from "node:net";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

type ClientIpRequest = {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  socket?: {
    remoteAddress?: string | undefined;
  };
};

const normalizeIp = (value: string | null | undefined): string | null => {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  const normalized = candidate.startsWith("::ffff:")
    ? candidate.slice("::ffff:".length)
    : candidate;

  return isIP(normalized) === 0 ? null : normalized;
};

export const hasRailwayProxyBoundary = (
  environment: RuntimeEnvironment = process.env,
): boolean =>
  [
    environment.RAILWAY_PROJECT_ID,
    environment.RAILWAY_ENVIRONMENT_ID,
    environment.RAILWAY_SERVICE_ID,
  ].every((value) => Boolean(value?.trim()));

export const resolveClientIp = (
  request: ClientIpRequest,
  environment: RuntimeEnvironment = process.env,
): string => {
  if (hasRailwayProxyBoundary(environment)) {
    const realIp = request.headers["x-real-ip"];
    if (typeof realIp === "string") {
      return normalizeIp(realIp) ?? "unknown";
    }
    return "unknown";
  }

  return normalizeIp(request.socket?.remoteAddress) ?? "unknown";
};
