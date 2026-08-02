import type { MedusaRequest } from "@medusajs/framework"
import { ContainerRegistrationKeys, remoteQueryObjectFromString } from "@medusajs/utils"

import { richTextToPlainText } from "@/lib/content/rich-text"
import type NewsModuleService from "@/modules/news/service"

export type NewsService = InstanceType<typeof NewsModuleService>

type AdminAuthContext = {
  actor_id?: string | null
}

export const slugify = (value: string): string => {
  const trimmed = value.trim().toLowerCase()
  const sanitized = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
  return sanitized.length ? sanitized : "news"
}

export const toOptionalDate = (value: string | null | undefined): Date | null => {
  if (!value || typeof value !== "string") {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const normalizeList = (values?: string[]): string[] => {
  const seen = new Set<string>()
  return (values ?? []).flatMap((value) => {
    const normalized = value.trim()
    const key = normalized.toLocaleLowerCase("en-US")
    if (!normalized || seen.has(key)) {
      return []
    }
    seen.add(key)
    return [normalized]
  })
}

export const toNullableString = (
  value: string | null | undefined
): string | null => (value && value.trim().length ? value.trim() : null)

export const resolveAdminUserName = async (
  req: MedusaRequest
): Promise<string | null> => {
  const authContext = (req as { auth_context?: AdminAuthContext }).auth_context
  const actorId = authContext?.actor_id ?? null
  if (!actorId) {
    return null
  }

  const remoteQuery = req.scope.resolve(
    ContainerRegistrationKeys.REMOTE_QUERY
  )
  const query = remoteQueryObjectFromString({
    entryPoint: "user",
    variables: { id: actorId },
    fields: ["first_name", "last_name", "email"],
  })

  const [user] = (await remoteQuery(query)) as Array<{
    first_name?: string | null
    last_name?: string | null
    email?: string | null
  }>

  if (!user) {
    return null
  }

  const first = (user.first_name ?? "").trim()
  const last = (user.last_name ?? "").trim()
  const fullName = `${first} ${last}`.trim()
  if (fullName.length) {
    return fullName
  }

  return user.email?.trim() ?? null
}

export const buildSeo = (input: {
  title: string
  excerpt: string | null
  content: string
}) => {
  const title = input.title.trim()
  const baseDescription =
    input.excerpt?.trim() ||
    richTextToPlainText(input.content).slice(0, 160).trim()

  return {
    seo_title: title ? `${title} · Remorseless Records` : null,
    seo_description: baseDescription || null,
  }
}
