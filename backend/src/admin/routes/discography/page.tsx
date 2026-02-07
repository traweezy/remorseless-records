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

const availabilityOptions = [
  { value: "in_print", label: "In print" },
  { value: "out_of_print", label: "Out of print" },
  { value: "preorder", label: "Pre-order" },
  { value: "digital_only", label: "Digital only" },
  { value: "unknown", label: "Unknown" },
] as const

type DiscographyAvailability = (typeof availabilityOptions)[number]["value"]

type SortField =
  | "title"
  | "artist"
  | "releaseYear"
  | "catalogNumber"
  | "availability"
type SortDirection = "asc" | "desc"

type SortOption = {
  value: `${SortField}:${SortDirection}`
  label: string
  field: SortField
  direction: SortDirection
}

type DiscographyEntry = {
  id: string
  title: string
  artist: string
  album: string
  productHandle: string | null
  collectionTitle: string | null
  catalogNumber: string | null
  releaseDate: string | null
  releaseYear: number | null
  formats: string[]
  genres: string[]
  availability: DiscographyAvailability
  coverUrl: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

const sortOptions = [
  {
    value: "title:asc",
    label: "Release (A-Z)",
    field: "title",
    direction: "asc",
  },
  {
    value: "title:desc",
    label: "Release (Z-A)",
    field: "title",
    direction: "desc",
  },
  {
    value: "artist:asc",
    label: "Artist (A-Z)",
    field: "artist",
    direction: "asc",
  },
  {
    value: "artist:desc",
    label: "Artist (Z-A)",
    field: "artist",
    direction: "desc",
  },
  {
    value: "releaseYear:desc",
    label: "Year (newest)",
    field: "releaseYear",
    direction: "desc",
  },
  {
    value: "releaseYear:asc",
    label: "Year (oldest)",
    field: "releaseYear",
    direction: "asc",
  },
  {
    value: "catalogNumber:asc",
    label: "Catalog # (A-Z)",
    field: "catalogNumber",
    direction: "asc",
  },
  {
    value: "availability:asc",
    label: "Availability (A-Z)",
    field: "availability",
    direction: "asc",
  },
] satisfies readonly SortOption[]

type SortValue = (typeof sortOptions)[number]["value"]
type AvailabilityFilter = DiscographyAvailability | "all"

type DiscographyFormState = {
  title: string
  artist: string
  productHandle: string
  collectionTitle: string
  catalogNumber: string
  releaseDate: string
  releaseYear: string
  formats: string[]
  genres: string[]
  availability: DiscographyAvailability
  coverUrl: string
}

type ValueChangeEvent = {
  target?: EventTarget | null
  currentTarget?: EventTarget | null
}

const emptyForm: DiscographyFormState = {
  title: "",
  artist: "",
  productHandle: "",
  collectionTitle: "",
  catalogNumber: "",
  releaseDate: "",
  releaseYear: "",
  formats: [],
  genres: [],
  availability: "unknown",
  coverUrl: "",
}

const toDateInput = (value: string | null | undefined): string => {
  if (!value) {
    return ""
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return date.toISOString().slice(0, 10)
}

const normalizeList = (values: string[]): string[] =>
  values
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((value, index, array) => array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)

const readValue = (event: ValueChangeEvent): string => {
  const target = event.currentTarget ?? event.target
  const value = (target as { value?: unknown } | null)?.value
  return typeof value === "string" ? value : ""
}

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

const DiscographyAdminPage = () => {
  const [entries, setEntries] = useState<DiscographyEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formState, setFormState] = useState<DiscographyFormState>(emptyForm)
  const [customGenre, setCustomGenre] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [availabilityFilter, setAvailabilityFilter] =
    useState<AvailabilityFilter>("all")
  const [sortValue, setSortValue] = useState<SortValue>("title:asc")

  const formatOptions = useMemo(
    () => ["Vinyl", "CD", "Cassette"],
    []
  )
  const genreOptions = useMemo(
    () => ["Death", "Doom", "Grind"],
    []
  )

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/admin/discography?limit=200", {
        credentials: "include",
      })
      if (!response.ok) {
        throw new Error(`Failed to load discography (${response.status})`)
      }
      const data = (await response.json()) as { entries: DiscographyEntry[] }
      setEntries(data.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load discography")
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
    setCustomGenre("")
    setFormOpen(false)
  }, [])

  const openCreate = useCallback(() => {
    setEditingId(null)
    setFormState(emptyForm)
    setCustomGenre("")
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((entry: DiscographyEntry) => {
    setEditingId(entry.id)
    setFormState({
      title: entry.title,
      artist: entry.artist,
      productHandle: entry.productHandle ?? "",
      collectionTitle: entry.collectionTitle ?? "",
      catalogNumber: entry.catalogNumber ?? "",
      releaseDate: toDateInput(entry.releaseDate),
      releaseYear: entry.releaseYear ? String(entry.releaseYear) : "",
      formats: entry.formats ?? [],
      genres: entry.genres ?? [],
      availability: entry.availability,
      coverUrl: entry.coverUrl ?? "",
    })
    setCustomGenre("")
    setFormOpen(true)
  }, [])

  const updateField = useCallback(
    (field: keyof DiscographyFormState) =>
      (value: DiscographyFormState[typeof field]) => {
        setFormState((prev) => ({ ...prev, [field]: value }))
      },
    []
  )

  const toggleValue = useCallback(
    (field: "formats" | "genres", value: string) => {
      const trimmed = value.trim()
      if (!trimmed.length) {
        return
      }
      setFormState((prev) => {
        const current = prev[field]
        const exists = current.some((item) => item.toLowerCase() === trimmed.toLowerCase())
        const next = exists
          ? current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())
          : [...current, trimmed]
        return { ...prev, [field]: next }
      })
    },
    []
  )

  const addCustomGenre = useCallback(() => {
    const trimmed = customGenre.trim()
    if (!trimmed) {
      return
    }
    toggleValue("genres", trimmed)
    setCustomGenre("")
  }, [customGenre, toggleValue])

  const removeGenre = useCallback((value: string) => {
    setFormState((prev) => ({
      ...prev,
      genres: prev.genres.filter((item) => item.toLowerCase() !== value.toLowerCase()),
    }))
  }, [])

  const removeFormat = useCallback((value: string) => {
    setFormState((prev) => ({
      ...prev,
      formats: prev.formats.filter((item) => item.toLowerCase() !== value.toLowerCase()),
    }))
  }, [])

  const handleSubmit = useCallback(async () => {
    setError(null)
    if (!formState.title.trim() || !formState.artist.trim()) {
      setError("Title and artist are required.")
      return
    }

    const title = formState.title.trim()
    const resolvedReleaseYear = (() => {
      const dateValue = formState.releaseDate.trim()
      if (dateValue) {
        const parsed = new Date(dateValue)
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.getUTCFullYear()
        }
      }
      return formState.releaseYear.trim()
        ? Number.parseInt(formState.releaseYear, 10)
        : null
    })()

    const payload = {
      title,
      artist: formState.artist.trim(),
      album: title,
      productHandle: formState.productHandle.trim() || null,
      collectionTitle: formState.collectionTitle.trim() || null,
      catalogNumber: formState.catalogNumber.trim() || null,
      releaseDate: formState.releaseDate.trim() || null,
      releaseYear: resolvedReleaseYear,
      formats: normalizeList(formState.formats),
      genres: normalizeList(formState.genres),
      availability: formState.availability,
      coverUrl: formState.coverUrl.trim() || null,
    }

    const url = editingId ? `/admin/discography/${editingId}` : "/admin/discography"
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
    async (entry: DiscographyEntry) => {
      const confirmFn =
        typeof globalThis !== "undefined" &&
        typeof (globalThis as { confirm?: (message: string) => boolean }).confirm ===
          "function"
          ? (globalThis as unknown as { confirm: (message: string) => boolean }).confirm
          : null
      const confirmDelete = confirmFn
        ? confirmFn(`Delete "${entry.title}"? This cannot be undone.`)
        : false
      if (!confirmDelete) {
        return
      }
      setError(null)
      try {
        const response = await fetch(`/admin/discography/${entry.id}`, {
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

  const toggleFormatFilter = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }
    setSelectedFormats((prev) => {
      const exists = prev.some(
        (item) => item.toLowerCase() === trimmed.toLowerCase()
      )
      return exists
        ? prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())
        : [...prev, trimmed]
    })
  }, [])

  const toggleGenreFilter = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }
    setSelectedGenres((prev) => {
      const exists = prev.some(
        (item) => item.toLowerCase() === trimmed.toLowerCase()
      )
      return exists
        ? prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())
        : [...prev, trimmed]
    })
  }, [])

  const clearFilters = useCallback(() => {
    setSearchQuery("")
    setSelectedFormats([])
    setSelectedGenres([])
    setAvailabilityFilter("all")
  }, [])

  const availabilityLabel = useMemo(
    () =>
      availabilityOptions.reduce<Record<string, string>>((acc, option) => {
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
    const activeFormats = selectedFormats.map((value) => value.toLowerCase())
    const activeGenres = selectedGenres.map((value) => value.toLowerCase())

    const matchesSearch = (entry: DiscographyEntry): boolean => {
      if (!normalizedQuery) {
        return true
      }
      const haystack = [
        entry.title,
        entry.artist,
        entry.catalogNumber ?? "",
        entry.collectionTitle ?? "",
        entry.productHandle ?? "",
        entry.formats.join(" "),
        entry.genres.join(" "),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    }

    const matchesFormats = (entry: DiscographyEntry): boolean => {
      if (!activeFormats.length) {
        return true
      }
      return entry.formats.some((format) =>
        activeFormats.includes(format.toLowerCase())
      )
    }

    const matchesGenres = (entry: DiscographyEntry): boolean => {
      if (!activeGenres.length) {
        return true
      }
      return entry.genres.some((genre) =>
        activeGenres.includes(genre.toLowerCase())
      )
    }

    const matchesAvailability = (entry: DiscographyEntry): boolean => {
      if (availabilityFilter === "all") {
        return true
      }
      return entry.availability === availabilityFilter
    }

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

    const compareYear = (
      left?: number | null,
      right?: number | null
    ): number => {
      if (left == null && right == null) {
        return 0
      }
      if (left == null) {
        return 1
      }
      if (right == null) {
        return -1
      }
      return left - right
    }

    const filtered = entries.filter(
      (entry) =>
        matchesSearch(entry) &&
        matchesFormats(entry) &&
        matchesGenres(entry) &&
        matchesAvailability(entry)
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
        case "artist":
          comparison = compareText(left.artist, right.artist)
          break
        case "releaseYear":
          comparison = compareYear(left.releaseYear, right.releaseYear)
          break
        case "catalogNumber":
          comparison = compareText(left.catalogNumber, right.catalogNumber)
          break
        case "availability":
          comparison = compareText(
            availabilityLabel[left.availability],
            availabilityLabel[right.availability]
          )
          break
        default:
          comparison = compareText(left.title, right.title)
          break
      }

      if (comparison === 0) {
        comparison = compareText(left.title, right.title)
      }

      return currentSort.direction === "asc" ? comparison : -comparison
    })

    return sorted
  }, [
    availabilityFilter,
    availabilityLabel,
    collator,
    entries,
    searchQuery,
    selectedFormats,
    selectedGenres,
    sortValue,
  ])

  const hasActiveFilters = useMemo(
    () =>
      searchQuery.trim().length > 0 ||
      selectedFormats.length > 0 ||
      selectedGenres.length > 0 ||
      availabilityFilter !== "all",
    [availabilityFilter, searchQuery, selectedFormats, selectedGenres]
  )

  return (
    <div className="flex h-full flex-col gap-6">
      <Container className="flex items-center justify-between">
        <div>
          <Heading level="h1">Discography</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Manage standalone discography entries (separate from products).
          </Text>
        </div>
        <Button type="button" onClick={openCreate}>
          Add entry
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
            <Label htmlFor="discography-search" className="sr-only">
              Search
            </Label>
            <Input
              id="discography-search"
              placeholder="Search releases, artists, catalog #"
              value={searchQuery}
              onChange={(event) => setSearchQuery(readValue(event))}
            />
            <Text size="xsmall" className="text-ui-fg-subtle">
              Showing {sortedEntries.length} of {entries.length}
            </Text>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="discography-sort" className="sr-only">
              Sort
            </Label>
            <select
              id="discography-sort"
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
            {hasActiveFilters ? (
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Formats
            </Text>
            {formatOptions.map((option) => {
              const selected = selectedFormats.some(
                (value) => value.toLowerCase() === option.toLowerCase()
              )
              return (
                <Button
                  key={`format-filter-${option}`}
                  type="button"
                  size="small"
                  variant={selected ? "primary" : "secondary"}
                  onClick={() => toggleFormatFilter(option)}
                >
                  {option}
                </Button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Genres
            </Text>
            {genreOptions.map((option) => {
              const selected = selectedGenres.some(
                (value) => value.toLowerCase() === option.toLowerCase()
              )
              return (
                <Button
                  key={`genre-filter-${option}`}
                  type="button"
                  size="small"
                  variant={selected ? "primary" : "secondary"}
                  onClick={() => toggleGenreFilter(option)}
                >
                  {option}
                </Button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Availability
            </Text>
            <select
              value={availabilityFilter}
              onChange={(event) =>
                setAvailabilityFilter(readValue(event) as AvailabilityFilter)
              }
              className="min-h-9 rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
            >
              <option value="all">All</option>
              {availabilityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Container>

      <Container className="overflow-hidden">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Release</Table.HeaderCell>
              <Table.HeaderCell>Artist</Table.HeaderCell>
              <Table.HeaderCell>Year</Table.HeaderCell>
              <Table.HeaderCell>Formats</Table.HeaderCell>
              <Table.HeaderCell>Catalog #</Table.HeaderCell>
              <Table.HeaderCell>Availability</Table.HeaderCell>
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
                      {entry.collectionTitle ? (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {entry.collectionTitle}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{entry.artist}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{entry.releaseYear ?? "—"}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {entry.formats.length ? entry.formats.join(", ") : "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{entry.catalogNumber ?? "—"}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {availabilityLabel[entry.availability] ?? "Unknown"}
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
                      : "No discography entries yet."}
                  </Text>
                </Table.Cell>
                <Table.Cell />
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
        <FocusModal.Content className="max-w-4xl sm:inset-y-8 sm:inset-x-1/2 sm:-translate-x-1/2 sm:w-full">
          <FocusModal.Header>
            <div className="flex flex-col gap-1">
              <FocusModal.Title>
                {editingId ? "Edit entry" : "New entry"}
              </FocusModal.Title>
              <FocusModal.Description className="text-ui-fg-subtle">
                Select formats and genres, and add custom genres as needed.
              </FocusModal.Description>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Release (title/album)</Label>
                <Input
                  value={formState.title}
                  onChange={(event) => updateField("title")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Artist</Label>
                <Input
                  value={formState.artist}
                  onChange={(event) => updateField("artist")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Product handle (optional)</Label>
                <Input
                  value={formState.productHandle}
                  onChange={(event) =>
                    updateField("productHandle")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Collection title</Label>
                <Input
                  value={formState.collectionTitle}
                  onChange={(event) =>
                    updateField("collectionTitle")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Catalog number</Label>
                <Input
                  value={formState.catalogNumber}
                  onChange={(event) =>
                    updateField("catalogNumber")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Release date</Label>
                <Input
                  type="date"
                  value={formState.releaseDate}
                  onChange={(event) =>
                    updateField("releaseDate")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Formats</Label>
                <div className="flex flex-wrap gap-2">
                  {formatOptions.map((option) => {
                    const selected = formState.formats.some(
                      (value) => value.toLowerCase() === option.toLowerCase()
                    )
                    return (
                      <Button
                        key={option}
                        type="button"
                        size="small"
                        variant={selected ? "primary" : "secondary"}
                        onClick={() => toggleValue("formats", option)}
                      >
                        {option}
                      </Button>
                    )
                  })}
                </div>
                {formState.formats.length ? (
                  <div className="flex flex-wrap gap-2">
                    {formState.formats.map((format) => (
                      <Button
                        key={`format-${format}`}
                        type="button"
                        size="small"
                        variant="secondary"
                        onClick={() => removeFormat(format)}
                      >
                        {format} ×
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Genres</Label>
                <div className="flex flex-wrap gap-2">
                  {genreOptions.map((option) => {
                    const selected = formState.genres.some(
                      (value) => value.toLowerCase() === option.toLowerCase()
                    )
                    return (
                      <Button
                        key={option}
                        type="button"
                        size="small"
                        variant={selected ? "primary" : "secondary"}
                        onClick={() => toggleValue("genres", option)}
                      >
                        {option}
                      </Button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={customGenre}
                    placeholder="Add a genre…"
                    onChange={(event) => setCustomGenre(readValue(event))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        addCustomGenre()
                      }
                    }}
                    className="max-w-xs"
                  />
                  <Button type="button" size="small" variant="secondary" onClick={addCustomGenre}>
                    Add genre
                  </Button>
                </div>
                {formState.genres.length ? (
                  <div className="flex flex-wrap gap-2">
                    {formState.genres.map((genre) => (
                      <Button
                        key={`genre-${genre}`}
                        type="button"
                        size="small"
                        variant="secondary"
                        onClick={() => removeGenre(genre)}
                      >
                        {genre} ×
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Availability</Label>
                <select
                  value={formState.availability}
                  onChange={(event) =>
                    updateField("availability")(
                      readValue(event) as DiscographyAvailability
                    )
                  }
                  className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                >
                  {availabilityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Cover URL</Label>
                <Input
                  value={formState.coverUrl}
                  onChange={(event) => updateField("coverUrl")(readValue(event))}
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
              {editingId ? "Save changes" : "Create entry"}
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Discography",
  icon: ArchiveBox,
})

export default DiscographyAdminPage
