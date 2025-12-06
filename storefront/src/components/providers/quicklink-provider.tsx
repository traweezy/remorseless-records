"use client"

import { useEffect } from "react"
import { shouldBlockPrefetch } from "@/lib/prefetch"

type QuicklinkFn = (options?: { ignores?: Array<RegExp | string>; origins?: boolean }) => void

const QuicklinkProvider = () => {
  useEffect(() => {
    if (shouldBlockPrefetch()) {
      return
    }

    let cancelled = false

    void import("quicklink")
      .then((mod: { default?: unknown }) => {
        if (cancelled) {
          return
        }
        const candidate = mod.default ?? mod
        if (typeof candidate === "function") {
          const quicklink = candidate as QuicklinkFn
          quicklink({
            ignores: [/^\/api/, /^\/_next/],
            origins: true,
          })
        }
      })
      .catch(() => {
        // ignore failures
      })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}

export default QuicklinkProvider
