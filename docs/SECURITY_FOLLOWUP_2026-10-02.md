# Security follow-up — October 2, 2026

Status: remediation in progress; exact-revision CI and staging acceptance are
required before resuming the hardening backlog. This entry supersedes older
claims about current credential validity or release acceptance, without
changing their historical evidence.

## Verified incident and containment

The September 28 Root, Backend, and Storefront scans on
`2a15471bf9d813b87e0cdb089fb96e483fdc416b` each rejected one verified Resend
credential in historical `logs.1761315253377.json`, introduced by
`29157d5f49fb5edcaeb398318f2debb038e7d10f`. Deleting that file in a later
commit did not revoke the credential or remove it from Git history. The
failures were genuine, not a reason to suppress scanning:

- [Root CI](https://github.com/traweezy/remorseless-records/actions/runs/36408302228).
- [Backend CI](https://github.com/traweezy/remorseless-records/actions/runs/36410998572).
- [Storefront CI](https://github.com/traweezy/remorseless-records/actions/runs/36408671410).

After explicit user authorization, an in-memory comparison confirmed that the
exposed credential was still configured on the guarded `store` / `staging`
Backend. Provider validation established management access. On October 2:

1. Created a replacement restricted to sending mail for the existing verified
   sender domain, and transferred it directly into the exact staging Backend
   variable through stdin. No token was printed or saved in repository files.
2. Independently verified the stored replacement and the provider's
   sending-only permission response.
3. Revoked the exposed credential at 22:07:42 UTC. A subsequent provider check
   rejected it with HTTP 400 `validation_error`.

Railway skipped the configuration-triggered candidate because CI was failing.
The active Backend was still deployment
`32e70862-469b-4e65-9ca7-d3eda0a0c696` at `2a15471`. Its liveness and all
11 readiness checks passed, but those checks do not establish email delivery.
The replacement is configured; staging email remains unavailable until a new
Backend deployment loads it. Do not redeploy the old configuration, bypass
CI, or send a test email without authorization. Acceptance must verify the
new exact revision and active process credential after all release gates pass.

The historical serialized configuration also contained database, Redis,
session-signing, and object-storage credentials. Their present validity and
rotation status have not been established by this Resend operation. Resend
revocation does not close that separate credential review. Available evidence
establishes exposure, not whether the credentials were misused.

## Reproducible scanner and dependency repair

The existing immutable TruffleHog action previously selected a floating runtime
image. All three workflows now bind that action to scanner 3.97.9 and its
reviewed immutable multi-platform image digest. Policy regressions reject
floating runtime versions, shallow history, skipped verification, and new
scan-exclusion arguments. The action scans changed commits on pushes/PRs and
complete history on scheduled/manual runs. Separate full-history verification
remains required after revocation; an empty result with a scanner error is not
a passing scan.

The post-revocation local scan passed with scanner 3.97.9: exit zero, a
completed-scan record, 25,089 chunks / 23,699,105 bytes, zero verified or
unverified findings, and no error records. It mounted only the Git directory
read-only and used the scanner's bare-repository mode; unrelated worktree
content was not scanned. An earlier invocation failed because it treated the
Git directory as a worktree; that failed attempt is not acceptance evidence.

The dependency batch updates the affected Undici, URI/IP parsing, Axios,
gRPC, brace-expansion, and FTP consumers, with behavior tests against their
actual installed artifacts. Reviewed same-major overrides retain the existing
Medusa/React compatibility boundaries. The targeted FTP major update preserves
both existing consumers while adopting upstream connection restrictions.

The user explicitly approved a cooling exception for Next 16.3.8 and its
matching `@next/env` and eight platform SWC artifacts. The release matures on
October 7 at 16:07 UTC; the exception is limited to those exact artifacts.
Next's [security release](https://github.com/vercel/next.js/releases/tag/v16.3.8)
fixes the [High image-optimizer SSRF](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4)
in an application path we use, in addition to other upstream findings.
Existing exact image-host restrictions reduce exposure but do not replace the
fix. Webpack, SRI/CSP, separate React dependency trees, and image restrictions
remain the reviewed application contracts. Exact publication timestamps,
selectors, compatibility evidence, and remaining audit exceptions belong in
the dependency policy and migration audit.

## Continuation and acceptance

The local checkout had stale work overlapping 20 newer staging commits.
Every existing changed file was privately backed up and byte-verified before
reconciling onto `2a15471`; unrelated local skills/configuration and `Default/`
remain outside this release. Unique documentation corrections, scheduler
policy-test wiring, and PostgreSQL redaction assertions were retained.

Local verification passed the shared lint/type/policy gate, 32 dependency
security cases, seven Next image runtime cases, Backend coverage (283 suites /
2,234 tests), and Storefront coverage (972 baseline / 362 transactional tests).
Backend coverage is 92.01% statements / 86.19% branches / 96.04% functions;
Storefront baseline is 94.91% statements / 87.91% branches, and transactional
coverage is 84.39% statements / 77.03% branches under its existing thresholds.
Both application builds, the standalone Storefront build, and all 48
three-engine critical browser cases passed.
The browser used an unused local port because another project owns port 3000.

Fresh scans of the exact disposable PostgreSQL/Redis images found zero
HIGH/CRITICAL/UNKNOWN results. PostgreSQL retained one MEDIUM nghttp2 finding;
Redis had none. All 142 service/recovery/session cases passed with zero skips,
including PostgreSQL cancellation and rollback. This host's Docker published
ports still fail protocol exchange, so the local run used private loopback
relays to the exact scanned containers. All 170 relay connections closed and
owned containers/networks/volumes were removed. No test assertion changed;
normal transport remains an exact-revision CI requirement.

Initial local harness attempts incorrectly injected integration-only Redis
and media settings into unit/build commands. Correcting that temporary harness
resolved the failures; no application assertion or gate was weakened.

Submit the logical Conventional Commits together through a protected staging
pull request. Watch all four workflows on the exact staging merge revision, and
verify both deployed revisions, readiness, live routes, scheduler observation,
and bounded logs before calling this release accepted. Record those results
in the handoff; older green runs do not satisfy these requirements.
