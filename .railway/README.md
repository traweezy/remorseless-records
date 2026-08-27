# Railway configuration

This project defines its Railway infrastructure in code.

```txt
.railway/railway.ts
```

Use this file to describe the Railway project you want: services, databases, buckets, custom domains, replicas, groups, and environment variables.

## Common commands

Create the configuration files:

```bash
railway config init
```

Import an existing Railway project into code:

```bash
railway config pull
```

Preview what Railway would change:

```bash
pnpm run railway:plan:staging
```

Apply the planned changes:

```bash
pnpm run railway:apply:staging
```

## Notes

- `railway config plan` is safe and does not change Railway.
- `railway config apply` previews changes and asks before applying unless you pass `--yes`.
- Destructive changes in non-interactive or agent sessions require `railway config apply --confirm-destructive` after reviewing the plan.
- This repository's definition intentionally fails closed except through the
  guarded `staging` wrapper. The wrapper verifies the exact project and linked
  environment IDs before enabling evaluation. Production infrastructure must
  not be created or changed without explicit approval and a reviewed update to
  that guard.
- Run `pnpm run qa:railway-iac` before every plan. It checks the complete
  application partial, preserved variables, exact SDK version, pnpm-only
  commands, dependency-aware readiness gates, and the staging-only boundary.
- The stable `applications` partial intentionally owns only Backend and
  Storefront. Railway's beta importer currently plans non-idempotent source and
  builder changes for imported database and support services; those resources
  remain dashboard-managed until a clean whole-project import is possible.
- Apply only a plan with zero unexpected deletes. After an apply, wait for all
  required GitHub checks, exact-commit Railway deployments, `/live`, `/ready`,
  and compatibility health probes before continuing.
- Railway's current read model omits already-effective restart-policy fields,
  so plans repeat those two application updates after a successful apply. Do
  not loop the apply solely for that phantom drift; confirm the effective
  Backend and Storefront deployment manifests instead.
- The repository pins Railway CLI 5.45.0 and patches its installer to use
  `tar@7.5.22` and verify Railway's immutable SHA-256 release-asset digest
  before extraction. Update the version, all platform digests, and the package
  patch together.
- Storefront `REDIS_URL` must compose the Redis user/password references with
  `${{Redis.RAILWAY_PRIVATE_DOMAIN}}:6379`. This keeps server-side cache and
  rate-limit traffic on Railway's private network; do not replace it with the
  provider's public `REDIS_URL`, `REDIS_PUBLIC_URL`, or TCP proxy port.
- Backend and Storefront watch paths include their own workspace plus the root
  Node/pnpm version, manifest, lockfile, workspace policy, and dependency patch
  inputs consumed by both builds. A root lockfile or toolchain change must
  rebuild both services; an application-only change must rebuild only its
  owning service.
- Documentation and `.railway/**` are intentionally not build inputs. Apply
  Railway IaC changes through the guarded staging wrapper after their source
  commit passes CI. A documentation-only staging push must run GitHub checks
  without spending a Backend or Storefront rebuild.
- The service-specific watch paths were accepted in staging on August 27,
  2026. The effective Backend and Storefront manifests contain the reviewed
  path lists; the post-apply plan contains only the known restart-policy
  readback drift. Railway still writes a terminal `SKIPPED` metadata record for
  each connected service on an ignored commit. Assert `SKIPPED`, no image
  digest, and no build/deploy logs for documentation-only staging pushes as an
  ongoing cost regression gate.
- Services already managed by `railway.json` must be migrated before `.railway/railway.ts` can manage them.
- Keep one `.railway` file for the whole project. A named `export const partial` (or `PARTIAL` / `const Partial`) is a last resort for separate repos that cannot share that file. Do not add it unless omit=delete across repos is a blocker.
- Use `replicas` for scaling; advanced placement can still specify region names.
- Use `group("Name", [resources])` to keep large projects organized on the Railway canvas.
- Secrets imported from Railway are rendered as `preserve()` so existing values are retained without writing secret values to source. Use `railway config pull --omit-preserved-variables` for a smaller import.
