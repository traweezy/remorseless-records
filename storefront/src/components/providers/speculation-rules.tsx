"use client"

import { useEffect, useMemo } from "react"

const SUPPORTED = typeof document !== "undefined" && "speculationRules" in document

const TARGETS = [
  "/catalog",
  "/catalog/(.*)",
  "/products",
  "/products/(.*)",
  "/contact",
  "/about",
  "/press",
  "/submissions",
  "/cart",
  "/order/confirmed",
]

const SpeculationRules = () => {
  const rules = useMemo(
    () => ({
      prefetch: [
        {
          source: "document",
          where: {
            href_matches: TARGETS,
          },
        },
      ],
    }),
    []
  )

  useEffect(() => {
    if (!SUPPORTED) {
      return
    }

    const script = document.createElement("script")
    script.type = "speculationrules"
    script.textContent = JSON.stringify(rules)
    document.head.appendChild(script)

    return () => {
      document.head.removeChild(script)
    }
  }, [rules])

  return null
}

export default SpeculationRules
