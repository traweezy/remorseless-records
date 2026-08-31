import type { MedusaRequest } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/utils"

import { richTextToPlainText } from "@/lib/content/rich-text"
import {
  asUnknownRecord,
  readRecordArray,
} from "@/lib/provider-boundary/records"
import type NewsModuleService from "@/modules/news/service"

export type NewsService = InstanceType<typeof NewsModuleService>

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

export const toOptionalDate = (
  value: string | null | undefined
): Date | null => {
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
  const requestRecord = asUnknownRecord(req)
  const authContext = asUnknownRecord(requestRecord?.auth_context)
  const actorId = authContext?.actor_id
  if (typeof actorId !== "string" || !actorId.trim()) {
    return null
  }

  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const query = remoteQueryObjectFromString({
    entryPoint: "user",
    variables: { id: actorId.trim() },
    fields: ["first_name", "last_name", "email"],
  })

  const users = readRecordArray(await remoteQuery(query), {
    context: "Admin user query",
  })
  if (users.length > 1) {
    throw new Error("Admin user query returned multiple identities.")
  }
  const [user] = users

  if (!user) {
    return null
  }

  const text = (value: unknown, maximum: number): string =>
    typeof value === "string" && value.trim().length <= maximum
      ? value.trim()
      : ""
  const first = text(user.first_name, 255)
  const last = text(user.last_name, 255)
  const fullName = `${first} ${last}`.trim()
  if (fullName.length) {
    return fullName
  }

  return text(user.email, 320) || null
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
