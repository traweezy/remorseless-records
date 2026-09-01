"use client"

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
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    document.getElementById("main-content")?.focus({ preventScroll: true })
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    })
  }, [])

  return isVisible ? (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-[max(1rem,env(safe-area-inset-right))] z-30 animate-in fade-in slide-in-from-bottom-3 duration-200 motion-reduce:animate-none sm:bottom-6 sm:right-6">
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
    </div>
  ) : null
})

BackToTopButton.displayName = "BackToTopButton"

export default BackToTopButton
