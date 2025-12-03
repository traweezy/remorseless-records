import "dotenv/config"

import { searchProductsServer } from "@/lib/search/server"

const run = async () => {
  const result = await searchProductsServer({
    query: "",
    limit: 1,
  })

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result.hits[0], null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
