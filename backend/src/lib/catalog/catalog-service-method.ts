import { asUnknownRecord } from "../provider-boundary/records"

type CatalogServiceMethod = (...args: unknown[]) => unknown

const methodNamePattern = /^[A-Za-z][A-Za-z0-9]{0,79}$/u
const maximumCandidateCount = 4

export class CatalogServiceMethodError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "CatalogServiceMethodError"
  }
}

const validatedCandidates = (candidates: readonly string[]): string[] => {
  const unique = new Set(candidates)
  if (
    candidates.length === 0 ||
    candidates.length > maximumCandidateCount ||
    unique.size !== candidates.length ||
    candidates.some((candidate) => !methodNamePattern.test(candidate))
  ) {
    throw new CatalogServiceMethodError(
      "Catalog service method candidates are invalid."
    )
  }
  return [...candidates]
}

const isCatalogServiceMethod = (
  value: unknown
): value is CatalogServiceMethod => typeof value === "function"

export const callCatalogServiceMethod = async (
  catalogService: unknown,
  candidates: readonly string[],
  args: unknown[]
): Promise<unknown> => {
  const service = asUnknownRecord(catalogService)
  const methodNames = validatedCandidates(candidates)
  if (!service) {
    throw new CatalogServiceMethodError(
      "Catalog service is not a structured service object."
    )
  }

  const methodName = methodNames.find((candidate) =>
    isCatalogServiceMethod(service[candidate])
  )
  const method = methodName ? service[methodName] : undefined
  if (!isCatalogServiceMethod(method)) {
    throw new CatalogServiceMethodError(
      `Catalog service is missing ${methodNames.join(" or ")}`
    )
  }

  return await method.apply(catalogService, args)
}
