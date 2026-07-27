import { connection, NextResponse } from "next/server"

export const GET = async (): Promise<NextResponse> => {
  await connection()
  const payload: {
    status: "ok"
    uptime_seconds: number
    version?: string
  } = {
    status: "ok",
    uptime_seconds: Math.round(process.uptime()),
  }
  if (process.env.COMMIT_SHA) {
    payload.version = process.env.COMMIT_SHA
  }
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  })
}
