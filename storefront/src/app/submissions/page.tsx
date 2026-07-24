import type { Metadata } from "next"

import { Card } from "@/components/ui/card"
import {
  PageContentGrid,
  PageHeader,
  PageShell,
} from "@/components/ui/page-shell"

export const metadata: Metadata = {
  title: "Submissions",
  description:
    "Submit your release for consideration. Clean links, high-quality masters, and a short pitch.",
}

const SubmissionGuidelines = [
  {
    title: "Send your best",
    body: "Share two to three finished tracks (streaming links preferred), plus a short description of the project, lineup, and location. No rough demos—only release-ready material.",
  },
  {
    title: "Include the details",
    body: "Note your preferred formats (vinyl, cassette, merch), timelines, and any touring plans. If you’ve self-released before, share those links too.",
  },
  {
    title: "Keep it lean",
    body: "One email per project. Avoid file attachments over 25MB—use share links instead.",
  },
]

const SubmissionsPage = () => (
  <PageShell>
    <PageHeader
      eyebrow="Submissions"
      title="Pitch your release"
      description="We keep the catalog razor-focused. If your band is ready for a limited run with heavy packaging, send it in. We respond to every serious submission."
    />

    <PageContentGrid>
      <Card as="section" variant="panel" className="space-y-6 p-6">
        <div className="space-y-4">
          <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
            Guidelines
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {SubmissionGuidelines.map((item) => (
              <Card key={item.title} variant="inset" className="p-4">
                <p className="font-semibold uppercase tracking-[0.25rem] text-foreground">
                  {item.title}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </Card>
            ))}
          </div>
        </div>
        <Card
          variant="inset"
          className="p-4 text-sm leading-relaxed text-muted-foreground"
        >
          <p className="font-semibold text-foreground">What to include</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>
              Streaming links (Bandcamp/YouTube/Dropbox) to finished masters
            </li>
            <li>Project bio, lineup, city, and social links</li>
            <li>Format preferences and timeline</li>
            <li>Contact name and best email</li>
          </ul>
        </Card>
      </Card>

      <Card as="aside" variant="panel" className="space-y-4 p-6">
        <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
          Fast lane
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Ready to talk? Use the contact form to send your links, or email{" "}
          <a
            href="mailto:ops@remorselessrecords.com"
            className="text-destructive underline underline-offset-4"
          >
            ops@remorselessrecords.com
          </a>
          . We review submissions weekly.
        </p>
      </Card>
    </PageContentGrid>
  </PageShell>
)

export default SubmissionsPage
