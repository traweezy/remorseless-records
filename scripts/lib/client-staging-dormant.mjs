import { OWNER_PROJECT_ID, SERVICE_NAMES } from "./client-staging-preflight.mjs"

export const CLIENT_PROJECT_ID = "42d7b49a-3379-4a99-8464-02f678fb7936"
export const CLIENT_ENVIRONMENT_ID = "0618f901-5c15-4c3c-9f49-b17d2113adee"
export const CLIENT_WORKSPACE_ID = "54d68ca0-e718-42e7-977d-7075facc36e5"
export const CLIENT_SERVICES = {
  Backend: "95b004bc-4eb2-453c-a85f-80b8af0d72e5",
  Storefront: "33329bdc-3555-4bc0-9cf3-5983b05660a3",
  Postgres: "c0b5021a-2e7a-4d4c-898f-80022d634690",
  Redis: "bd8ef8dc-01a9-491d-b3ee-b2ea647dd6f7",
  Bucket: "d485920d-0966-4b6e-9587-bb3e3b0094f9",
  Console: "6b92eb39-c73a-4108-9068-6c52b6f0cff0",
  MeiliSearch: "ef1e488c-b13c-4ed2-b814-5743f95dad16",
}
export const CREATION_EVENT_ID = "8fa8d949-9095-4da7-a53d-985c77d5d5fd"

export const QUERY = `query ClientStagingDormant($projectId: String!, $environmentId: String!) {
  sourceProject: project(id: "${OWNER_PROJECT_ID}") { id workspaceId }
  targetProject: project(id: $projectId) {
    id name workspaceId isPublic prDeploys
    environments(first: 10) {
      edges { node {
        id name
        deployments(first: 1) { edges { node { id } } pageInfo { hasNextPage } }
        serviceInstances(first: 20) {
          edges { node { id serviceId hasEverDeployed activeDeployments { id } latestDeployment { id } } }
          pageInfo { hasNextPage }
        }
      } }
      pageInfo { hasNextPage }
    }
    services(first: 20) {
      edges { node {
        id name
        repoTriggers(first: 1) { edges { node { id } } pageInfo { hasNextPage } }
      } }
      pageInfo { hasNextPage }
    }
  }
  targetEnvironment: environment(id: $environmentId, projectId: $projectId) {
    id name projectId
    sourceEnvironment { id }
    deploymentTriggers(first: 1) { edges { node { id } } pageInfo { hasNextPage } }
    variables(first: 1) { edges { node { name } } pageInfo { hasNextPage } }
    volumeInstances(first: 1) { edges { node { id } } pageInfo { hasNextPage } }
    serviceInstances(first: 8) {
      edges { node {
        serviceName serviceId hasEverDeployed activeDeployments { id } latestDeployment { id }
        source { repo image }
        domains { customDomains { id } serviceDomains { id } }
      } }
      pageInfo { hasNextPage }
    }
  }
  auditLogs(workspaceId: "${CLIENT_WORKSPACE_ID}", filter: { projectId: $projectId }, first: 100) {
    edges { node { id createdAt eventType projectId environmentId } }
    pageInfo { hasNextPage }
  }
}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const isUuid = (value) => typeof value === "string" && UUID.test(value)
const nodes = (connection) =>
  Array.isArray(connection?.edges) &&
  connection?.pageInfo?.hasNextPage === false
    ? connection.edges.map((edge) => edge?.node)
    : null
const isEmpty = (connection) => {
  const entries = nodes(connection)
  return entries !== null && entries.length === 0
}
const unique = (values) => new Set(values).size === values.length
const sameSet = (actual, expected) =>
  actual.length === expected.length &&
  expected.every((item) => actual.includes(item))
const neverDeployed = (instance) =>
  instance?.hasEverDeployed === false &&
  instance.latestDeployment === null &&
  Array.isArray(instance.activeDeployments) &&
  instance.activeDeployments.length === 0

export const evaluateDormant = (response) => {
  if (response?.errors) {
    return {
      passed: false,
      problems: ["Railway metadata query returned errors"],
    }
  }

  const problems = []
  const {
    sourceProject: source,
    targetProject: project,
    targetEnvironment: environment,
  } = response?.data ?? {}

  if (
    source?.id !== OWNER_PROJECT_ID ||
    !isUuid(source?.workspaceId) ||
    source.workspaceId === CLIENT_WORKSPACE_ID
  ) {
    problems.push("Owner and client must have distinct, verified workspaces")
  }
  if (
    project?.id !== CLIENT_PROJECT_ID ||
    project.workspaceId !== CLIENT_WORKSPACE_ID ||
    project.isPublic !== false ||
    project.prDeploys !== false
  ) {
    problems.push(
      "Client project identity, privacy, or PR deployment policy changed"
    )
  }
  if (
    environment?.id !== CLIENT_ENVIRONMENT_ID ||
    environment.name !== "client-staging" ||
    environment.projectId !== CLIENT_PROJECT_ID ||
    environment.sourceEnvironment !== null
  ) {
    problems.push("Client environment identity or empty-source state changed")
  }

  const projectServices = nodes(project?.services)
  const serviceIds = projectServices?.map((service) => service?.id) ?? []
  if (
    projectServices === null ||
    !sameSet(
      projectServices.map((service) => service?.name),
      SERVICE_NAMES
    ) ||
    projectServices.some(
      (service) => CLIENT_SERVICES[service?.name] !== service?.id
    ) ||
    !serviceIds.every(isUuid) ||
    !unique(serviceIds)
  ) {
    problems.push(
      "Client project no longer has exactly seven expected services"
    )
  }
  if (
    projectServices === null ||
    projectServices.some((service) => !isEmpty(service?.repoTriggers))
  ) {
    problems.push(
      "A service repository deployment trigger exists or is unverified"
    )
  }

  const environments = nodes(project?.environments)
  const projectEnvironment = environments?.[0]
  if (
    environments?.length !== 1 ||
    projectEnvironment?.id !== CLIENT_ENVIRONMENT_ID ||
    projectEnvironment.name !== "client-staging"
  ) {
    problems.push("Client project environment list changed or is incomplete")
  }
  if (!isEmpty(projectEnvironment?.deployments)) {
    problems.push(
      "Client project has deployment history or incomplete history metadata"
    )
  }

  const projectInstances = nodes(projectEnvironment?.serviceInstances)
  if (
    projectInstances === null ||
    !sameSet(
      projectInstances.map((instance) => instance?.serviceId),
      serviceIds
    ) ||
    !unique(projectInstances.map((instance) => instance?.id)) ||
    !projectInstances.every(
      (instance) => isUuid(instance?.id) && neverDeployed(instance)
    )
  ) {
    problems.push(
      "A project service instance has deployed or its metadata is incomplete"
    )
  }

  const instances = nodes(environment?.serviceInstances)
  if (
    instances === null ||
    !sameSet(
      instances.map((instance) => instance?.serviceName),
      SERVICE_NAMES
    ) ||
    instances.some(
      (instance) =>
        CLIENT_SERVICES[instance?.serviceName] !== instance?.serviceId
    ) ||
    !sameSet(
      instances.map((instance) => instance?.serviceId),
      serviceIds
    ) ||
    !unique(instances.map((instance) => instance?.serviceId))
  ) {
    problems.push(
      "Client environment service topology changed or is incomplete"
    )
  }
  if (
    instances === null ||
    instances.some(
      (instance) =>
        !neverDeployed(instance) ||
        instance.source !== null ||
        !Array.isArray(instance.domains?.customDomains) ||
        instance.domains.customDomains.length !== 0 ||
        !Array.isArray(instance.domains.serviceDomains) ||
        instance.domains.serviceDomains.length !== 0
    )
  ) {
    problems.push("A client service has a source, deployment, or domain")
  }

  for (const [label, connection] of [
    ["automatic deployment triggers", environment?.deploymentTriggers],
    ["variables", environment?.variables],
    ["volumes", environment?.volumeInstances],
  ]) {
    if (!isEmpty(connection)) {
      problems.push(`Client environment has ${label} or incomplete metadata`)
    }
  }

  const events = nodes(response?.data?.auditLogs)
  const creation = events?.find((event) => event?.id === CREATION_EVENT_ID)
  const validEvent = (event) =>
    isUuid(event?.id) &&
    event.projectId === CLIENT_PROJECT_ID &&
    typeof event.createdAt === "string" &&
    !Number.isNaN(Date.parse(event.createdAt))
  if (
    events?.length !== 9 ||
    !unique(events.map((event) => event?.id)) ||
    !events.every(validEvent) ||
    events.filter((event) => event.eventType === "Project.created").length !==
      1 ||
    events.filter((event) => event.eventType === "Environment.created")
      .length !== 1 ||
    events.filter((event) => event.eventType === "Service.added").length !==
      7 ||
    creation?.eventType !== "Environment.created" ||
    creation.environmentId !== CLIENT_ENVIRONMENT_ID ||
    events.some(
      (event) =>
        event.eventType === "Service.added" &&
        (event.environmentId !== null ||
          Date.parse(event.createdAt) < Date.parse(creation?.createdAt))
    )
  ) {
    problems.push("Client creation audit history changed or is incomplete")
  }

  return { passed: problems.length === 0, problems }
}
