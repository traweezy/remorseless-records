"use client"

import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"

type QueryProviderProps = {
  readonly children: ReactNode
}

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 2,
      },
      mutations: {
        retry: 1,
      },
    },
  })

export const QueryProvider = ({ children }: QueryProviderProps) => {
  const [queryClient] = useState(createQueryClient)
  const [hasMounted, setHasMounted] = useState(false)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  useEffect(() => {
    if (!hasMounted) {
      return
    }

    const handleFocus = () => {
      focusManager.setFocused(true)
    }

    const handleBlur = () => {
      focusManager.setFocused(false)
    }

    const handleVisibility = () => {
      focusManager.setFocused(!document.hidden)
    }

    window.addEventListener("focus", handleFocus)
    window.addEventListener("blur", handleBlur)
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      window.removeEventListener("focus", handleFocus)
      window.removeEventListener("blur", handleBlur)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [hasMounted])

  const persister = useMemo(() => {
    if (!hasMounted) {
      return undefined
    }

    return createSyncStoragePersister({ storage: window.localStorage })
  }, [hasMounted])

  const devtools = hasMounted && process.env.NODE_ENV !== "production"
    ? (
      <ReactQueryDevtools
        position="bottom"
        buttonPosition="bottom-right"
        initialIsOpen={false}
      />
    )
    : null

  if (!persister) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        {devtools}
      </QueryClientProvider>
    )
  }

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      {children}
      {devtools}
    </PersistQueryClientProvider>
  )
}

export default QueryProvider
