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
    if (payload === undefined) {
      console.error(message)
    } else {
      console.error(message, payload)
    }
  } catch {
    try {
      const suffix = payload === undefined ? "" : ` ${serialize(payload)}`
      process.stderr?.write?.(`${message}${suffix}\n`)
    } catch {
      // Ignore logging failures entirely to avoid masking the original error.
    }
  }
}
