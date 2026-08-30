import { z } from "zod"

import type { AdminFormIssue } from "../../components/admin-form-contract"
import type { NewsEntry, NewsWriteInput } from "./news-query"

export type NewsPublicationIntent = "draft" | "schedule" | "publish"

const isHttpUrl = (value: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const optionalUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine(
    (value) => value.length === 0 || isHttpUrl(value),
    "Enter a complete http or https URL."
  )

const visibleRichText = (value: string): boolean =>
  value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(?:nbsp|#160);/giu, " ")
    .replace(/\s/gu, "").length > 0

export const newsEditorDraftSchema = z.object({
  content: z.string().max(200_000),
  coverAltText: z.string().trim().max(500),
  coverUrl: optionalUrlSchema,
  excerpt: z.string().trim().max(1_000),
  scheduleAt: z.string().trim().max(100),
  tagsText: z.string().max(5_000),
  title: z.string().trim().max(300),
})

export const newsEditorSchema = newsEditorDraftSchema
  .extend({
    content: newsEditorDraftSchema.shape.content.refine(
      visibleRichText,
      "Write some visible post content."
    ),
    title: newsEditorDraftSchema.shape.title.min(1, "Enter a post title."),
  })
  .superRefine((value, context) => {
    if (value.coverUrl && !value.coverAltText) {
      context.addIssue({
        code: "custom",
        message: "Describe the cover for screen-reader users.",
        path: ["coverAltText"],
      })
    }
    const tags = splitNewsTags(value.tagsText)
    if (tags.length > 50) {
      context.addIssue({
        code: "custom",
        message: "Use no more than 50 tags.",
        path: ["tagsText"],
      })
    }
    if (tags.some((tag) => tag.length > 100)) {
      context.addIssue({
        code: "custom",
        message: "Keep every tag to 100 characters or fewer.",
        path: ["tagsText"],
      })
    }
  })

export type NewsEditorValues = z.infer<typeof newsEditorSchema>

const newsFieldTargets: Record<string, string> = {
  content: "news-content",
  coverAltText: "news-cover-alt",
  coverUrl: "news-cover",
  excerpt: "news-excerpt",
  scheduleAt: "news-schedule-at",
  tagsText: "news-tags",
  title: "news-title",
}

export const newsEditorValidationIssues = (
  values: NewsEditorValues
): AdminFormIssue[] => {
  const result = newsEditorSchema.safeParse(values)
  if (result.success) {
    return []
  }
  return result.error.issues.map((issue) => {
    const field = String(issue.path[0] ?? "")
    return {
      key: `${issue.path.join(".")}:${issue.message}`,
      message: issue.message,
      targetId: newsFieldTargets[field] ?? null,
    }
  })
}

export const emptyNewsEditorValues: NewsEditorValues = {
  content: "",
  coverAltText: "",
  coverUrl: "",
  excerpt: "",
  scheduleAt: "",
  tagsText: "",
  title: "",
}

const nullable = (value: string): string | null => value.trim() || null

const toDateTimeInput = (value: string | null | undefined): string => {
  if (!value) {
    return ""
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export const splitNewsTags = (value: string): string[] => {
  const seen = new Set<string>()
  return value.split(/[,\n]/u).flatMap((part) => {
    const normalized = part.trim()
    const key = normalized.toLocaleLowerCase("en-US")
    if (!normalized || seen.has(key)) {
      return []
    }
    seen.add(key)
    return [normalized]
  })
}

export const valuesFromNewsEntry = (entry: NewsEntry): NewsEditorValues => ({
  content: entry.content,
  coverAltText: entry.coverAltText ?? "",
  coverUrl: entry.coverUrl ?? "",
  excerpt: entry.excerpt ?? "",
  scheduleAt:
    entry.status === "scheduled" ? toDateTimeInput(entry.publishedAt) : "",
  tagsText: entry.tags.join(", "),
  title: entry.title,
})

export const validatePublicationIntent = (
  values: NewsEditorValues,
  intent: NewsPublicationIntent,
  now = new Date()
): string | null => {
  if (intent !== "schedule") {
    return null
  }
  if (!values.scheduleAt.trim()) {
    return "Choose when this post should become visible."
  }
  const scheduled = new Date(values.scheduleAt)
  if (Number.isNaN(scheduled.getTime())) {
    return "Choose a valid publication date and time."
  }
  if (scheduled.getTime() <= now.getTime()) {
    return "Scheduled publication must be in the future."
  }
  return null
}

export const buildNewsWriteInput = (
  values: NewsEditorValues,
  intent: NewsPublicationIntent
): NewsWriteInput => ({
  content: values.content.trim(),
  coverAltText: values.coverUrl.trim() ? nullable(values.coverAltText) : null,
  coverUrl: nullable(values.coverUrl),
  excerpt: nullable(values.excerpt),
  publishedAt:
    intent === "schedule" ? new Date(values.scheduleAt).toISOString() : null,
  status:
    intent === "schedule"
      ? "scheduled"
      : intent === "publish"
        ? "published"
        : "draft",
  tags: splitNewsTags(values.tagsText),
  title: values.title.trim(),
})

export const newsEntryMatchesWriteInput = (
  entry: NewsEntry,
  input: NewsWriteInput
): boolean =>
  entry.content === input.content &&
  entry.coverAltText === input.coverAltText &&
  entry.coverUrl === input.coverUrl &&
  entry.excerpt === input.excerpt &&
  entry.publishedAt === input.publishedAt &&
  entry.status === input.status &&
  JSON.stringify(entry.tags) === JSON.stringify(input.tags) &&
  entry.title === input.title
