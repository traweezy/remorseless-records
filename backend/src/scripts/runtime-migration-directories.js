const fs = require("node:fs")
const path = require("node:path")

// MikroORM ensures migration directories exist even for modules with no
// migrations. Prepare them during the build so migration discovery never
// needs to create directories in the read-only runtime filesystem.
const prepareRuntimeMigrationDirectories = (
  serverRoot,
  { includeDependencies = false } = {}
) => {
  const modules = path.join(serverRoot, "src", "modules")
  for (const directory of [serverRoot, path.join(serverRoot, "src"), modules]) {
    const entry = fs.lstatSync(directory)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("Runtime module directories must be regular directories.")
    }
  }
  const directories = new Set()
  for (const entry of fs.readdirSync(modules, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Runtime module is a symlink.")
    if (!entry.isDirectory()) continue
    directories.add(path.join(modules, entry.name))
  }
  if (includeDependencies) {
    const store = path.join(serverRoot, "node_modules", ".pnpm")
    const canonicalStore = fs.realpathSync(store)
    if (canonicalStore !== store)
      throw new Error("Runtime dependency store must be canonical.")
    for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const scope = path.join(store, entry.name, "node_modules", "@medusajs")
      if (!fs.existsSync(scope)) continue
      for (const name of fs.readdirSync(scope)) {
        const packageRoot = fs.realpathSync(path.join(scope, name))
        if (!packageRoot.startsWith(`${canonicalStore}${path.sep}`))
          throw new Error("Runtime dependency escaped the packaged store.")
        const distribution = path.join(packageRoot, "dist")
        if (!fs.existsSync(distribution)) continue
        const metadata = fs.lstatSync(distribution)
        if (!metadata.isDirectory() || metadata.isSymbolicLink())
          throw new Error(
            "Runtime dependency distribution must be a regular directory."
          )
        directories.add(distribution)
      }
    }
  }
  for (const directory of directories) {
    const migrations = path.join(directory, "migrations")
    if (!fs.existsSync(migrations)) fs.mkdirSync(migrations, { mode: 0o755 })
    const metadata = fs.lstatSync(migrations)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Runtime migrations must be a regular directory.")
    }
  }
  return directories.size
}

module.exports = { prepareRuntimeMigrationDirectories }
