import { z } from "zod"

// Next runs this synchronously before hydration, including its minimal error
// document. A root-layout script is absent there and React cannot recreate it
// under Trusted Types. Keep validation free of Function/eval on every entry.
z.config({ jitless: true })
