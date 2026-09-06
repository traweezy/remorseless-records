// pnpm run forwards an optional separator. Strip only the leading separator;
// all remaining tokens still belong to the command's strict argument parser.
export const normalizeScriptArguments = (args) =>
  args[0] === "--" ? args.slice(1) : [...args]
