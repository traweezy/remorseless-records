import type { ReactNode } from "react"

import { Card } from "@/components/ui/card"
import {
  PageContentGrid,
  PageHeader,
  PageShell,
} from "@/components/ui/page-shell"

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
  <PageShell>
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      descriptionClassName="max-w-4xl"
      meta={
        <p className="text-xs uppercase tracking-[0.24rem] text-muted-foreground">
          Effective date: {effectiveDate}
        </p>
      }
    />

    <PageContentGrid className={aside ? undefined : "block"}>
      <Card as="section" variant="panel" className="space-y-4 p-6">
        {children}
      </Card>
      {aside ? (
        <Card
          as="aside"
          variant="panel"
          aria-label={`${title} supporting information`}
          className="space-y-4 p-6"
        >
          {aside}
        </Card>
      ) : null}
    </PageContentGrid>
  </PageShell>
)

export default LegalPageShell
