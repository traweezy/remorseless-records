import { connection } from "next/server"
import { Suspense } from "react"
async function Broken() {
  await connection()
  throw new Error("fixture-render-failure")
}
export default function Page() {
  return (
    <Suspense fallback={<p>stream-started</p>}>
      <Broken />
    </Suspense>
  )
}
