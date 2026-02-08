"use client"

import Link, { type LinkProps } from "next/link"
import { useRouter } from "next/navigation"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type AnchorHTMLAttributes,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  forwardRef,
} from "react"
import { shouldBlockPrefetch } from "@/lib/prefetch"

type SmartLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
  Omit<LinkProps, "href"> & {
    href: string
    children: ReactNode
    preloadOffset?: number
    nativePrefetch?: boolean
    enableProximity?: boolean
  }

const DEFAULT_PRELOAD_OFFSET = 240

const SmartLinkComponent = (
  {
    href,
    children,
    preloadOffset = DEFAULT_PRELOAD_OFFSET,
    nativePrefetch = false,
    enableProximity = true,
    onMouseEnter,
    onFocus,
    ...rest
  }: SmartLinkProps,
  ref: Ref<HTMLAnchorElement>
) => {
  const router = useRouter()
  const prefetched = useRef(false)
  const anchorRef = useRef<HTMLAnchorElement | null>(null)

  const normalizedHref = useMemo(() => href.trim(), [href])

  const prefetch = useCallback(() => {
    if (prefetched.current || !normalizedHref || shouldBlockPrefetch()) {
      return
    }

    prefetched.current = true
    void Promise.resolve(router.prefetch(normalizedHref)).catch(
      () => {
        // ignore prefetch failures
      }
    )
  }, [normalizedHref, router])

  useEffect(() => {
    if (!enableProximity) {
      return
    }

    const target = anchorRef.current
    if (!target) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            prefetch()
            observer.disconnect()
          }
        })
      },
      {
        rootMargin: `${preloadOffset}px`,
      }
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [enableProximity, preloadOffset, prefetch])

  const handleMouseEnter = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      prefetch()
      if (onMouseEnter) {
        onMouseEnter(event)
      }
    },
    [onMouseEnter, prefetch]
  )

  const handleFocus = useCallback(
    (event: FocusEvent<HTMLAnchorElement>) => {
      prefetch()
      if (onFocus) {
        onFocus(event)
      }
    },
    [onFocus, prefetch]
  )

  const setRef = useCallback(
    (node: HTMLAnchorElement | null) => {
      anchorRef.current = node
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )

  return (
    <Link
      ref={setRef}
      href={normalizedHref}
      prefetch={nativePrefetch}
      data-prefetch={enableProximity}
      onMouseEnter={handleMouseEnter}
      onFocus={handleFocus}
      {...rest}
    >
      {children}
    </Link>
  )
}

export const SmartLink = forwardRef<HTMLAnchorElement, SmartLinkProps>(
  SmartLinkComponent
)

export default SmartLink
