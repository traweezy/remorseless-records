"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArchiveBox, PencilSquare, Trash } from "@medusajs/icons"
import {
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Table,
  Text,
  Textarea,
} from "@medusajs/ui"

const statusOptions = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "scheduled", label: "Scheduled" },
  { value: "archived", label: "Archived" },
] as const

type NewsStatus = (typeof statusOptions)[number]["value"]

type SortField = "published_at" | "created_at" | "title" | "status"
type SortDirection = "asc" | "desc"

type SortOption = {
  value: `${SortField}:${SortDirection}`
  label: string
  field: SortField
  direction: SortDirection
}

const sortOptions = [
  {
    value: "published_at:desc",
    label: "Published (newest)",
    field: "published_at",
    direction: "desc",
  },
  {
    value: "published_at:asc",
    label: "Published (oldest)",
    field: "published_at",
    direction: "asc",
  },
  {
    value: "created_at:desc",
    label: "Created (newest)",
    field: "created_at",
    direction: "desc",
  },
  {
    value: "title:asc",
    label: "Title (A-Z)",
    field: "title",
    direction: "asc",
  },
  {
    value: "title:desc",
    label: "Title (Z-A)",
    field: "title",
    direction: "desc",
  },
  {
    value: "status:asc",
    label: "Status (A-Z)",
    field: "status",
    direction: "asc",
  },
] satisfies readonly SortOption[]

type SortValue = (typeof sortOptions)[number]["value"]
type StatusFilter = NewsStatus | "all"

type NewsEntry = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  author: string | null
  status: NewsStatus
  publishedAt: string | null
  tags: string[]
  coverUrl: string | null
  seoTitle: string | null
  seoDescription: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type NewsFormState = {
  title: string
  slug: string
  excerpt: string
  content: string
  author: string
  status: NewsStatus
  publishedAt: string
  tags: string[]
  coverUrl: string
  seoTitle: string
  seoDescription: string
}

type ValueChangeEvent = {
  target?: EventTarget | null
  currentTarget?: EventTarget | null
}

const emptyForm: NewsFormState = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  author: "",
  status: "draft",
  publishedAt: "",
  tags: [],
  coverUrl: "",
  seoTitle: "",
  seoDescription: "",
}

const readValue = (event: ValueChangeEvent): string => {
  const target = event.currentTarget ?? event.target
  const value = (target as { value?: unknown } | null)?.value
  return typeof value === "string" ? value : ""
}

const slugify = (value: string): string => {
  const trimmed = value.trim().toLowerCase()
  const sanitized = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
  return sanitized.length ? sanitized : "news"
}

const toDateTimeInput = (value: string | null | undefined): string => {
  if (!value) {
    return ""
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const normalizeList = (values: string[]): string[] =>
  values
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter(
      (value, index, array) =>
        array.findIndex(
          (item) => item.toLowerCase() === value.toLowerCase()
        ) === index
    )

const extractErrorMessage = async (
  response: Response
): Promise<string | null> => {
  const data = await response.json().catch(() => null)
  if (!data || typeof data !== "object") {
    return null
  }
  const message = (data as { message?: unknown }).message
  if (typeof message === "string") {
    return message
  }
  const error = (data as { error?: unknown }).error
  if (typeof error === "string") {
    return error
  }
  return null
}

const NewsAdminPage = () => {
  const [entries, setEntries] = useState<NewsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formState, setFormState] = useState<NewsFormState>(emptyForm)
  const [customTag, setCustomTag] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [sortValue, setSortValue] = useState<SortValue>("published_at:desc")

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        "/admin/news?limit=200&order=published_at&direction=desc",
        {
          credentials: "include",
        }
      )
      if (!response.ok) {
        throw new Error(`Failed to load news (${response.status})`)
      }
      const data = (await response.json()) as { entries: NewsEntry[] }
      setEntries(data.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchEntries()
  }, [fetchEntries])

  const resetForm = useCallback(() => {
    setEditingId(null)
    setFormState(emptyForm)
    setCustomTag("")
    setSlugTouched(false)
    setFormOpen(false)
  }, [])

  const openCreate = useCallback(() => {
    setEditingId(null)
    setFormState(emptyForm)
    setCustomTag("")
    setSlugTouched(false)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((entry: NewsEntry) => {
    setEditingId(entry.id)
    setFormState({
      title: entry.title,
      slug: entry.slug,
      excerpt: entry.excerpt ?? "",
      content: entry.content ?? "",
      author: entry.author ?? "",
      status: entry.status,
      publishedAt: toDateTimeInput(entry.publishedAt),
      tags: entry.tags ?? [],
      coverUrl: entry.coverUrl ?? "",
      seoTitle: entry.seoTitle ?? "",
      seoDescription: entry.seoDescription ?? "",
    })
    setCustomTag("")
    setSlugTouched(true)
    setFormOpen(true)
  }, [])

  const updateField = useCallback(
    (field: keyof NewsFormState) =>
      (value: NewsFormState[typeof field]) => {
        setFormState((prev) => ({ ...prev, [field]: value }))
      },
    []
  )

  const handleTitleChange = useCallback(
    (value: string) => {
      setFormState((prev) => {
        const nextSlug = slugTouched || prev.slug.length
          ? prev.slug
          : slugify(value)
        return { ...prev, title: value, slug: nextSlug }
      })
    },
    [slugTouched]
  )

  const handleSlugChange = useCallback((value: string) => {
    setSlugTouched(true)
    setFormState((prev) => ({ ...prev, slug: value }))
  }, [])

  const addTag = useCallback(() => {
    const trimmed = customTag.trim()
    if (!trimmed) {
      return
    }
    setFormState((prev) => ({
      ...prev,
      tags: normalizeList([...prev.tags, trimmed]),
    }))
    setCustomTag("")
  }, [customTag])

  const removeTag = useCallback((value: string) => {
    setFormState((prev) => ({
      ...prev,
      tags: prev.tags.filter(
        (tag) => tag.toLowerCase() !== value.toLowerCase()
      ),
    }))
  }, [])

  const handleSubmit = useCallback(async () => {
    setError(null)
    if (!formState.title.trim() || !formState.content.trim()) {
      setError("Title and content are required.")
      return
    }

    const title = formState.title.trim()
    const slug = formState.slug.trim() || slugify(title)
    const publishedAtRaw = formState.publishedAt.trim()
    const publishedAt = publishedAtRaw
      ? new Date(publishedAtRaw).toISOString()
      : null

    const payload = {
      title,
      slug,
      excerpt: formState.excerpt.trim() || null,
      content: formState.content.trim(),
      author: formState.author.trim() || null,
      status: formState.status,
      publishedAt,
      tags: normalizeList(formState.tags),
      coverUrl: formState.coverUrl.trim() || null,
      seoTitle: formState.seoTitle.trim() || null,
      seoDescription: formState.seoDescription.trim() || null,
    }

    const url = editingId ? `/admin/news/${editingId}` : "/admin/news"
    const method = editingId ? "PUT" : "POST"

    try {
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const message =
          (await extractErrorMessage(response)) ??
          `Failed to ${editingId ? "update" : "create"} entry`
        throw new Error(message)
      }
      await fetchEntries()
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save entry")
    }
  }, [editingId, fetchEntries, formState, resetForm])

  const handleDelete = useCallback(
    async (entry: NewsEntry) => {
      const confirmFn =
        typeof globalThis !== "undefined" &&
        typeof (globalThis as { confirm?: (message: string) => boolean })
          .confirm === "function"
          ? (globalThis as unknown as { confirm: (message: string) => boolean })
              .confirm
          : null
      const confirmDelete = confirmFn
        ? confirmFn(`Delete "${entry.title}"? This cannot be undone.`)
        : false
      if (!confirmDelete) {
        return
      }
      setError(null)
      try {
        const response = await fetch(`/admin/news/${entry.id}`, {
          method: "DELETE",
          credentials: "include",
        })
        if (!response.ok) {
          throw new Error("Failed to delete entry")
        }
        await fetchEntries()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete entry")
      }
    },
    [fetchEntries]
  )

  const statusLabel = useMemo(
    () =>
      statusOptions.reduce<Record<string, string>>((acc, option) => {
        acc[option.value] = option.label
        return acc
      }, {}),
    []
  )

  const collator = useMemo(
    () => new Intl.Collator("en", { numeric: true, sensitivity: "base" }),
    []
  )

  const sortedEntries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const matchesSearch = (entry: NewsEntry): boolean => {
      if (!normalizedQuery) {
        return true
      }
      const haystack = [
        entry.title,
        entry.slug,
        entry.author ?? "",
        entry.excerpt ?? "",
        entry.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    }

    const matchesStatus = (entry: NewsEntry): boolean =>
      statusFilter === "all" ? true : entry.status === statusFilter

    const compareText = (left?: string | null, right?: string | null): number => {
      if (!left && !right) {
        return 0
      }
      if (!left) {
        return 1
      }
      if (!right) {
        return -1
      }
      return collator.compare(left, right)
    }

    const compareDate = (
      left?: string | null,
      right?: string | null
    ): number => {
      const leftValue = left ? new Date(left).getTime() : Number.NaN
      const rightValue = right ? new Date(right).getTime() : Number.NaN
      const leftValid = Number.isFinite(leftValue)
      const rightValid = Number.isFinite(rightValue)
      if (!leftValid && !rightValid) {
        return 0
      }
      if (!leftValid) {
        return 1
      }
      if (!rightValid) {
        return -1
      }
      return leftValue - rightValue
    }

    const filtered = entries.filter(
      (entry) => matchesSearch(entry) && matchesStatus(entry)
    )

    const defaultSort = sortOptions[0]
    if (!defaultSort) {
      return filtered
    }
    const currentSort =
      sortOptions.find((option) => option.value === sortValue) ?? defaultSort

    const sorted = [...filtered].sort((left, right) => {
      let comparison = 0
      switch (currentSort.field) {
        case "created_at":
          comparison = compareDate(left.createdAt, right.createdAt)
          break
        case "title":
          comparison = compareText(left.title, right.title)
          break
        case "status":
          comparison = compareText(left.status, right.status)
          break
        case "published_at":
        default:
          comparison = compareDate(left.publishedAt, right.publishedAt)
          break
      }

      if (comparison === 0) {
        comparison = compareText(left.title, right.title)
      }

      return currentSort.direction === "asc" ? comparison : -comparison
    })

    return sorted
  }, [collator, entries, searchQuery, sortValue, statusFilter])

  const hasActiveFilters = useMemo(
    () => searchQuery.trim().length > 0 || statusFilter !== "all",
    [searchQuery, statusFilter]
  )

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }),
    []
  )

  return (
    <div className="flex h-full flex-col gap-6">
      <Container className="flex items-center justify-between">
        <div>
          <Heading level="h1">News</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Manage news posts for the public newsroom page.
          </Text>
        </div>
        <Button type="button" onClick={openCreate}>
          Add post
        </Button>
      </Container>

      {error ? (
        <Container>
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        </Container>
      ) : null}

      <Container className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="news-search" className="sr-only">
              Search
            </Label>
            <Input
              id="news-search"
              placeholder="Search posts, authors, tags"
              value={searchQuery}
              onChange={(event) => setSearchQuery(readValue(event))}
            />
            <Text size="xsmall" className="text-ui-fg-subtle">
              Showing {sortedEntries.length} of {entries.length}
            </Text>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="news-sort" className="sr-only">
              Sort
            </Label>
            <select
              id="news-sort"
              value={sortValue}
              onChange={(event) =>
                setSortValue(readValue(event) as SortValue)
              }
              className="min-h-9 rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(readValue(event) as StatusFilter)
              }
              className="min-h-9 rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
            >
              <option value="all">All status</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSearchQuery("")
                  setStatusFilter("all")
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      </Container>

      <Container className="overflow-hidden">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Title</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Author</Table.HeaderCell>
              <Table.HeaderCell>Published</Table.HeaderCell>
              <Table.HeaderCell>Tags</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading ? (
              <Table.Row>
                <Table.Cell>Loading…</Table.Cell>
                <Table.Cell />
                <Table.Cell />
                <Table.Cell />
                <Table.Cell />
                <Table.Cell />
              </Table.Row>
            ) : sortedEntries.length ? (
              sortedEntries.map((entry) => (
                <Table.Row key={entry.id}>
                  <Table.Cell>
                    <div className="flex flex-col gap-1">
                      <Text size="small" weight="plus">
                        {entry.title}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        /news/{entry.slug}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {statusLabel[entry.status] ?? entry.status}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{entry.author ?? "—"}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {entry.publishedAt
                        ? dateFormatter.format(new Date(entry.publishedAt))
                        : "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {entry.tags.length ? entry.tags.join(", ") : "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        onClick={() => openEdit(entry)}
                      >
                        <PencilSquare />
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        onClick={() => handleDelete(entry)}
                      >
                        <Trash />
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            ) : (
              <Table.Row>
                <Table.Cell>
                  <Text size="small">
                    {hasActiveFilters
                      ? "No entries match the current filters."
                      : "No news posts yet."}
                  </Text>
                </Table.Cell>
                <Table.Cell />
                <Table.Cell />
                <Table.Cell />
                <Table.Cell />
                <Table.Cell />
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </Container>

      <FocusModal
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetForm()
          }
        }}
      >
        <FocusModal.Content className="max-w-5xl sm:inset-y-8 sm:inset-x-1/2 sm:-translate-x-1/2 sm:w-full">
          <FocusModal.Header>
            <div className="flex flex-col gap-1">
              <FocusModal.Title>
                {editingId ? "Edit post" : "New post"}
              </FocusModal.Title>
              <FocusModal.Description className="text-ui-fg-subtle">
                Populate the newsroom with published updates and upcoming drops.
              </FocusModal.Description>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Title</Label>
                <Input
                  value={formState.title}
                  onChange={(event) => handleTitleChange(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input
                  value={formState.slug}
                  onChange={(event) => handleSlugChange(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <select
                  value={formState.status}
                  onChange={(event) =>
                    updateField("status")(readValue(event) as NewsStatus)
                  }
                  className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Publish date</Label>
                <Input
                  type="datetime-local"
                  value={formState.publishedAt}
                  onChange={(event) =>
                    updateField("publishedAt")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Author</Label>
                <Input
                  value={formState.author}
                  onChange={(event) =>
                    updateField("author")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Cover image URL</Label>
                <Input
                  value={formState.coverUrl}
                  onChange={(event) =>
                    updateField("coverUrl")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Excerpt</Label>
                <Textarea
                  value={formState.excerpt}
                  onChange={(event) =>
                    updateField("excerpt")(readValue(event))
                  }
                  rows={3}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Content</Label>
                <Textarea
                  value={formState.content}
                  onChange={(event) =>
                    updateField("content")(readValue(event))
                  }
                  rows={10}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Tags</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={customTag}
                    placeholder="Add a tag…"
                    onChange={(event) => setCustomTag(readValue(event))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        addTag()
                      }
                    }}
                    className="max-w-xs"
                  />
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    onClick={addTag}
                  >
                    Add tag
                  </Button>
                </div>
                {formState.tags.length ? (
                  <div className="flex flex-wrap gap-2">
                    {formState.tags.map((tag) => (
                      <Button
                        key={`tag-${tag}`}
                        type="button"
                        size="small"
                        variant="secondary"
                        onClick={() => removeTag(tag)}
                      >
                        {tag} ×
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>SEO title</Label>
                <Input
                  value={formState.seoTitle}
                  onChange={(event) =>
                    updateField("seoTitle")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>SEO description</Label>
                <Textarea
                  value={formState.seoDescription}
                  onChange={(event) =>
                    updateField("seoDescription")(readValue(event))
                  }
                  rows={3}
                />
              </div>
            </div>
          </FocusModal.Body>
          <FocusModal.Footer>
            <FocusModal.Close asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </FocusModal.Close>
            <Button type="button" onClick={handleSubmit}>
              {editingId ? "Save changes" : "Create post"}
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "News",
  icon: ArchiveBox,
})

export default NewsAdminPage
