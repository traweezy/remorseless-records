export type PublicProductRouteType = "music-release" | "bundle" | "merch"

type ProductRouteInput = {
  handle?: string | null | undefined
  productType?: string | null | undefined
}

const PREFIXES: ReadonlyArray<{
  prefix: string
  type: PublicProductRouteType
}> = [
  { prefix: "music-release-", type: "music-release" },
  { prefix: "fixed-bundle-", type: "bundle" },
  { prefix: "mystery-bundle-", type: "bundle" },
  { prefix: "merch-", type: "merch" },
]

const normalize = (value: string | null | undefined): string =>
  value?.trim().toLowerCase().replace(/[ _]+/g, "-") ?? ""

export const resolvePublicProductRouteType = ({
  handle,
  productType,
}: ProductRouteInput): PublicProductRouteType | null => {
  const normalizedHandle = normalize(handle)
  const handleMatch = PREFIXES.find(({ prefix }) =>
    normalizedHandle.startsWith(prefix)
  )
  if (handleMatch) {
    return handleMatch.type
  }

  const normalizedType = normalize(productType)
  if (normalizedType === "music-release") {
    return "music-release"
  }
  if (
    normalizedType === "fixed-bundle" ||
    normalizedType === "mystery-bundle"
  ) {
    return "bundle"
  }
  if (normalizedType === "merch") {
    return "merch"
  }
  return null
}

export const buildPublicProductPath = ({
  handle,
  productType,
}: ProductRouteInput): string => {
  const normalizedHandle = normalize(handle)
  if (!normalizedHandle) {
    return "/catalog"
  }

  const prefixMatch = PREFIXES.find(({ prefix }) =>
    normalizedHandle.startsWith(prefix)
  )
  const routeType =
    prefixMatch?.type ?? resolvePublicProductRouteType({ handle, productType })
  if (!routeType) {
    return `/products/${normalizedHandle}`
  }

  const slug = prefixMatch
    ? normalizedHandle.slice(prefixMatch.prefix.length)
    : normalizedHandle
  return `/${routeType}/${slug}`
}

export const buildInternalHandleCandidates = (
  routeType: PublicProductRouteType,
  slug: string
): string[] => {
  const normalizedSlug = normalize(slug)
  if (!normalizedSlug) {
    return []
  }

  switch (routeType) {
    case "music-release":
      return [`music-release-${normalizedSlug}`]
    case "bundle":
      return [
        `fixed-bundle-${normalizedSlug}`,
        `mystery-bundle-${normalizedSlug}`,
      ]
    case "merch":
      return [`merch-${normalizedSlug}`]
  }
}
