import { connection } from "next/server"
import { Suspense } from "react"
async function Pending() {
  await connection()
  await new Promise(() => {})
  return null
}
export default function Page() {
  return (
    <Suspense fallback={<p>stream-started</p>}>
      <Pending />
    </Suspense>
  )
}
