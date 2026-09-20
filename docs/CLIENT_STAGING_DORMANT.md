# Dormant client staging shell

On September 20, 2026, a private, source-free shell was created through the
Railway CLI. It is intentionally **off**. Its seven service entries reserve the
application topology without starting a container or copying an owner secret.
This is a holding project, not a configured client clone or an acceptance
environment.

| Railway resource | Identity |
| --- | --- |
| Existing workspace | `Trawspace` (`54d68ca0-e718-42e7-977d-7075facc36e5`), Hobby plan |
| Project | `store-client-staging` (`42d7b49a-3379-4a99-8464-02f678fb7936`) |
| Only environment | `client-staging` (`0618f901-5c15-4c3c-9f49-b17d2113adee`) |

The service shells are Backend, Storefront, Postgres, Redis, Bucket, Console,
and MeiliSearch. The project has no connected repository or image, and the
environment has no variables (including empty-string placeholders), volumes,
public domains, deployment triggers, or deployments. Project PR
deploys and public access are disabled. Railway's current-period project usage
readout was `$0.00` after creation; it does not forecast future charges.
The existing Hobby workspace had only Tyler Schumacher as a member at the
time of the names-only audit. It is **owner-controlled, not client-owned**.
The names-only workspace audit history for this project contained one
`Project.created`, one `Environment.created` (opaque event ID
`8fa8d949-9095-4da7-a53d-985c77d5d5fd`), and seven `Service.added`
events, with no sync event as of the verification. No event payloads were read.

The source staging settings inventory gives the later configuration work a
secret-free starting point. Backend and Storefront use Railpack with the
checked-in build, start, healthcheck, and region declarations in
`.railway/railway.ts`; connecting their GitHub source would make them
deployable and is deferred. The source support services use these images and
storage mounts, which are **inventory only** here:

| Source service | Image or source | Source volume mount |
| --- | --- | --- |
| Postgres | `ghcr.io/railwayapp-templates/postgres-ssl:latest` | `/var/lib/postgresql/data` |
| Redis | `railwayapp/redis` | `/bitnami` |
| Bucket | `minio/minio:latest` | `/data` |
| Console | `railwayapp-templates/minio-console` GitHub source | None |
| MeiliSearch | `getmeili/meilisearch:v1.11.3` | `/meili_data` |

The four source volumes are each 50,000 MB in `us-east4-eqdc4a`; none were
copied or created in this project. Mutable image tags need reviewed digests
before any reproducible client deployment. Do not copy source commands or
settings that embed owner URLs or credentials without inspecting them through
a safe, names-only inventory.

Run the read-only check before any work on this target:

```sh
pnpm run client-staging:dormant-preflight
railway usage projects \
  --project 42d7b49a-3379-4a99-8464-02f678fb7936 \
  --workspace 54d68ca0-e718-42e7-977d-7075facc36e5 \
  --period current --json
```

The first command must confirm the exact workspace, project, environment, and
seven service names; no source, variables, domains, volumes, triggers, or
current/historical deployments; and private access with PR deploys off. It
requests metadata only, never variable values. The usage command is a
point-in-time billing observation. Stop if either result differs from this
record. Do not use `railway add --database`, `--repo`, `--image`, `railway up`,
or Railway's Duplicate/Sync Environment actions while this hold is active:
those can start services or copy the owner's ordinary variables. The existing
`.railway/railway.ts` applies only to owner `store/staging` and its
`preserve()` entries are unsafe for this empty target.

Before client configuration, establish a client-owned Railway workspace and
its billing/access policy, then transfer this **still-empty** project there.
Railway permits project transfers, but a new organization workspace is a
Pro/Enterprise feature and may add a base subscription charge even when
resource usage is zero. Never upgrade or open a subscription merely to keep
this shell. After transfer, update the pinned workspace identity in the
dormant check and re-verify membership, privacy, zero variables, and zero
deployments. Configure the seven services from a reviewed, secret-free
settings inventory; create independent internal credentials and client
provider keys through an approved secret channel. Keep all API keys absent
until supplied. Only then run the separate
[client staging preflight](CLIENT_STAGING_PREFLIGHT.md) and the controlled
deployment/acceptance steps in the
[hardening plan](PRODUCTION_HARDENING_PLAN.md#planned-initiative--client-isolated-staging-clone).

The repository's grouped-release policy still applies: gather the remaining
client-staging preparation into logical commits and push them together after
local checks, rather than creating a sequence of tiny pushes.
