import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ProductTracklist } from "./product-tracklist"

describe("ProductTracklist", () => {
  afterEach(cleanup)

  it.each([
    ["1. Signal Check", "2. After the Echo"],
    ["01. Signal Check", "02. After the Echo"],
    ["1) Signal Check", "2) After the Echo"],
  ])(
    "keeps authored sequential numbers without another counter",
    (...tracks) => {
      render(<ProductTracklist tracks={tracks} />)
      const items = screen.getAllByRole("listitem")
      expect(items.map((item) => item.textContent)).toEqual(tracks)
      expect(
        screen.getByRole("list").querySelectorAll("[aria-hidden]")
      ).toHaveLength(0)
    }
  )

  it.each([
    ["1984", "2 Minutes to Midnight"],
    ["1. Life", "After the Echo"],
    ["2. Signal Check", "3. After the Echo"],
    ["1. Signal Check", "1. After the Echo"],
    ["1.Signal Check", "2.After the Echo"],
  ])("preserves numeric and partially numbered titles", (...tracks) => {
    render(<ProductTracklist tracks={tracks} />)
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(tracks.length)
    tracks.forEach((track, index) => {
      expect(screen.getByText(track, { exact: true })).toBeInTheDocument()
      expect(items[index]?.querySelector("[aria-hidden]")?.textContent).toBe(
        String(index + 1).padStart(2, "0")
      )
    })
  })
})
