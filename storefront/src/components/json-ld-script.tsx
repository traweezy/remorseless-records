"use client"

import { memo, useEffect, useSyncExternalStore, type ReactNode } from "react"

import { createJsonLdScript } from "@/lib/seo/json-ld"

type JsonLdScriptProps = {
  children?: ReactNode
  serialized: string
  id?: string
  nonce?: string
}

const unsubscribe = (): void => {}
const subscribe = (): (() => void) => unsubscribe
const clientSnapshot = (): boolean => false
const serverSnapshot = (): boolean => true

export const JsonLdScript = memo<JsonLdScriptProps>(
  ({ children, serialized, id, nonce }) => {
    const serverRendered = useSyncExternalStore(
      subscribe,
      clientSnapshot,
      serverSnapshot
    )

    useEffect(() => {
      if (serverRendered) return

      // React creates new script hosts through innerHTML, even for inert data.
      // The narrow JSON-only policy satisfies the native text sink, which
      // requires TrustedScript even for application/ld+json data blocks.
      const script = createJsonLdScript(document, serialized)
      if (id) script.id = id
      if (nonce) script.nonce = nonce
      document.head.appendChild(script)
      return () => script.remove()
    }, [id, nonce, serialized, serverRendered])

    // The HTML parser emits this on SSR; hydration reuses it. Client-side
    // navigations use the owned data node above, never React's script sink.
    return serverRendered ? children : null
  }
)

JsonLdScript.displayName = "JsonLdScript"
