"use client"

import { useEffect } from "react"

type FocusVisibilityDocument = {
  elementFromPoint: (x: number, y: number) => Element | null
}

type FocusVisibilityTarget = Pick<
  HTMLElement,
  "contains" | "getBoundingClientRect" | "parentElement" | "scrollIntoView"
>

const isHitTestAncestor = (
  target: FocusVisibilityTarget,
  candidate: Element
): boolean => {
  let ancestor = target.parentElement
  while (ancestor) {
    if (ancestor === candidate) {
      return true
    }
    ancestor = ancestor.parentElement
  }
  return false
}

export const isAdminFocusTargetVisible = (
  target: FocusVisibilityTarget,
  ownerDocument: FocusVisibilityDocument
): boolean => {
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return false
  }
  const topmost = ownerDocument.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2
  )
  return Boolean(
    topmost && (target.contains(topmost) || isHitTestAncestor(target, topmost))
  )
}

export const revealAdminFocusTarget = (
  target: FocusVisibilityTarget,
  ownerDocument: FocusVisibilityDocument
): boolean => {
  if (isAdminFocusTargetVisible(target, ownerDocument)) {
    return false
  }
  target.scrollIntoView({
    behavior: "auto",
    block: "center",
    inline: "nearest",
  })
  return true
}

export const useAdminFocusVisibility = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    let frame: number | null = null
    const handleFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) {
        return
      }
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
      const target = event.target
      frame = requestAnimationFrame(() => {
        frame = null
        revealAdminFocusTarget(target, document)
      })
    }
    document.addEventListener("focusin", handleFocus)
    return () => {
      document.removeEventListener("focusin", handleFocus)
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
    }
  }, [enabled])
}
