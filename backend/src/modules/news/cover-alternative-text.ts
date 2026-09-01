export const resolveNewsCoverAlternativeText = (
  title: string,
  coverUrl: string | null,
  coverAltText: string | null
): string | null =>
  coverUrl ? (coverAltText ?? `${title} cover artwork`) : null
