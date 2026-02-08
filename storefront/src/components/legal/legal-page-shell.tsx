import type { ReactNode } from "react"

type LegalPageShellProps = {
  eyebrow: string
  title: string
  description: string
  effectiveDate: string
  children: ReactNode
  aside?: ReactNode
}

const LegalPageShell = ({
  eyebrow,
  title,
  description,
  effectiveDate,
  children,
  aside,
}: LegalPageShellProps) => (
  <div className="bg-background">
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 pb-16 pt-12 lg:gap-10 lg:px-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">{eyebrow}</p>
        <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">{title}</h1>
        <p className="max-w-4xl text-base leading-relaxed text-muted-foreground">{description}</p>
        <p className="text-xs uppercase tracking-[0.24rem] text-muted-foreground">
          Effective date: {effectiveDate}
        </p>
      </header>

      <div className={aside ? "grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8" : "space-y-6"}>
        <section className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
          {children}
        </section>
        {aside ? (
          <aside className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
            {aside}
          </aside>
        ) : null}
      </div>
    </div>
  </div>
)

export default LegalPageShell

