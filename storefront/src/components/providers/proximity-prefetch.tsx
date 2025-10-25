"use client"

import type { ReactNode } from "react"
import useProximityPrefetch from "@/hooks/useProximityPrefetch"

type ProximityPrefetchProps = {
  children: ReactNode
}

const ProximityPrefetch = ({ children }: ProximityPrefetchProps) => {
  useProximityPrefetch()
  return <>{children}</>
}

export default ProximityPrefetch
