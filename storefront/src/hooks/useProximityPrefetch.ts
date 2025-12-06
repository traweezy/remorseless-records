"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types"

type Options = {
  selector?: string
  radius?: number
}

const DEFAULT_SELECTOR = "a[data-prefetch='true']"
const DEFAULT_RADIUS = 100

export const useProximityPrefetch = (
  { selector = DEFAULT_SELECTOR, radius = DEFAULT_RADIUS }: Options = {}
) => {
  const router = useRouter()

  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    const seen = new Set<string>()
    let frame: number | null = null

    const handlePointerMove = (event: PointerEvent) => {
      if (frame) {
        cancelAnimationFrame(frame)
      }

      frame = requestAnimationFrame(() => {
        const anchors = document.querySelectorAll<HTMLAnchorElement>(selector)
        if (!anchors.length) {
          return
        }

        const { clientX, clientY } = event

        anchors.forEach((anchor) => {
          const href = anchor.getAttribute("href")
          if (!href || seen.has(href)) {
            return
          }

          const rect = anchor.getBoundingClientRect()
          const withinX =
            clientX >= rect.left - radius && clientX <= rect.right + radius
          const withinY =
            clientY >= rect.top - radius && clientY <= rect.bottom + radius

          if (!withinX || !withinY) {
            return
          }

          seen.add(href)
          try {
            // Force a full prefetch so the product page flight payload is warmed.
            // Next only prefetches in production; this opts into the full fetch kind.
            router.prefetch(href, { kind: PrefetchKind.FULL })
          } catch {
            // Ignore failures
          }
        })
      })
    }

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    })

    return () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }
      window.removeEventListener("pointermove", handlePointerMove)
    }
  }, [router, selector, radius])
}

export default useProximityPrefetch
