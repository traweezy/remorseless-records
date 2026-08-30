const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u
const DEPLOYMENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

export type StorefrontRuntimeIdentity = {
  commit_sha: string
  environment: string
  service: "storefront"
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

const safeDeploymentName = (value: string | undefined): string => {
  const candidate = value?.trim()
  return candidate && DEPLOYMENT_NAME_PATTERN.test(candidate)
    ? candidate
    : "unknown"
}

export const resolveStorefrontCommitSha = (
  environment: RuntimeEnvironment = process.env
): string => {
  const candidate = [
    environment.COMMIT_SHA,
    environment.RAILWAY_GIT_COMMIT_SHA,
    environment.GIT_COMMIT_SHA,
  ]
    .map((value) => value?.trim().toLowerCase())
    .find((value) => value && COMMIT_SHA_PATTERN.test(value))

  return candidate ?? "unknown"
}

export const getStorefrontRuntimeIdentity = (
  environment: RuntimeEnvironment = process.env
): StorefrontRuntimeIdentity => ({
  commit_sha: resolveStorefrontCommitSha(environment),
  environment: safeDeploymentName(
    environment.RAILWAY_ENVIRONMENT_NAME ?? environment.NODE_ENV
  ),
  service: "storefront",
})
