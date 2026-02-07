import type { Metadata } from "next"
import Image from "next/image"
import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { siteMetadata } from "@/config/site"
import { getNewsEntryBySlug } from "@/lib/data/news"
import { sanitizeNewsHtml } from "@/lib/news/rich-text"

type NewsPageProps = {
  params: { slug: string } | Promise<{ slug: string }>
}

const normalizeSlug = (slug: string | null | undefined): string | null => {
  if (typeof slug !== "string") {
    return null
  }

  const trimmed = slug.trim()
  return trimmed.length ? trimmed : null
}

export const generateMetadata = async ({
  params,
}: NewsPageProps): Promise<Metadata> => {
  const rawParams = await params
  const slug = normalizeSlug(rawParams.slug)
  if (!slug) {
    return { title: "News · Remorseless Records" }
  }

  const entry = await getNewsEntryBySlug(slug)
  if (!entry) {
    return { title: "News · Remorseless Records" }
  }

  const canonical = `${siteMetadata.siteUrl}/news/${entry.slug}`
  const title = entry.seoTitle ?? `${entry.title} · Remorseless Records`
  const description =
    entry.seoDescription ??
    entry.excerpt ??
    "Dispatches from the label."

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      url: canonical,
      title,
      description,
      images: entry.coverUrl
        ? [{ url: entry.coverUrl, alt: entry.title }]
        : undefined,
    },
    twitter: {
      title,
      description,
      images: entry.coverUrl ? [entry.coverUrl] : undefined,
    },
  }
}

const NewsDetailPage = async ({ params }: NewsPageProps) => {
  const rawParams = await params
  const slug = normalizeSlug(rawParams.slug)
  if (!slug) {
    notFound()
  }

  const entry = await getNewsEntryBySlug(slug)
  if (!entry) {
    notFound()
  }

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const publishedLabel = entry.publishedAt
    ? dateFormatter.format(new Date(entry.publishedAt))
    : "Undated"

  const contentHtml = sanitizeNewsHtml(entry.content)

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-10 px-4 pb-20 pt-12 lg:px-8">
        <header className="space-y-4">
          <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
            Newsroom
          </p>
          <div className="space-y-4">
            <h1 className="font-display text-4xl uppercase tracking-[0.3rem] text-foreground md:text-5xl">
              {entry.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.3rem] text-muted-foreground">
              <span>{publishedLabel}</span>
              {entry.author ? (
                <span className="text-foreground/70">By {entry.author}</span>
              ) : null}
            </div>
            {entry.excerpt ? (
              <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
                {entry.excerpt}
              </p>
            ) : null}
          </div>
        </header>

        <section className="space-y-8">
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-border/50 bg-muted">
            {entry.coverUrl ? (
              <Image
                src={entry.coverUrl}
                alt={`${entry.title} cover artwork`}
                fill
                sizes="(max-width: 1024px) 100vw, 900px"
                className="object-cover"
                priority
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                No image
              </div>
            )}
          </div>

          <div
            className="news-richtext text-base leading-relaxed text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />

          {entry.tags.length ? (
            <div className="flex flex-wrap gap-2 pt-4">
              {entry.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="uppercase tracking-[0.2rem]">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

export default NewsDetailPage
