"use client"

const SLOW_TYPES = new Set(["slow-2g", "2g"])

export const shouldBlockPrefetch = (): boolean => {
  if (typeof navigator === "undefined") {
    return false
  }

  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection

  if (!connection) {
    return false
  }

  if (connection.saveData) {
    return true
  }

  return connection.effectiveType ? SLOW_TYPES.has(connection.effectiveType) : false
}
