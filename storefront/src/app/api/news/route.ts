import { NextResponse } from "next/server"
import { z } from "zod"

import { fetchNewsEntries, NEWS_PAGE_SIZE } from "@/lib/data/news"

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export const revalidate = 300

export const GET = async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams.entries()))

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid query", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const limit = parsed.data.limit ?? NEWS_PAGE_SIZE
  const offset = parsed.data.offset ?? 0

  const payload = await fetchNewsEntries({ limit, offset })

  return NextResponse.json(payload)
}
