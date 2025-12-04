import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Submissions",
  description: "Submit your release for consideration. Clean links, high-quality masters, and a short pitch.",
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
  <div className="bg-background">
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 pb-16 pt-12 lg:px-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
          Submissions
        </p>
        <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
          Pitch your release
        </h1>
        <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
          We keep the catalog razor-focused. If your band is ready for a limited run with heavy packaging, send it in. We respond to every serious submission.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <section className="space-y-6 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
          <div className="space-y-4">
            <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
              Guidelines
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {SubmissionGuidelines.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-border/60 bg-background/80 p-4"
                >
                  <p className="font-semibold uppercase tracking-[0.25rem] text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">What to include</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>Streaming links (Bandcamp/YouTube/Dropbox) to finished masters</li>
              <li>Project bio, lineup, city, and social links</li>
              <li>Format preferences and timeline</li>
              <li>Contact name and best email</li>
            </ul>
          </div>
        </section>

        <aside className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
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
        </aside>
      </div>
    </div>
  </div>
)

export default SubmissionsPage
