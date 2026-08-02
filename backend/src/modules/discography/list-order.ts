export type DiscographySortDirection = "ASC" | "DESC"

export const withStableDiscographyOrder = (
  order: Readonly<Record<string, DiscographySortDirection>>
): Record<string, DiscographySortDirection> =>
  Object.hasOwn(order, "id") ? { ...order } : { ...order, id: "ASC" }
