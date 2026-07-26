import sanitizeHtml from "sanitize-html"

const ALLOWED_RICH_TEXT_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "h2",
  "h3",
  "h4",
  "hr",
] as const

const firstPassOptions = {
  allowedTags: [...ALLOWED_RICH_TEXT_TAGS],
  allowedAttributes: {
    a: ["href"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: true,
  nestingLimit: 32,
} satisfies sanitizeHtml.IOptions

const secondPassOptions = {
  ...firstPassOptions,
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  transformTags: {
    a: (tagName, attributes) => {
      const href = attributes.href?.trim()
      if (!href) {
        return { tagName, attribs: {} }
      }

      return {
        tagName,
        attribs: {
          href,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }
    },
  },
} satisfies sanitizeHtml.IOptions

const plainTextOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: true,
} satisfies sanitizeHtml.IOptions

export const sanitizeRichTextHtml = (input: string): string => {
  if (!input) {
    return ""
  }

  const safeHtml = sanitizeHtml(input, firstPassOptions)
  return sanitizeHtml(safeHtml, secondPassOptions)
}

export const richTextToPlainText = (input: string): string =>
  sanitizeHtml(sanitizeRichTextHtml(input), plainTextOptions)
    .replace(/\s+/g, " ")
    .trim()

export const hasVisibleRichText = (input: string): boolean =>
  richTextToPlainText(input).length > 0
