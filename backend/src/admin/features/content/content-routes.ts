export type ContentWorkspace = "overview" | "news" | "discography"

export type ContentDetailWorkspace = Exclude<ContentWorkspace, "overview">

export const contentRoutePaths = {
  discography: "/content/discography",
  news: "/content/news",
  overview: "/content",
} as const satisfies Record<ContentWorkspace, string>

export const contentAppRoutePaths = {
  discography: "/app/content/discography",
  news: "/app/content/news",
} as const satisfies Record<ContentDetailWorkspace, string>

export type ReplaceContentLocation = {
  replace: (url: string) => void
}

export const replaceLegacyContentLocation = (
  location: ReplaceContentLocation,
  workspace: ContentDetailWorkspace,
): void => {
  location.replace(contentAppRoutePaths[workspace])
}
