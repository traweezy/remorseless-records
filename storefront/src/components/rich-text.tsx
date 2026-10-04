import "server-only"

import { parseDocument } from "htmlparser2"
import { createElement, type ReactNode } from "react"

import { ALLOWED_RICH_TEXT_TAGS, sanitizeNewsHtml } from "@/lib/news/rich-text"

type RichTextNode = ReturnType<typeof parseDocument>["children"][number]
const allowedTags = new Set<string>(ALLOWED_RICH_TEXT_TAGS)

const renderNode = (node: RichTextNode, index: number): ReactNode => {
  if (node.type === "text") return node.data
  if (node.type !== "tag" || !allowedTags.has(node.name)) return null

  // Only the sanitizer's link attributes cross the server/client boundary.
  const props =
    node.name === "a" && node.attribs.href
      ? {
          key: index,
          href: node.attribs.href,
          target: "_blank",
          rel: "noopener noreferrer",
        }
      : { key: index }
  if (node.name === "br" || node.name === "hr") {
    return createElement(node.name, props)
  }
  return createElement(node.name, props, node.children.map(renderNode))
}

// Sanitizing an HTML string alone does not make React's innerHTML writes
// compatible with enforced Trusted Types during client navigation. Send an
// ordinary React tree instead, keeping both parsers exclusively on the server.
export function RichText({ html }: { html: string }) {
  return parseDocument(sanitizeNewsHtml(html)).children.map(renderNode)
}
