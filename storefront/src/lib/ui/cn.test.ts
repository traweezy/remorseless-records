import { describe, expect, it } from "vitest"

import { cn } from "@/lib/ui/cn"

describe("cn", () => {
  it("merges conditional classes and resolves Tailwind conflicts", () => {
    const result = cn(
      "px-2",
      undefined,
      false,
      ["text-sm", null],
      { "font-bold": true, hidden: false },
      "px-4"
    )

    expect(result).toBe("text-sm font-bold px-4")
  })
})
