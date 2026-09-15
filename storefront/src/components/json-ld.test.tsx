import { act, cleanup, render } from "@testing-library/react"
import { Activity, StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import JsonLd, { serializeJsonLd } from "@/components/json-ld"
import { JsonLdScript } from "@/components/json-ld-script"

const headersMock = vi.hoisted(() => vi.fn())

vi.mock("next/headers", () => ({
  headers: headersMock,
}))

describe("JsonLd", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    headersMock.mockResolvedValue(
      new Headers([["x-nonce", "request-header-nonce"]])
    )
  })

  it("serializes script-closing and parser-sensitive characters safely", () => {
    const serialized = serializeJsonLd({
      name: "</script><script>alert('xss')</script>",
      ampersand: "records & tapes",
      separators: "\u2028\u2029",
    })

    expect(serialized).not.toContain("</script")
    expect(serialized).not.toContain("<script")
    expect(serialized).not.toContain("&")
    expect(serialized).not.toContain("\u2028")
    expect(serialized).not.toContain("\u2029")
    expect(JSON.parse(serialized)).toEqual({
      name: "</script><script>alert('xss')</script>",
      ampersand: "records & tapes",
      separators: "\u2028\u2029",
    })
  })

  it("renders parseable nonce-authorized application/ld+json", async () => {
    const data = {
      "@context": "https://schema.org",
      name: "Remorseless Records",
    }
    render(await JsonLd({ id: "organization", data, nonce: "test-nonce" }))
    const script = document.head.querySelector(
      "script#organization[type='application/ld+json']"
    )

    expect(script).not.toBeNull()
    expect(script).toHaveAttribute("nonce", "test-nonce")
    expect(JSON.parse(script?.textContent ?? "")).toEqual(data)
  })

  it("inherits the request nonce when callers omit it", async () => {
    render(await JsonLd({ data: { name: "Catalog" }, id: "catalog" }))

    expect(document.head.querySelector("script#catalog")).toHaveAttribute(
      "nonce",
      "request-header-nonce"
    )
  })

  it("keeps escaped structured data and its nonce in server HTML without JavaScript", async () => {
    const data = {
      name: "</script><script>globalThis.jsonLdInjected=true</script>",
    }
    const markup = renderToString(
      await JsonLd({ id: "server-record", data, nonce: "server-nonce" })
    )
    expect(markup).toContain('type="application/ld+json"')
    expect(markup).toContain('id="server-record"')
    expect(markup).toContain('nonce="server-nonce"')
    expect(markup).toContain(serializeJsonLd(data))
    expect(markup.match(/<script/gu)).toHaveLength(1)
    expect(markup.match(/<\/script>/gu)).toHaveLength(1)
    expect(document.querySelector("#server-record")).toBeNull()
  })

  it("hydrates the server script before replacing it with one owned data node", async () => {
    const data = { "@type": "Product", name: "Hydrated release" }
    const element = await JsonLd({ data, id: "hydrated", nonce: "nonce" })
    const container = document.createElement("div")
    container.innerHTML = renderToString(element)
    document.body.appendChild(container)
    const recoverable = vi.fn()
    const serverScript = container.querySelector("script")
    expect(serverScript).not.toBeNull()
    let root: ReturnType<typeof hydrateRoot> | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, element, {
          onRecoverableError: recoverable,
        })
      })
      expect(recoverable).not.toHaveBeenCalled()
      expect(document.querySelectorAll("#hydrated")).toHaveLength(1)
      const clientScript = document.head.querySelector("#hydrated")
      expect(clientScript).not.toBe(serverScript)
      expect(clientScript).toHaveAttribute("nonce", "nonce")
      expect(JSON.parse(clientScript?.textContent ?? "")).toEqual(data)
      expect(container.querySelector("script")).toBeNull()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
    }
    expect(document.querySelector("#hydrated")).toBeNull()
  })

  it("creates and updates only inert JSON data without invoking an HTML parser", () => {
    const data = { name: "</script><img src=x onerror=alert(1)>" }
    const innerHtml = vi
      .spyOn(Element.prototype, "innerHTML", "set")
      .mockImplementation(() => {
        throw new Error("Client JSON-LD must not use HTML parsing")
      })
    const mounted = render(
      <JsonLdScript serialized={serializeJsonLd(data)} id="client-record" />
    )
    const first = document.head.querySelector("#client-record")
    expect(first).toHaveAttribute("type", "application/ld+json")
    expect(first).not.toHaveAttribute("src")
    expect(first?.children).toHaveLength(0)
    expect(JSON.parse(first?.textContent ?? "")).toEqual(data)
    mounted.rerender(
      <JsonLdScript
        serialized={serializeJsonLd({ name: "Next release" })}
        id="client-record"
      />
    )
    expect(first?.isConnected).toBe(false)
    expect(document.querySelectorAll("#client-record")).toHaveLength(1)
    expect(
      JSON.parse(
        document.head.querySelector("#client-record")?.textContent ?? ""
      )
    ).toEqual({ name: "Next release" })
    expect(innerHtml).not.toHaveBeenCalled()
    mounted.unmount()
    expect(document.querySelector("#client-record")).toBeNull()
  })

  it("balances StrictMode and Activity cleanup without touching unrelated nodes", () => {
    const unrelated = document.createElement("script")
    unrelated.type = "application/ld+json"
    unrelated.id = "owned-record"
    unrelated.appendChild(document.createTextNode('{"name":"Unrelated"}'))
    document.head.appendChild(unrelated)
    const data = [{ name: "Route data" }]
    const view = (mode: "visible" | "hidden") => (
      <StrictMode>
        <Activity mode={mode}>
          <JsonLdScript serialized={serializeJsonLd(data)} id="owned-record" />
        </Activity>
      </StrictMode>
    )
    try {
      const mounted = render(view("visible"))
      expect(document.querySelectorAll("#owned-record")).toHaveLength(2)
      mounted.rerender(view("hidden"))
      expect(document.querySelectorAll("#owned-record")).toHaveLength(1)
      expect(unrelated.isConnected).toBe(true)
      mounted.rerender(view("visible"))
      expect(document.querySelectorAll("#owned-record")).toHaveLength(2)
      mounted.unmount()
      expect(document.querySelectorAll("#owned-record")).toHaveLength(1)
      expect(unrelated.isConnected).toBe(true)
    } finally {
      unrelated.remove()
    }
  })

  it("supports absent nonce and identifier without adding arbitrary attributes", async () => {
    headersMock.mockResolvedValue(new Headers())
    const mounted = render(await JsonLd({ data: { name: "Anonymous" } }))
    const script = document.head.querySelector(
      "script[type='application/ld+json']"
    )
    expect(script).not.toHaveAttribute("nonce")
    expect(script).not.toHaveAttribute("id")
    expect(script?.getAttributeNames()).toEqual(["type"])
    mounted.unmount()
  })
})
