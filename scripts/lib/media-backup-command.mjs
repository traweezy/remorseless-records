import { runRecoveryCommand } from "./recovery-process.mjs"

export const createMediaBackupScope = (events = process) => {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  // Keep handling repeated signals until the active child has been reaped.
  events.on("SIGINT", cancel)
  events.on("SIGTERM", cancel)
  return {
    signal: controller.signal,
    close: () => {
      events.off("SIGINT", cancel)
      events.off("SIGTERM", cancel)
      controller.abort()
    },
  }
}

export const runMediaBackupCommand = async (
  args,
  { environment, signal, timeoutMs = 600_000 }
) => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
    throw new Error("Invalid media command deadline.")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await runRecoveryCommand("mc", args, {
      environment,
      signal: AbortSignal.any([signal, controller.signal]),
    })
  } catch {
    // Neither provider output nor credential-bearing child errors are surfaced.
    throw new Error("MinIO Client command failed or exceeded its deadline.")
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
