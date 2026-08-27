const ZOD_CORE_UTIL_MODULE_PATTERN = /\/zod\/v4\/core\/util\.(?:c?js|mjs)$/
const EMPTY_FUNCTION_PROBE_PATTERN =
  /try\s*\{\s*const\s+F\s*=\s*Function\s*;\s*new\s+F\(\s*["']{2}\s*\)\s*;\s*return\s+true\s*;\s*\}\s*catch\s*\([^)]*\)\s*\{\s*return\s+false\s*;\s*\}/g
const MINIFIED_EMPTY_FUNCTION_PROBE_PATTERN =
  /try\{const\s+([$\w]+)=Function;return\s+new\s+\1\(["']{2}\),!0\}catch\{return!1\}/g
const ZOD_CORE_SOURCE_MARKERS = [
  "captureStackTrace",
  "Cloudflare",
  "isPrototypeOf",
]

const isZodCoreUtilityModule = (moduleId) =>
  ZOD_CORE_UTIL_MODULE_PATTERN.test(
    moduleId.split("?", 1)[0].replaceAll("\\", "/")
  )

const containsBundledZodCore = (source) =>
  ZOD_CORE_SOURCE_MARKERS.every((marker) => source.includes(marker))

const createZodStrictCspVitePlugin = () => ({
  name: "remorseless-zod-strict-csp",
  enforce: "pre",
  transform: (source, moduleId) => {
    const isZodModule = isZodCoreUtilityModule(moduleId)
    if (!isZodModule && !containsBundledZodCore(source)) {
      return null
    }

    let replacements = 0
    const replaceProbe = () => {
      replacements += 1
      return "return false;"
    }
    const code = source
      .replace(EMPTY_FUNCTION_PROBE_PATTERN, replaceProbe)
      .replace(MINIFIED_EMPTY_FUNCTION_PROBE_PATTERN, replaceProbe)

    if (isZodModule && replacements !== 1) {
      throw new Error(
        `Expected one Zod eval capability probe in ${moduleId}; found ${replacements}.`
      )
    }

    if (replacements === 0) {
      return null
    }

    return { code, map: null }
  },
})

module.exports = { createZodStrictCspVitePlugin }
