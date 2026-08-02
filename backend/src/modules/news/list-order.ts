type NewsSortDirection = "ASC" | "DESC"

export const withStableNewsOrder = (
  order: Record<string, NewsSortDirection>
): Record<string, NewsSortDirection> =>
  Object.hasOwn(order, "id") ? order : { ...order, id: "ASC" }
