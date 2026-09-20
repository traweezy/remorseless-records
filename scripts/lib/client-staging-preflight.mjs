export const OWNER_PROJECT_ID = "1f39263a-25e4-4d69-abc2-f0287b331d1e"
export const OWNER_ENVIRONMENT_ID = "799a2f98-f819-495d-b8b6-12e71af86568"
export const SERVICE_NAMES = [
  "Backend",
  "Storefront",
  "Postgres",
  "Redis",
  "Bucket",
  "Console",
  "MeiliSearch",
]

export const QUERY = `query ClientStagingPreflight($projectId: String!, $environmentId: String!, $after: String) {
  sourceProject: project(id: "${OWNER_PROJECT_ID}") { id workspaceId }
  targetProject: project(id: $projectId) { id name workspaceId }
  targetEnvironment: environment(id: $environmentId, projectId: $projectId) {
    id name projectId configEtag
    sourceEnvironment { id }
    serviceInstances(first: 8) {
      edges { node { serviceId serviceName environmentId hasEverDeployed activeDeployments { id } } }
      pageInfo { hasNextPage }
    }
    deploymentTriggers(first: 1) {
      edges { node { id environmentId serviceId } }
      pageInfo { hasNextPage }
    }
    variables(first: 100, after: $after) {
      edges { node { name isSealed serviceId references } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const VARIABLE_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const exactKeys = (value, expected) =>
  isRecord(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key))
const unique = (values) => new Set(values).size === values.length
const isUuid = (value) => typeof value === "string" && UUID.test(value)
const validReviewTime = (value, now) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    return false
  }
  const date = new Date(value)
  return (
    !Number.isNaN(date.valueOf()) &&
    date.toISOString() === value &&
    date.valueOf() <= now.valueOf() &&
    now.valueOf() - date.valueOf() <= 24 * 60 * 60 * 1000
  )
}
const validReviewer = (value) =>
  typeof value === "string" && /^[A-Za-z0-9._@-]{3,80}$/u.test(value)
const equalNames = (left, right) =>
  left.length === right.length && left.every((name) => right.includes(name))

export const validateManifest = (value, now = new Date()) => {
  if (
    !exactKeys(value, ["schemaVersion", "target", "provenance", "inventory"])
  ) {
    return "Manifest must contain only schemaVersion, target, provenance, and inventory"
  }
  if (value.schemaVersion !== 2) return "Unsupported manifest schema version"
  if (
    !exactKeys(value.target, ["projectId", "environmentId", "workspaceId"]) ||
    !Object.values(value.target).every(isUuid)
  ) {
    return "Target must contain three valid Railway UUIDs"
  }
  if (
    value.target.projectId === OWNER_PROJECT_ID ||
    value.target.environmentId === OWNER_ENVIRONMENT_ID
  ) {
    return "Owner Railway project and environment cannot be a client target"
  }
  if (
    !exactKeys(value.provenance, [
      "reviewedAt",
      "reviewer",
      "creationEventId",
      "creationMode",
      "noSyncSinceCreation",
    ]) ||
    !validReviewTime(value.provenance.reviewedAt, now) ||
    !validReviewer(value.provenance.reviewer) ||
    typeof value.provenance.creationEventId !== "string" ||
    !/^[A-Za-z0-9._:-]{8,128}$/u.test(value.provenance.creationEventId) ||
    value.provenance.creationMode !== "empty" ||
    value.provenance.noSyncSinceCreation !== true
  ) {
    return "Recent names-only empty-create and no-sync audit attestation is required"
  }
  if (!exactKeys(value.inventory, ["reviewedAt", "reviewer", "services"])) {
    return "Inventory must contain only reviewedAt, reviewer, and services"
  }
  if (!validReviewTime(value.inventory.reviewedAt, now)) {
    return "Inventory review must be a valid UTC time within the last 24 hours"
  }
  if (!validReviewer(value.inventory.reviewer)) {
    return "Inventory reviewer must be a short nonempty identifier"
  }
  if (
    !Array.isArray(value.inventory.services) ||
    value.inventory.services.length !== SERVICE_NAMES.length
  ) {
    return "Inventory must describe exactly seven services"
  }
  const names = value.inventory.services.map((service) => service?.name)
  if (!unique(names) || SERVICE_NAMES.some((name) => !names.includes(name))) {
    return "Inventory service names do not match the required topology"
  }
  for (const service of value.inventory.services) {
    if (
      !exactKeys(service, [
        "name",
        "variableNames",
        "sealedVariableNames",
        "references",
      ]) ||
      !Array.isArray(service.variableNames) ||
      !Array.isArray(service.sealedVariableNames) ||
      !Array.isArray(service.references) ||
      service.variableNames.length === 0 ||
      !service.variableNames.every(
        (name) => typeof name === "string" && VARIABLE_NAME.test(name)
      ) ||
      !service.sealedVariableNames.every(
        (name) => typeof name === "string" && VARIABLE_NAME.test(name)
      ) ||
      !unique(service.variableNames) ||
      !unique(service.sealedVariableNames) ||
      service.sealedVariableNames.some(
        (name) => !service.variableNames.includes(name)
      ) ||
      service.references.some(
        (reference) =>
          !exactKeys(reference, ["variableName", "targetService"]) ||
          !service.variableNames.includes(reference.variableName) ||
          !SERVICE_NAMES.includes(reference.targetService)
      ) ||
      !unique(service.references.map((reference) => reference.variableName))
    ) {
      return "Each service needs unique variable names and sealed-name subsets only"
    }
  }
  return null
}

const requiredSealedVariables = {
  Backend: [
    "DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "COOKIE_SECRET",
    "CHECKOUT_BFF_SECRET",
    "PUBLIC_FORM_BFF_SECRET",
    "STRIPE_API_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_LIFECYCLE_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "TAX_RATE_LOOKUP_API_KEY",
    "MINIO_ACCESS_KEY",
    "MINIO_SECRET_KEY",
    "MEILISEARCH_ADMIN_KEY",
    "MEILISEARCH_MASTER_KEY",
  ],
  Storefront: [
    "CART_COOKIE_SECRET",
    "CHECKOUT_BFF_SECRET",
    "CHECKOUT_RECEIPT_SECRET",
    "PUBLIC_FORM_BFF_SECRET",
    "MEILISEARCH_API_KEY",
  ],
}

const requiredNames = {
  Backend: ["MEDUSA_PUBLISHABLE_KEY"],
  Storefront: ["NEXT_PUBLIC_STRIPE_PK", "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY"],
}

const requiredReferences = {
  Backend: {
    DATABASE_URL: "Postgres",
    REDIS_URL: "Redis",
    MINIO_ENDPOINT: "Bucket",
    MEILISEARCH_HOST: "MeiliSearch",
  },
  Storefront: {
    MEDUSA_BACKEND_URL: "Backend",
    MEILISEARCH_HOST: "Backend",
    REDIS_URL: "Redis",
  },
}

export const evaluatePreflight = (manifest, response, now = new Date()) => {
  const problems = []
  const manifestProblem = validateManifest(manifest, now)
  if (manifestProblem) return { passed: false, problems: [manifestProblem] }
  if (response?.errors) {
    return {
      passed: false,
      problems: ["Railway metadata query returned errors"],
    }
  }

  const data = response?.data
  const source = data?.sourceProject
  const project = data?.targetProject
  const environment = data?.targetEnvironment
  if (
    !isRecord(source) ||
    source.id !== OWNER_PROJECT_ID ||
    !isUuid(source.workspaceId)
  ) {
    problems.push("Owner project metadata is unavailable or inconsistent")
  }
  if (
    !isRecord(project) ||
    project.id !== manifest.target.projectId ||
    project.workspaceId !== manifest.target.workspaceId
  ) {
    problems.push(
      "Client project or workspace identity does not match the manifest"
    )
  }
  if (
    isUuid(source?.workspaceId) &&
    project?.workspaceId === source.workspaceId
  ) {
    problems.push("Client project must be in a separate Railway workspace")
  }
  if (
    !isRecord(environment) ||
    environment.id !== manifest.target.environmentId ||
    environment.projectId !== manifest.target.projectId ||
    environment.name !== "client-staging"
  ) {
    problems.push("Client environment identity or name does not match")
  }
  if (environment?.sourceEnvironment !== null) {
    problems.push("Client environment exposes a source-environment link")
  }

  const instances = environment?.serviceInstances
  const serviceEdges = instances?.edges
  if (
    !Array.isArray(serviceEdges) ||
    instances?.pageInfo?.hasNextPage !== false ||
    serviceEdges.length !== SERVICE_NAMES.length ||
    !unique(serviceEdges.map((edge) => edge?.node?.serviceName)) ||
    !unique(serviceEdges.map((edge) => edge?.node?.serviceId)) ||
    SERVICE_NAMES.some(
      (name) =>
        !serviceEdges.some(
          (edge) =>
            edge?.node?.serviceName === name &&
            isUuid(edge?.node?.serviceId) &&
            edge.node.environmentId === manifest.target.environmentId
        )
    )
  ) {
    problems.push(
      "Client service topology is incomplete, duplicated, or truncated"
    )
  }

  if (typeof environment?.configEtag !== "string" || !environment.configEtag) {
    problems.push("Client configuration revision is unavailable")
  }
  if (Array.isArray(serviceEdges)) {
    for (const appName of ["Backend", "Storefront"]) {
      const app = serviceEdges.find(
        (edge) => edge?.node?.serviceName === appName
      )?.node
      if (
        app?.hasEverDeployed !== false ||
        !Array.isArray(app?.activeDeployments) ||
        app.activeDeployments.length !== 0
      ) {
        problems.push(`${appName} must never have deployed before preflight`)
      }
    }
  }

  const triggers = environment?.deploymentTriggers
  if (
    !Array.isArray(triggers?.edges) ||
    triggers.pageInfo?.hasNextPage !== false ||
    triggers.edges.length !== 0
  ) {
    problems.push(
      "Client environment must have no automatic deployment triggers"
    )
  }

  const variableConnection = environment?.variables
  const variableEdges = variableConnection?.edges
  const serviceIds = new Map(
    Array.isArray(serviceEdges)
      ? serviceEdges.map((edge) => [
          edge?.node?.serviceId,
          edge?.node?.serviceName,
        ])
      : []
  )
  const liveVariables = new Map(SERVICE_NAMES.map((name) => [name, []]))
  let variablesValid =
    Array.isArray(variableEdges) &&
    variableConnection?.pageInfo?.hasNextPage === false &&
    variableEdges.length <= 1600
  if (variablesValid) {
    for (const edge of variableEdges) {
      const variable = edge?.node
      const serviceName = serviceIds.get(variable?.serviceId)
      if (
        !SERVICE_NAMES.includes(serviceName) ||
        typeof variable?.name !== "string" ||
        !VARIABLE_NAME.test(variable.name) ||
        typeof variable.isSealed !== "boolean" ||
        !Array.isArray(variable.references) ||
        !variable.references.every(
          (reference) => typeof reference === "string"
        ) ||
        liveVariables
          .get(serviceName)
          .some((entry) => entry.name === variable.name)
      ) {
        variablesValid = false
        break
      }
      liveVariables.get(serviceName).push(variable)
    }
  }
  if (!variablesValid) {
    problems.push("Client variable metadata is incomplete or inconsistent")
  } else {
    for (const service of manifest.inventory.services) {
      const live = liveVariables.get(service.name)
      if (
        !equalNames(
          service.variableNames,
          live.map((variable) => variable.name)
        ) ||
        !equalNames(
          service.sealedVariableNames,
          live
            .filter((variable) => variable.isSealed)
            .map((variable) => variable.name)
        )
      ) {
        problems.push(
          `${service.name} live variable names or sealing differ from inventory`
        )
      }
    }
  }

  for (const [serviceName, required] of Object.entries(
    requiredSealedVariables
  )) {
    const inventory = manifest.inventory.services.find(
      (service) => service.name === serviceName
    )
    if (
      required.some((name) => !inventory.sealedVariableNames.includes(name))
    ) {
      problems.push(
        `${serviceName} reviewed inventory lacks required sealed names`
      )
    }
  }
  for (const [serviceName, required] of Object.entries(requiredNames)) {
    const inventory = manifest.inventory.services.find(
      (service) => service.name === serviceName
    )
    if (required.some((name) => !inventory.variableNames.includes(name))) {
      problems.push(
        `${serviceName} reviewed inventory lacks required variable names`
      )
    }
  }
  for (const [serviceName, required] of Object.entries(requiredReferences)) {
    const inventory = manifest.inventory.services.find(
      (service) => service.name === serviceName
    )
    if (
      Object.entries(required).some(
        ([variableName, targetService]) =>
          !inventory.references.some(
            (reference) =>
              reference.variableName === variableName &&
              reference.targetService === targetService
          )
      )
    ) {
      problems.push(
        `${serviceName} reviewed inventory lacks required client references`
      )
    }
  }
  if (
    manifest.inventory.services.some(
      (service) => service.sealedVariableNames.length === 0
    )
  ) {
    problems.push(
      "Every service requires at least one reviewed sealed credential"
    )
  }

  return { passed: problems.length === 0, problems }
}
