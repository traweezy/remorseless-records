import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  onlineManager,
} from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"

import {
  adminPermissionKey,
  contentAdminActions,
} from "../../../lib/admin-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../../lib/admin-permissions"
import NewsPage, { handle } from "../content/news/page"
import {
  NewsSuccessFeedback,
  refreshNewsCollection,
  restoreNewsFeedbackFocus,
} from "./page"

const render = (
  permissions: string[] | null,
  { listError = false }: { listError?: boolean } = {}
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (permissions) {
    client.setQueryData(adminFeatureFlagsQueryKey, { rbac: true })
    client.setQueryData(adminPermissionsQueryKey, { permissions })
  }
  if (listError) {
    const query = client.getQueryCache().build(client, {
      queryKey: ["news", "active", "all", "updated_at:desc", "", 0],
      retry: false,
    })
    query.setState({
      data: { count: 0, entries: [], limit: 20, offset: 0 },
      error: new Error("Current list unavailable"),
      errorUpdatedAt: Date.now(),
      fetchStatus: "idle",
      status: "error",
    })
  }
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NewsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const queries = client.getQueryCache().findAll({ queryKey: ["news"] })
  client.clear()
  return { markup, queries }
}

describe("News native read/update mounting boundary", () => {
  it("keeps successful command feedback in page flow with a named dismiss action", () => {
    const markup = renderToStaticMarkup(
      <NewsSuccessFeedback message="News post published" onDismiss={() => {}} />
    )
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain("News post published")
    expect(markup).toMatch(
      /<button[^>]*aria-label="Dismiss News confirmation"[^>]*>Dismiss<\/button>/
    )
    expect(markup).toContain("min-h-6 min-w-6 shrink-0")
    expect(markup).toContain("The current list may reflect later edits.")
    expect(markup).not.toMatch(/position:\s*(absolute|fixed)/)
  })
  it("restores dismissal focus after rendering and falls back when a list error removes search", () => {
    let animation: FrameRequestCallback | undefined
    const originalFrame = Object.getOwnPropertyDescriptor(
      globalThis,
      "requestAnimationFrame"
    )
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        animation = callback
        return 1
      },
    })
    const primary = { isConnected: true, focus: jest.fn() }
    const fallback = { isConnected: true, focus: jest.fn() }
    try {
      restoreNewsFeedbackFocus(
        primary as unknown as HTMLElement,
        fallback as unknown as HTMLElement
      )
      expect(primary.focus).not.toHaveBeenCalled()
      animation?.(0)
      expect(primary.focus).toHaveBeenCalledTimes(1)
      restoreNewsFeedbackFocus(
        primary as unknown as HTMLElement,
        fallback as unknown as HTMLElement
      )
      primary.isConnected = false
      animation?.(0)
      expect(fallback.focus).toHaveBeenCalledTimes(1)
      restoreNewsFeedbackFocus(null, fallback as unknown as HTMLElement)
      fallback.isConnected = false
      animation?.(0)
      expect(fallback.focus).toHaveBeenCalledTimes(1)
    } finally {
      if (originalFrame)
        Object.defineProperty(
          globalThis,
          "requestAnimationFrame",
          originalFrame
        )
      else Reflect.deleteProperty(globalThis, "requestAnimationFrame")
    }
  })
  it("retains the existing native route policy", () => {
    expect(handle.permissions).toBe(
      adminPermissionKey(contentAdminActions.news.read)
    )
  })
  it.each([null, [], [adminPermissionKey(contentAdminActions.news.update)]])(
    "does not mount protected News without confirmed read permission %#",
    (permissions) => {
      const { markup, queries } = render(permissions)
      expect(queries).toHaveLength(0)
      expect(markup).not.toContain("Create post")
    }
  )
  it("mounts readable News without creating mutation capability", () => {
    const { markup, queries } = render([
      adminPermissionKey(contentAdminActions.news.read),
    ])
    expect(queries.length).toBeGreaterThan(0)
    expect(markup).not.toContain("Create post")
    expect(markup).not.toContain("Recover saved News request")
  })
  it("keeps a distinct connected-focus fallback when the failed list removes Search", () => {
    const permissions = [adminPermissionKey(contentAdminActions.news.read)]
    const loaded = render(permissions)
    const failed = render(permissions, { listError: true })
    expect(loaded.markup).toContain('id="news-search"')
    expect(failed.markup).toContain("News could not load")
    expect(failed.markup).not.toContain('id="news-search"')
    for (const markup of [loaded.markup, failed.markup]) {
      expect(markup.match(/id="news-workspace-title"/g)).toHaveLength(1)
      expect(markup).toMatch(
        /<h1[^>]*>\s*<span[^>]*id="news-workspace-title"[^>]*tabindex="-1"[^>]*>News<\/span>/
      )
      expect(markup).not.toContain('id="news-title"')
    }
  })
  it("propagates a real active-query refetch rejection before command completion", async () => {
    const client = new QueryClient()
    const key = ["news", "active"]
    client.setQueryData(key, { entries: [] })
    const failure = new Error("Current list unavailable")
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => {
        throw failure
      },
      retry: false,
      staleTime: Infinity,
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await expect(refreshNewsCollection(client)).rejects.toBe(failure)
    } finally {
      unsubscribe()
      client.clear()
    }
  })
  it("does not treat an offline paused refetch as an accepted current list", async () => {
    const client = new QueryClient()
    const key = ["news", "active"]
    client.setQueryData(key, { entries: [] })
    onlineManager.setOnline(false)
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => ({ entries: [] }),
      retry: false,
      staleTime: Infinity,
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await expect(refreshNewsCollection(client)).rejects.toThrow(
        "could not be refreshed"
      )
    } finally {
      unsubscribe()
      client.clear()
      onlineManager.setOnline(true)
    }
  })
})
