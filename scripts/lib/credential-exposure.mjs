// Historical values stay in memory. Public reports contain fixed labels and
// presence flags only; different configuration is not proof of revocation.
const ensure = (condition) => {
  if (!condition) throw new Error("Credential evidence could not be verified")
}
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const credential = (value) => {
  ensure(typeof value === "string" && value.length > 0 && value.length < 8192)
  return value
}
const password = (value, protocols) => {
  try {
    const url = new URL(credential(value))
    ensure(protocols.includes(url.protocol) && url.hostname && url.password)
    return credential(decodeURIComponent(url.password))
  } catch {
    throw new Error("Credential evidence could not be verified")
  }
}

export const EXPOSURE_SOURCE = Object.freeze({
  commit: "29157d5f49fb5edcaeb398318f2debb038e7d10f",
  path: "logs.1761315253377.json",
})

export const CREDENTIAL_SERVICES = Object.freeze(
  [
    ["Backend", "99d4fd5e-955b-416a-9078-0266bcf949d2"],
    ["Bucket", "a3fe4b80-8be8-4092-977a-54fe9dcca522"],
    ["Console", "f9aaabc0-2137-4959-9f00-1215b1b8fde0"],
    ["MeiliSearch", "f58a21ca-7144-46e3-a57a-fc708cd4fcb3"],
    ["Migrations", "129d6f7a-13f1-49d4-9828-0d02911a3326"],
    ["Postgres", "965d3ebe-2c6c-4987-b46b-ec059f9eb5ad"],
    ["RecoveryBackups", "913ddfd6-2b39-4188-bd73-6787bc80a313"],
    ["Redis", "674c9ad0-25a7-4ae2-9efe-6f15f3de20b3"],
    ["Storefront", "a6cc2c60-16db-4753-8206-b3d02187810c"],
  ].map(([name, id]) => Object.freeze({ name, id }))
)

export const verifyCredentialServices = (services) => {
  ensure(
    Array.isArray(services) && services.length === CREDENTIAL_SERVICES.length
  )
  ensure(
    new Set(services.map((service) => service?.id)).size === services.length
  )
  for (const expected of CREDENTIAL_SERVICES)
    ensure(
      services.filter((s) => s?.id === expected.id && s.name === expected.name)
        .length === 1
    )
}

export const parseExposedCredentials = (raw) => {
  try {
    ensure(typeof raw === "string" && Buffer.byteLength(raw) <= 65536)
    const rows = JSON.parse(raw)
    ensure(Array.isArray(rows) && rows.length > 0 && rows.length <= 1000)
    const configurations = []
    for (const row of rows) {
      ensure(record(row))
      if (typeof row.message !== "string") continue
      let config
      try {
        config = JSON.parse(row.message)
      } catch {
        continue
      }
      if (record(config) && Object.hasOwn(config, "projectConfig"))
        configurations.push(config)
    }
    ensure(configurations.length === 1)
    const config = configurations[0]
    const project = config.projectConfig
    ensure(
      record(project) && record(project.http) && Array.isArray(config.modules)
    )
    // Bind to the actual exposed configuration, not Railpack's names-only
    // secrets inventory elsewhere in the same JSON log.
    const providers = config.modules.flatMap(
      (module) => module?.options?.providers ?? []
    )
    const media = providers.filter(
      (p) => record(p?.options) && Object.hasOwn(p.options, "secretKey")
    )
    const email = providers.filter(
      (p) => record(p?.options) && Object.hasOwn(p.options, "api_key")
    )
    ensure(media.length === 1 && email.length === 1)
    const redis = password(project.redisUrl, ["redis:", "rediss:"])
    const moduleRedis = config.modules.filter(
      (m) => record(m?.options) && Object.hasOwn(m.options, "redisUrl")
    )
    ensure(
      moduleRedis.length === 1 &&
        password(moduleRedis[0].options.redisUrl, ["redis:", "rediss:"]) ===
          redis
    )
    return {
      postgres_password: password(project.databaseUrl, [
        "postgres:",
        "postgresql:",
      ]),
      redis_password: redis,
      admin_jwt: credential(project.http.jwtSecret),
      admin_cookie: credential(project.http.cookieSecret),
      media_password: credential(media[0].options.secretKey),
      resend_key: credential(email[0].options.api_key),
      media_identifier: credential(media[0].options.accessKey),
    }
  } catch {
    throw new Error("Credential evidence could not be verified")
  }
}

export const compareExposedCredentials = (exposed, inventories) => {
  ensure(record(exposed) && Array.isArray(inventories))
  const labels = [
    "postgres_password",
    "redis_password",
    "admin_jwt",
    "admin_cookie",
    "media_password",
    "resend_key",
    "media_identifier",
  ]
  ensure(Object.keys(exposed).length === labels.length)
  for (const label of labels) credential(exposed[label])
  verifyCredentialServices(inventories)
  const services = CREDENTIAL_SERVICES.map(({ name, id }) => {
    const variables = inventories.find((s) => s.id === id).variables
    ensure(
      record(variables) &&
        Object.keys(variables).length > 0 &&
        Object.keys(variables).length <= 250
    )
    const values = Object.values(variables).map((value) => {
      ensure(typeof value === "string" && value.length <= 65536)
      // An unresolved reference must not be reported as a retired credential.
      ensure(!value.includes("${{"))
      if (/^(?:postgres(?:ql)?|rediss?):\/\//u.test(value)) {
        try {
          const url = new URL(value)
          return url.password ? decodeURIComponent(url.password) : value
        } catch {
          throw new Error("Credential evidence could not be verified")
        }
      }
      return value
    })
    const matched = labels.filter(
      (label) => label !== "media_identifier" && values.includes(exposed[label])
    )
    return {
      name,
      exposedCredentialFamilies: matched,
      // The root username/access-key ID is an identifier, not a password.
      mediaIdentifierStillPresent: values.includes(exposed.media_identifier),
    }
  })
  return {
    configurationOnly: true,
    credentialRevocationVerified: false,
    exposedCredentialsAbsent: services.every(
      (service) => service.exposedCredentialFamilies.length === 0
    ),
    services,
  }
}
