"use client"

import { memo, useCallback } from "react"
import { StatusBadge, Text, clx } from "@medusajs/ui"

import type { ShelfResponse } from "./catalog-merchandising-types"

type ShelfListItemProps = {
  entry: ShelfResponse
  onSelect: (shelfId: string) => void
  selected: boolean
}

const formatMode = (entry: ShelfResponse): string => {
  if (entry.shelf.mode === "manual") {
    return "Manual"
  }
  if (entry.shelf.mode === "hybrid") {
    return "Hybrid"
  }
  return entry.shelf.automationType === "new_release"
    ? "Automatic · New releases"
    : "Automatic"
}

const ShelfListItem = memo<ShelfListItemProps>(
  ({ entry, onSelect, selected }) => {
    const handleSelect = useCallback(() => {
      onSelect(entry.shelf.id)
    }, [entry.shelf.id, onSelect])
    const archived = Boolean(entry.shelf.archivedAt)

    return (
      <li>
        <button
          aria-current={selected ? "true" : undefined}
          className={clx(
            "focus-visible:shadow-borders-interactive-with-focus flex min-h-16 w-full cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-left outline-none transition-colors",
            selected
              ? "border-ui-border-interactive bg-ui-bg-base-pressed"
              : "border-transparent hover:bg-ui-bg-base-hover"
          )}
          onClick={handleSelect}
          type="button"
        >
          <span className="min-w-0">
            <Text className="truncate" size="small" weight="plus">
              {entry.shelf.title}
            </Text>
            <Text
              className={clx(
                "mt-0.5 truncate",
                selected ? "text-ui-fg-base" : "text-ui-fg-subtle"
              )}
              size="xsmall"
            >
              {formatMode(entry)}
            </Text>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge
              color={
                archived ? "orange" : entry.shelf.isActive ? "green" : "grey"
              }
            >
              {archived
                ? "Archived"
                : entry.shelf.isActive
                  ? "Active"
                  : "Draft"}
            </StatusBadge>
            <Text
              className={selected ? "text-ui-fg-base" : "text-ui-fg-subtle"}
              size="xsmall"
            >
              {entry.products.length}{" "}
              {entry.products.length === 1 ? "product" : "products"}
            </Text>
          </span>
        </button>
      </li>
    )
  }
)

ShelfListItem.displayName = "ShelfListItem"

type CatalogShelfListProps = {
  onSelect: (shelfId: string) => void
  selectedShelfId: string
  shelves: ShelfResponse[]
}

export const CatalogShelfList = memo<CatalogShelfListProps>(
  ({ onSelect, selectedShelfId, shelves }) => (
    <ul aria-label="Merchandising shelves" className="space-y-1 p-2">
      {shelves.map((entry) => (
        <ShelfListItem
          entry={entry}
          key={entry.shelf.id}
          onSelect={onSelect}
          selected={entry.shelf.id === selectedShelfId}
        />
      ))}
    </ul>
  )
)

CatalogShelfList.displayName = "CatalogShelfList"
