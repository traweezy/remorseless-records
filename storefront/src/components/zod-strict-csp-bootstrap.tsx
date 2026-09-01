type ZodStrictCspBootstrapProps = {
  readonly nonce?: string
}

export const ZOD_STRICT_CSP_BOOTSTRAP =
  "globalThis.__zod_globalConfig=Object.assign(globalThis.__zod_globalConfig??{},{jitless:true})"

const ZodStrictCspBootstrap = ({ nonce }: ZodStrictCspBootstrapProps) => (
  <script
    id="zod-strict-csp-bootstrap"
    suppressHydrationWarning
    {...(nonce ? { nonce } : {})}
    dangerouslySetInnerHTML={{ __html: ZOD_STRICT_CSP_BOOTSTRAP }}
  />
)

export default ZodStrictCspBootstrap
