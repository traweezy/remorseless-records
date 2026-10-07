const { createRequire } = require("node:module")

const [cliPath, file, ...args] = process.argv.slice(2)

if (!cliPath || !file) {
  console.error("Medusa execution requires an installed CLI and script path.")
  process.exit(1)
}

async function run() {
  // Preserve the installed CLI's source-script and environment bootstrap.
  const cliRequire = createRequire(cliPath)
  try {
    cliRequire("ts-node").register({})
    cliRequire("tsconfig-paths").register({})
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Medusa source-script TypeScript support could not load.")
      console.warn(error)
    }
  }
  cliRequire("dotenv").config()

  const commandPath = require.resolve("@medusajs/medusa/commands/exec", {
    paths: [process.cwd()],
  })
  // Native exec owns container loading, server-only worker mode and exit status.
  // Bypass yargs, whose exec positional parser discards flag-shaped arguments.
  await require(commandPath).default({ file, args })
}

run().catch((error) => {
  console.error("Medusa script execution failed.", error)
  process.exit(1)
})
