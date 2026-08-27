type JsonLdProps = {
  data: Record<string, unknown> | Array<Record<string, unknown>>
  id?: string
  nonce?: string
}

export const serializeJsonLd = (data: JsonLdProps["data"]): string =>
  JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")

const JsonLd = ({ data, id, nonce }: JsonLdProps) => (
  <script
    type="application/ld+json"
    suppressHydrationWarning
    {...(id ? { id } : {})}
    {...(nonce ? { nonce } : {})}
    dangerouslySetInnerHTML={{
      __html: serializeJsonLd(data),
    }}
  />
)

export default JsonLd
