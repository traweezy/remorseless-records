import { model } from "@medusajs/framework/utils"

const NewsEntry = model.define(
  {
    name: "news_entry",
    tableName: "news_entries",
  },
  {
    id: model.id({ prefix: "news" }).primaryKey(),
    title: model.text().searchable(),
    slug: model.text().searchable().index(),
    excerpt: model.text().nullable(),
    content: model.text(),
    author: model.text().nullable(),
    status: model
      .enum(["draft", "published", "scheduled", "archived"])
      .default("draft"),
    published_at: model.dateTime().nullable(),
    tags: model.array().default([]),
    cover_url: model.text().nullable(),
    seo_title: model.text().nullable(),
    seo_description: model.text().nullable(),
  }
)

export default NewsEntry
