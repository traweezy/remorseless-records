const MINIMUM_SECRET_BYTES = 32
const PLACEHOLDER_PATTERN =
  /(?:change[-_ ]?me|replace|supersecret|dummy|example|test[-_ ]?secret)/iu

const REQUIRED_SECRET_NAMES = [
  "JWT_SECRET",
  "COOKIE_SECRET",
  "CHECKOUT_BFF_SECRET",
  "PUBLIC_FORM_BFF_SECRET",
] as const

const OPTIONAL_SECRET_NAMES = [
  "CHECKOUT_BFF_SECRET_PREVIOUS",
  "PUBLIC_FORM_BFF_SECRET_PREVIOUS",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_LIFECYCLE_WEBHOOK_SECRET",
  "STRIPE_LIFECYCLE_WEBHOOK_SECRET_PREVIOUS",
] as const

type RequiredSecretName = (typeof REQUIRED_SECRET_NAMES)[number]
type OptionalSecretName = (typeof OPTIONAL_SECRET_NAMES)[number]
type SecretName = RequiredSecretName | OptionalSecretName

type ValidateBackendRuntimeSecretsOptions = {
  environment?: NodeJS.ProcessEnv
  isProduction: boolean
}
const normalizeSecret = (value: string | undefined): string =>
  value?.trim() ?? ""

const assertStrongSecret = (name: SecretName, value: string): void => {
  if (Buffer.byteLength(value, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new Error(
      `${name} must contain at least ${MINIMUM_SECRET_BYTES} UTF-8 bytes`
    )
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${name} must not contain a placeholder value`)
  }
}

export const validateBackendRuntimeSecrets = ({
  environment = process.env,
  isProduction,
}: ValidateBackendRuntimeSecretsOptions): void => {
  if (!isProduction) {
    return
  }

  const secrets = new Map<SecretName, string>()
  for (const name of REQUIRED_SECRET_NAMES) {
    const value = normalizeSecret(environment[name])
    assertStrongSecret(name, value)
    secrets.set(name, value)
  }
  for (const name of OPTIONAL_SECRET_NAMES) {
    const value = normalizeSecret(environment[name])
    if (!value) {
      continue
    }
    assertStrongSecret(name, value)
    secrets.set(name, value)
  }

  const entries = Array.from(secrets.entries())
  for (const [index, [name, value]] of entries.entries()) {
    for (const [otherName, otherValue] of entries.slice(index + 1)) {
      if (value === otherValue) {
        throw new Error(`${name} and ${otherName} must use distinct values`)
      }
    }
  }
}
