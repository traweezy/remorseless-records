import { headers } from "next/headers"

import { JsonLdScript } from "@/components/json-ld-script"
import {
  requireCanonicalJsonLd,
  serializeJsonLd,
  type JsonLdData,
} from "@/lib/seo/json-ld"

export { serializeJsonLd } from "@/lib/seo/json-ld"

type JsonLdProps = {
  data: JsonLdData
  id?: string
  nonce?: string
}

const JsonLd = async ({ data, id, nonce }: JsonLdProps) => {
  const requestNonce = nonce ?? (await headers()).get("x-nonce") ?? undefined
  const serialized = requireCanonicalJsonLd(serializeJsonLd(data))

  return (
    <JsonLdScript
      serialized={serialized}
      {...(id ? { id } : {})}
      {...(requestNonce ? { nonce: requestNonce } : {})}
    >
      <script
        type="application/ld+json"
        {...(id ? { id } : {})}
        {...(requestNonce ? { nonce: requestNonce } : {})}
        dangerouslySetInnerHTML={{ __html: serialized }}
      />
    </JsonLdScript>
  )
}

export default JsonLd
