# Client staging preflight

Run this read-only check after creating a separate client Railway workspace,
project, and empty `client-staging` environment, and after provisioning the
seven services. It requires a recent audit attestation that the environment
was created empty and never synced. It does not create, alter, deploy, or
delete Railway resources.

```sh
node scripts/client-staging-preflight.mjs --help
node scripts/client-staging-preflight.mjs --manifest /tmp/client-staging-inventory.json
```

The operator account must be able to read both the existing `store` project
and the client project. The pinned Railway CLI reads at most 16 pages of 100
variable records, with a 20-second deadline and 512 KiB response limit per
page. The query requests only project/workspace identities, the nullable
source-environment link, service names and IDs, application deployment state,
deployment-trigger IDs, configuration revision, and variable names, sealing
flags, service IDs, and reference metadata. It does **not** request variable
values, service configuration, deployment snapshots, or logs. The command
suppresses raw CLI errors and response bodies and fails if the configuration
revision changes during pagination.

The required JSON manifest is names-only and at most 64 KiB. Keep it outside
the repository as a regular file owned by the invoking user with mode exactly
`0600`; symlinks, other modes, and nonregular files are rejected before
reading. It has this shape:

```json
{
  "schemaVersion": 2,
  "target": {
    "projectId": "<client project UUID>",
    "environmentId": "<client environment UUID>",
    "workspaceId": "<client workspace UUID>"
  },
  "provenance": {
    "reviewedAt": "<current UTC timestamp with milliseconds>",
    "reviewer": "<operator identifier>",
    "creationEventId": "<opaque Railway audit event ID>",
    "creationMode": "empty",
    "noSyncSinceCreation": true
  },
  "inventory": {
    "reviewedAt": "<current UTC timestamp with milliseconds>",
    "reviewer": "<operator identifier>",
    "services": [
      {
        "name": "Backend",
        "variableNames": ["DATABASE_URL"],
        "sealedVariableNames": ["DATABASE_URL"],
        "references": [
          { "variableName": "DATABASE_URL", "targetService": "Postgres" }
        ]
      }
    ]
  }
}
```

The example is intentionally incomplete. Supply entries for exactly Backend,
Storefront, Postgres, Redis, Bucket, Console, and MeiliSearch, with all actual
variable **names** and sealed-name subsets. Each service must have at least
one sealed credential. Include names-only references for Backend's
`DATABASE_URL` → Postgres, `REDIS_URL` → Redis, `MINIO_ENDPOINT` → Bucket,
`MEILISEARCH_HOST` → MeiliSearch; and Storefront's `MEDUSA_BACKEND_URL` and
`MEILISEARCH_HOST` → Backend, `REDIS_URL` → Redis. The Backend and Storefront
secret-name requirements are enforced in code. Inventory and provenance
reviews expire after 24 hours. Review Railway's workspace audit history from
environment creation through the current time before attesting `creationMode`
and `noSyncSinceCreation`. Record only the opaque creation event ID, never an
event payload. The API's nullable source link does not prove how the
environment was created or whether it was later synced. Never add variable
values, provider keys, customer data, or connection URLs. Unknown JSON fields
are rejected.

The command fails unless the target project is in a different workspace from
the owner's `store` project, the environment is named `client-staging`, the
source-environment link is null, all seven expected service instances exist
without a truncated result, Backend and Storefront have **never deployed**,
and there are zero automatic deployment triggers. It compares the complete
live variable-name and sealed-name sets for each service with the reviewed
inventory; shared or unknown-service variables fail until explicitly modeled.
It also requires the reviewed reference targets to match the expected
contract. These target mappings are an **operator attestation**: Railway's
reference strings do not establish the effective endpoint or account.
A passing result verifies only those metadata and attestation conditions. It
**cannot** prove that client keys differ from owner keys. Independently verify
provider account fingerprints, effective private endpoints, public bundle
identity, and outbound writes before the client services deploy or handle
traffic. See the
[client staging plan](PRODUCTION_HARDENING_PLAN.md#planned-initiative--client-isolated-staging-clone).

The existing `.railway/railway.ts` and `scripts/railway-config.mjs` remain
guarded to the owner `store/staging` target. Do not broaden their allowlist
until a real client target and complete sanitized application variable plan
exist: their current `preserve()` declarations assume existing variables and
are unsafe as a provisioning template for an empty environment.
