type LogPayload = unknown

const serialize = (payload: LogPayload): string => {
  if (payload === undefined) {
    return ""
  }

  if (typeof payload === "string") {
    return payload
  }

  try {
    return JSON.stringify(payload)
  } catch {
    return "[unserializable payload]"
  }
}

export const safeLogError = (message: string, payload?: LogPayload): void => {
  try {
    const serializedPayload = payload === undefined ? "" : ` ${serialize(payload)}`
    const line = `${message}${serializedPayload}\n`

    if (typeof process !== "undefined" && process.stderr?.write) {
      process.stderr.write(line)
      return
    }

    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log(line)
      return
    }
  } catch {
    // Ignore logging failures entirely to avoid masking the original error.
  }
}
