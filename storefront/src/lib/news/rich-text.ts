const allowedTags = new Set([
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
])

const blockedTags = new Set(["script", "style", "iframe", "object", "embed"])

const allowedAttributes: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
}

const isSafeUrl = (value: string): boolean => {
  try {
    const url = new URL(value, window.location.origin)
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
  } catch {
    return false
  }
}

const sanitizeElement = (element: Element): void => {
  const tag = element.tagName.toLowerCase()

  if (blockedTags.has(tag)) {
    element.remove()
    return
  }

  if (!allowedTags.has(tag)) {
    const parent = element.parentNode
    if (!parent) {
      element.remove()
      return
    }
    const children = Array.from(element.childNodes)
    children.forEach((child) => parent.insertBefore(child, element))
    element.remove()
    return
  }

  const allowed = allowedAttributes[tag]
  Array.from(element.attributes).forEach((attr) => {
    if (!allowed || !allowed.has(attr.name)) {
      element.removeAttribute(attr.name)
    }
  })

  if (tag === "a") {
    const href = element.getAttribute("href")?.trim() ?? ""
    if (!href || !isSafeUrl(href)) {
      element.removeAttribute("href")
    } else {
      element.setAttribute("target", "_blank")
      element.setAttribute("rel", "noopener noreferrer")
    }
  }
}

const walk = (node: Node): void => {
  if (node.nodeType === Node.ELEMENT_NODE) {
    sanitizeElement(node as Element)
  }

  Array.from(node.childNodes).forEach((child) => walk(child))
}

export const sanitizeNewsHtml = (input: string): string => {
  if (!input) {
    return ""
  }

  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return input
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(input, "text/html")
  if (!doc.body) {
    return ""
  }
  Array.from(doc.body.childNodes).forEach((node) => walk(node))
  return doc.body.innerHTML ?? ""
}
