"use client"

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowUp } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

const canScrollBackToTop = (): boolean => {
  const viewportHeight = window.innerHeight
  const documentHeight = document.documentElement.scrollHeight
  const revealThreshold = Math.min(viewportHeight * 0.5, 480)

  return documentHeight > viewportHeight && window.scrollY > revealThreshold
}

const BackToTopButton = memo(() => {
  const prefersReducedMotion = useReducedMotion()
  const [isVisible, setIsVisible] = useState(false)

  const updateVisibility = useCallback(() => {
    setIsVisible(canScrollBackToTop())
  }, [])

  useEffect(() => {
    updateVisibility()
    window.addEventListener("scroll", updateVisibility, { passive: true })
    window.addEventListener("resize", updateVisibility)

    return () => {
      window.removeEventListener("scroll", updateVisibility)
      window.removeEventListener("resize", updateVisibility)
    }
  }, [updateVisibility])

  const handleBackToTop = useCallback(() => {
    document.getElementById("main-content")?.focus({ preventScroll: true })
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    })
  }, [prefersReducedMotion])

  const transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <AnimatePresence initial={false}>
      {isVisible ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 12 }}
          transition={transition}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-[max(1rem,env(safe-area-inset-right))] z-30 sm:bottom-6 sm:right-6"
        >
          <Button
            type="button"
            variant="filled"
            size="icon"
            onClick={handleBackToTop}
            className="h-12 w-12 border border-destructive/80 shadow-[0_14px_40px_-14px_hsla(0,80%,55%,0.85)]"
            aria-label="Back to top"
            title="Back to top"
          >
            <ArrowUp className="h-5 w-5" aria-hidden />
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
})

BackToTopButton.displayName = "BackToTopButton"

export default BackToTopButton
