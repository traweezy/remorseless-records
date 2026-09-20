import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import {
  parseArguments,
  queryRailway,
  runDormant,
} from "./client-staging-dormant-preflight.mjs"
import {
  CLIENT_ENVIRONMENT_ID,
  CLIENT_PROJECT_ID,
  CLIENT_SERVICES,
  CLIENT_WORKSPACE_ID,
  CREATION_EVENT_ID,
  evaluateDormant,
  QUERY,
} from "./lib/client-staging-dormant.mjs"
import {
  OWNER_PROJECT_ID,
  SERVICE_NAMES,
} from "./lib/client-staging-preflight.mjs"

const OWNER_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
const serviceId = (index) => CLIENT_SERVICES[SERVICE_NAMES[index]]
const instanceId = (index) => `66666666-6666-4666-8666-66666666666${index}`
const emptyConnection = () => ({ edges: [], pageInfo: { hasNextPage: false } })

const response = () => ({
  data: {
    sourceProject: { id: OWNER_PROJECT_ID, workspaceId: OWNER_WORKSPACE_ID },
    targetProject: {
      id: CLIENT_PROJECT_ID,
      name: "store-client-staging",
      workspaceId: CLIENT_WORKSPACE_ID,
      isPublic: false,
      prDeploys: false,
      environments: {
        edges: [
          {
            node: {
              id: CLIENT_ENVIRONMENT_ID,
              name: "client-staging",
              deployments: emptyConnection(),
              serviceInstances: {
                edges: SERVICE_NAMES.map((_, index) => ({
                  node: {
                    id: instanceId(index),
                    serviceId: serviceId(index),
                    hasEverDeployed: false,
                    activeDeployments: [],
                    latestDeployment: null,
                  },
                })),
                pageInfo: { hasNextPage: false },
              },
            },
          },
        ],
        pageInfo: { hasNextPage: false },
      },
      services: {
        edges: SERVICE_NAMES.map((name, index) => ({
          node: {
            id: serviceId(index),
            name,
            repoTriggers: emptyConnection(),
          },
        })),
        pageInfo: { hasNextPage: false },
      },
    },
    targetEnvironment: {
      id: CLIENT_ENVIRONMENT_ID,
      name: "client-staging",
      projectId: CLIENT_PROJECT_ID,
      sourceEnvironment: null,
      deploymentTriggers: emptyConnection(),
      variables: emptyConnection(),
      volumeInstances: emptyConnection(),
      serviceInstances: {
        edges: SERVICE_NAMES.map((serviceName, index) => ({
          node: {
            serviceName,
            serviceId: serviceId(index),
            hasEverDeployed: false,
            activeDeployments: [],
            latestDeployment: null,
            source: null,
            domains: { customDomains: [], serviceDomains: [] },
          },
        })),
        pageInfo: { hasNextPage: false },
      },
    },
    auditLogs: {
      edges: [
        {
          node: {
            id: "0ac43319-1987-463f-b685-f774baa3ed84",
            createdAt: "2026-09-20T21:56:15.033Z",
            eventType: "Project.created",
            projectId: CLIENT_PROJECT_ID,
            environmentId: null,
          },
        },
        {
          node: {
            id: CREATION_EVENT_ID,
            createdAt: "2026-09-20T21:56:15.401Z",
            eventType: "Environment.created",
            projectId: CLIENT_PROJECT_ID,
            environmentId: CLIENT_ENVIRONMENT_ID,
          },
        },
        ...SERVICE_NAMES.map((_, index) => ({
          node: {
            id: `77777777-7777-4777-8777-77777777777${index}`,
            createdAt: "2026-09-20T21:56:30.000Z",
            eventType: "Service.added",
            projectId: CLIENT_PROJECT_ID,
            environmentId: null,
          },
        })),
      ],
      pageInfo: { hasNextPage: false },
    },
  },
})

const failsWith = (change, expected) => {
  const input = response()
  change(input)
  const result = evaluateDormant(input)
  assert.equal(result.passed, false)
  assert.match(result.problems.join(" "), expected)
}

test("dormant metadata query requests no values, configs, or deployment payloads", () => {
  assert.match(QUERY, /variables\(first: 1\)/u)
  assert.match(QUERY, /repoTriggers\(first: 1\)/u)
  assert.match(QUERY, /deployments\(first: 1\)/u)
  assert.match(QUERY, /auditLogs\(workspaceId:/u)
  assert.doesNotMatch(
    QUERY,
    /\bvalue\b|decryptVariables|config\s*\{|deployment\s*\{/u
  )
  assert.deepEqual(evaluateDormant(response()), { passed: true, problems: [] })
})

test("identity and activation policy drift fail closed", () => {
  failsWith((input) => {
    input.data.sourceProject.workspaceId = CLIENT_WORKSPACE_ID
  }, /distinct, verified workspaces/u)
  failsWith((input) => {
    input.data.targetProject.workspaceId = OWNER_WORKSPACE_ID
  }, /identity, privacy, or PR deployment/u)
  failsWith((input) => {
    input.data.targetProject.isPublic = true
  }, /identity, privacy, or PR deployment/u)
  failsWith((input) => {
    input.data.targetProject.prDeploys = true
  }, /identity, privacy, or PR deployment/u)
  failsWith((input) => {
    input.data.targetEnvironment.sourceEnvironment = {
      id: "77777777-7777-4777-8777-777777777777",
    }
  }, /empty-source state/u)
})

test("service changes, source links, and repository triggers fail closed", () => {
  failsWith((input) => {
    input.data.targetProject.services.edges.pop()
  }, /exactly seven expected services/u)
  failsWith((input) => {
    input.data.targetProject.services.edges[0].node.id =
      "88888888-8888-4888-8888-888888888888"
  }, /exactly seven expected services/u)
  failsWith((input) => {
    input.data.targetProject.services.pageInfo.hasNextPage = true
  }, /exactly seven expected services/u)
  failsWith((input) => {
    input.data.targetProject.services.edges[0].node.repoTriggers.edges.push({
      node: { id: "synthetic-trigger" },
    })
  }, /repository deployment trigger/u)
  failsWith((input) => {
    input.data.targetEnvironment.serviceInstances.edges[0].node.source = {
      repo: "synthetic/repo",
      image: null,
    }
  }, /source, deployment, or domain/u)
  failsWith((input) => {
    input.data.targetEnvironment.serviceInstances.edges[0].node.domains.serviceDomains.push(
      {
        id: "synthetic-domain",
      }
    )
  }, /source, deployment, or domain/u)
  failsWith((input) => {
    input.data.targetEnvironment.serviceInstances.edges[0].node.serviceId =
      input.data.targetEnvironment.serviceInstances.edges[1].node.serviceId
  }, /service topology/u)
})

test("any visible deployment or incomplete project history fails closed", () => {
  failsWith((input) => {
    input.data.targetProject.environments.edges[0].node.deployments.edges.push({
      node: { id: "synthetic-deployment" },
    })
  }, /deployment history/u)
  failsWith((input) => {
    input.data.targetProject.environments.pageInfo.hasNextPage = true
  }, /environment list changed/u)
  failsWith((input) => {
    input.data.targetProject.environments.edges[0].node.serviceInstances.edges[0].node.hasEverDeployed = true
  }, /project service instance has deployed/u)
  failsWith((input) => {
    input.data.targetEnvironment.serviceInstances.edges[0].node.latestDeployment =
      {
        id: "synthetic-deployment",
      }
  }, /source, deployment, or domain/u)
  failsWith((input) => {
    input.data.targetEnvironment.serviceInstances.edges[0].node.activeDeployments.push(
      {
        id: "synthetic-deployment",
      }
    )
  }, /source, deployment, or domain/u)
})

test("variables, volumes, and automatic deployment triggers must remain absent", () => {
  for (const [field, expected] of [
    ["variables", /has variables/u],
    ["volumeInstances", /has volumes/u],
    ["deploymentTriggers", /has automatic deployment triggers/u],
  ]) {
    failsWith((input) => {
      input.data.targetEnvironment[field].edges.push({
        node: { id: "synthetic" },
      })
    }, expected)
    failsWith((input) => {
      input.data.targetEnvironment[field].pageInfo.hasNextPage = true
    }, /incomplete metadata/u)
  }
})

test("audit history fails on sync, truncation, or missing creation provenance", () => {
  failsWith((input) => {
    input.data.auditLogs.edges.push({
      node: {
        id: "88888888-8888-4888-8888-888888888888",
        createdAt: "2026-09-20T21:57:00.000Z",
        eventType: "Environment.synced",
        projectId: CLIENT_PROJECT_ID,
        environmentId: CLIENT_ENVIRONMENT_ID,
      },
    })
  }, /creation audit history/u)
  failsWith((input) => {
    input.data.auditLogs.pageInfo.hasNextPage = true
  }, /creation audit history/u)
  failsWith((input) => {
    input.data.auditLogs.edges[1].node.id =
      "99999999-9999-4999-8999-999999999999"
  }, /creation audit history/u)
})

test("Railway query and CLI suppress raw response failures", () => {
  assert.deepEqual(parseArguments([]), { help: false })
  assert.deepEqual(parseArguments(["--help"]), { help: true })
  assert.throws(() => parseArguments(["--other"]), /Usage:/u)
  assert.equal(runDormant([], { query: response }).passed, true)
  assert.deepEqual(
    runDormant(["--help"], {
      query: () => {
        throw new Error("called")
      },
    }),
    {
      help: true,
      passed: true,
      problems: [],
    }
  )

  let called = false
  const read = queryRailway((_bin, args, options) => {
    called = true
    assert.equal(args.includes(`projectId=${CLIENT_PROJECT_ID}`), true)
    assert.equal(args.includes(`environmentId=${CLIENT_ENVIRONMENT_ID}`), true)
    assert.equal(options.timeout, 20_000)
    return { status: 0, stdout: JSON.stringify(response()) }
  }, "railway")
  assert.equal(called, true)
  assert.equal(evaluateDormant(read).passed, true)

  assert.throws(
    () =>
      queryRailway(
        () => ({ status: 1, stdout: "synthetic-private-value" }),
        "railway"
      ),
    /metadata query failed/u
  )
  assert.throws(
    () =>
      queryRailway(
        () => ({ status: 0, stdout: "synthetic-private-value" }),
        "railway"
      ),
    /response was invalid/u
  )
  assert.throws(
    () =>
      queryRailway(
        () => ({ status: 0, stdout: '{"errors":["synthetic-private-value"]}' }),
        "railway"
      ),
    /response was incomplete/u
  )
  assert.deepEqual(
    evaluateDormant({ errors: [{ message: "synthetic-private-value" }] }),
    {
      passed: false,
      problems: ["Railway metadata query returned errors"],
    }
  )
})

test("CLI help and invalid arguments do not contact Railway", () => {
  const script = new URL(
    "./client-staging-dormant-preflight.mjs",
    import.meta.url
  )
  const help = spawnSync(process.execPath, [script.pathname, "--help"], {
    encoding: "utf8",
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /dormant-preflight\.mjs/u)

  const invalid = spawnSync(process.execPath, [script.pathname, "--other"], {
    encoding: "utf8",
  })
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /Usage:/u)
})
