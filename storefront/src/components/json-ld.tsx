type JsonLdProps = {
  data: Record<string, unknown> | Array<Record<string, unknown>>
  id?: string
}

const JsonLd = ({ data, id }: JsonLdProps) => (
  <script
    type="application/ld+json"
    suppressHydrationWarning
    {...(id ? { id } : {})}
    dangerouslySetInnerHTML={{
      __html: JSON.stringify(data),
    }}
  />
)

export default JsonLd
