export const mergeMetadata = (
  existing: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>
): Record<string, unknown> => ({
  ...(existing ?? {}),
  ...next,
})
