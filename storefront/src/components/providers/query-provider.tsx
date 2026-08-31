"use client"

import {
  QueryClient,
  QueryClientProvider,
  defaultShouldDehydrateQuery,
  focusManager,
} from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"

type QueryProviderProps = {
  readonly children: ReactNode
}

export const LEGACY_QUERY_CACHE_KEY = "REACT_QUERY_OFFLINE_CACHE"
export const PUBLIC_QUERY_CACHE_KEY = "RR_PUBLIC_QUERY_CACHE_V2"
export const PUBLIC_QUERY_CACHE_BUSTER = "explicit-public-persistence-v1"
export const PUBLIC_QUERY_CACHE_MAX_AGE_MS = 15 * 60_000

type QueryPersistenceMeta = Record<string, unknown> | undefined

export const hasExplicitPublicPersistence = (
  meta: QueryPersistenceMeta
): boolean => meta?.persist === true

export const removeLegacyQueryCache = (
  storage: Pick<Storage, "removeItem">
): void => {
  storage.removeItem(LEGACY_QUERY_CACHE_KEY)
}

const browserStorage = (): Storage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
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

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    const storage = browserStorage()
    if (!storage) {
      return
    }
    try {
      removeLegacyQueryCache(storage)
    } catch {
      // Browser privacy modes may deny persistence; memory caching still works.
    }
  }, [])

  const persister = useMemo(() => {
    if (typeof window === "undefined") {
      return undefined
    }
    const storage = browserStorage()
    return storage
      ? createSyncStoragePersister({
          key: PUBLIC_QUERY_CACHE_KEY,
          storage,
        })
      : undefined
  }, [])

  const devtools =
    process.env.NODE_ENV !== "production" ? (
      <ReactQueryDevtools
        position="bottom"
        buttonPosition="bottom-right"
        initialIsOpen={false}
      />
    ) : null

  if (!persister) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        {devtools}
      </QueryClientProvider>
    )
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        buster: PUBLIC_QUERY_CACHE_BUSTER,
        maxAge: PUBLIC_QUERY_CACHE_MAX_AGE_MS,
        persister,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            hasExplicitPublicPersistence(query.meta) &&
            defaultShouldDehydrateQuery(query),
        },
      }}
    >
      {children}
      {devtools}
    </PersistQueryClientProvider>
  )
}

export default QueryProvider
