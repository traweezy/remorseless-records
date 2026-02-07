import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import type NewsModuleService from "@/modules/news/service"

type NewsService = InstanceType<typeof NewsModuleService>

type NewsSeedInput = {
  title: string
  slug: string
  excerpt: string
  content: string
  author: string
  tags: string[]
  cover_url: string
  seo_title: string
  seo_description: string
}

type NewsSeedPayload = {
  title: string
  slug: string
  excerpt: string
  content: string
  author: string
  status: "published"
  published_at: Date
  tags: string[]
  cover_url: string
  seo_title: string
  seo_description: string
}

const seedEntries: NewsSeedInput[] = [
  {
    title: "Catacombs of Spring: Preorders Open",
    slug: "catacombs-of-spring-preorders",
    excerpt:
      "Limited vinyl runs for the spring drops are live now. Secure your copy before the presses cool.",
    content:
      "The spring schedule is locked and the presses are in motion. Expect heavy, saturated mixes and limited colorways.\n\nPreorders are now open with first-come allocations. When these are gone, they are gone. Keep an eye on your inbox for shipping updates and tracking once fulfillment begins.",
    author: "Remorseless Records",
    tags: ["Release", "Vinyl", "Announcement"],
    cover_url:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1600&q=80",
    seo_title: "Catacombs of Spring Preorders · Remorseless Records",
    seo_description:
      "Preorders are open for the spring vinyl run. Secure limited colorways and first-press allocations.",
  },
  {
    title: "Studio Report: Signal in the Noise",
    slug: "studio-report-signal-in-the-noise",
    excerpt:
      "A quick dispatch from the studio—new mixes, new masters, and what to expect next.",
    content:
      "We spent the last two weeks chasing clarity in the low end. The result is a master that hits harder without losing definition.\n\nNext up: lacquer tests and artwork finals. If you want the behind-the-scenes photos, follow the newsletter for the next drop.",
    author: "A. Graves",
    tags: ["Studio", "Update"],
    cover_url:
      "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1600&q=80",
    seo_title: "Studio Report · Remorseless Records",
    seo_description:
      "We’re finishing new masters and lacquer tests—here’s what to expect next.",
  },
  {
    title: "Tour Diary: The Northern Circuit",
    slug: "tour-diary-northern-circuit",
    excerpt:
      "From packed basements to frozen loading docks, here’s the last run in numbers.",
    content:
      "Seven cities. Zero sleep. The northern circuit closed with a sold-out stop and a gear case full of scars.\n\nThank you to every room that welcomed the noise. We’re compiling a full photo set for the archive.",
    author: "Remorseless Records",
    tags: ["Tour", "Live"],
    cover_url:
      "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1600&q=80",
    seo_title: "Tour Diary · Remorseless Records",
    seo_description:
      "Seven cities. One tour. Here’s the final recap from the northern circuit.",
  },
  {
    title: "Merch Drop: Ritual Textiles",
    slug: "merch-drop-ritual-textiles",
    excerpt:
      "New tees and long sleeves designed for the cold months—limited quantities.",
    content:
      "We kept it clean and brutal. Heavyweight blanks, muted inks, and a fit that survives the pit.\n\nQuantities are limited. Restocks are not guaranteed.",
    author: "Remorseless Records",
    tags: ["Merch", "Drop"],
    cover_url:
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1600&q=80",
    seo_title: "Merch Drop · Remorseless Records",
    seo_description:
      "Limited ritual textiles are live—heavyweight tees and long sleeves for the cold months.",
  },
  {
    title: "Archive: Pressing Notes from 2017",
    slug: "archive-pressing-notes-2017",
    excerpt:
      "A look back at the plates, the process, and the press runs that started it all.",
    content:
      "We pulled old notes from the first run—test press flaws, sleeve paper calls, and the mix decisions that became the signature.\n\nSome lessons never fade: trust the low end, respect the medium, and always check side B.",
    author: "Remorseless Records",
    tags: ["Archive", "Pressing"],
    cover_url:
      "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1600&q=80",
    seo_title: "Archive Notes · Remorseless Records",
    seo_description:
      "Pressing notes from the early days—what we learned and what still matters.",
  },
  {
    title: "Label Notes: 2026 Roadmap",
    slug: "label-notes-2026-roadmap",
    excerpt:
      "The next twelve months: new signings, reissues, and the roadmap ahead.",
    content:
      "We’re expanding the roster with two new signings and revisiting a few catalog staples for reissues.\n\nExpect a steady cadence of drops and a focus on physical formats. The roadmap is aggressive and the catalog will grow.",
    author: "Remorseless Records",
    tags: ["Roadmap", "Label"],
    cover_url:
      "https://images.unsplash.com/photo-1507874457470-272b3c8d8ee2?auto=format&fit=crop&w=1600&q=80",
    seo_title: "2026 Roadmap · Remorseless Records",
    seo_description:
      "New signings, reissues, and a roadmap for the next twelve months.",
  },
]

export default async function seedNewsScript({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const newsService = container.resolve("news") as NewsService

  const [, count] = await newsService.listAndCountNewsEntries({}, { take: 1 })

  if (count > 0) {
    logger.info(`[news] Seed skipped; ${count} entries already exist.`)
    return
  }

  const now = Date.now()
  const payload: NewsSeedPayload[] = seedEntries.map((entry, index) => ({
    title: entry.title,
    slug: entry.slug,
    excerpt: entry.excerpt,
    content: entry.content,
    author: entry.author,
    status: "published",
    published_at: new Date(now - index * 86400000),
    tags: entry.tags,
    cover_url: entry.cover_url,
    seo_title: entry.seo_title,
    seo_description: entry.seo_description,
  }))

  await newsService.createNewsEntries(payload)
  logger.info(`[news] Seeded ${payload.length} entries.`)
}
