# Security gate incident — 2026-09-20

Status: remediation and exact-revision CI verification in progress. Feature
work is paused until this report records the resulting security state.

## Confirmed findings

The pushed `staging` revision `b0c88b36598cf1a5a3a5236a17506a3c8f8f77b0`
had green Root, Backend, Storefront, and Runtime Images workflows despite
actionable scanner output:

| Evidence | Result | Why green was wrong |
| --- | --- | --- |
| [Runtime Images run 35504105752](https://github.com/traweezy/remorseless-records/actions/runs/35504105752) | Each candidate had 4 CRITICAL, 52 HIGH, and 3 UNKNOWN Trivy findings. Validation succeeded; publication was skipped on `staging`. | The image gate rejected only findings with a listed fix. All HIGH/CRITICAL rows lacked one. |
| [Root security job 106060864420](https://github.com/traweezy/remorseless-records/actions/runs/35504105754/job/106060864420) | The Shai-Hulud detector reported one HIGH reference to the legitimate pinned TruffleHog action and zero compromised packages. | `fail-on-high` was false. The detector explicitly logged that it was not failing due to configuration. |
| CodeQL analyses `1806596962` and `1806596168` on that exact revision | 20 open HIGH and 3 open MEDIUM alerts, including filesystem races, temporary files, and a Storefront URL check. | Uploading an analysis does not fail the CodeQL job because findings exist. |
| Root, Backend, and Storefront Trivy filesystem steps | `ignore-unfixed: true` excluded unfixed vulnerabilities from the failure decision. | This policy could allow HIGH/CRITICAL findings without listed fixes to pass; no specific excluded filesystem finding is established here. |
| Branch protection | `staging` had no required status checks or repository rulesets. | A failing job would still not itself block updates to `staging`. |

Two open Dependabot MEDIUM records (#34 and #35) refer to the same
React Router DOM advisory, CVE-2026-53668, affecting the pinned 6.30.4
version. The isolated security revision now pins upstream-patched 6.30.6
and `@remix-run/router` 1.23.4; the other two documented v6 backports remain.
Dependabot closure must be checked after the new lockfile reaches GitHub.

These scanner findings establish exposure and ineffective gates, not
exploitation. The Runtime Images publication job did not publish the affected
candidate images on `staging`; Railway's source-built deployed images are a
different artifact and need their own evidence.

## Remediation being verified

- Runtime-image scan and artifact verification now reject every UNKNOWN,
  HIGH, and CRITICAL finding regardless of fix availability. The filesystem
  scans no longer ignore unfixed results.
- All five Shai-Hulud uses now fail on HIGH. The legitimate pinned
  TruffleHog reference has been expressed without the detector's false-positive
  literal while preserving the pin check.
- Backend and Storefront CodeQL jobs now inspect their local SARIF and fail
  on HIGH/CRITICAL findings. The gate rejects missing or malformed SARIF and
  was exercised against the prior exact-HEAD analysis, where it correctly
  rejected all 20 HIGH findings.
- The known HIGH CodeQL source patterns have been rewritten to use pinned file
  descriptors, exclusive/private writes, and exact URL matching. Fresh
  CodeQL analysis is still required to confirm alert closure.
- Final distroless Debian 13 candidates built from the pinned Node 26.9.0
  source both returned zero UNKNOWN/HIGH/CRITICAL under the reviewed Trivy
  0.70.0 executable and database. Backend retained 7 LOW/15 MEDIUM; Storefront
  retained 7 LOW/13 MEDIUM. Both final images passed executable Node 26.9.0,
  per-architecture Node and `libatomic` SHA-256, UID 1000, and no-shell/npm
  runtime checks. The earlier Node 26.5.0 candidate had also scanned clean,
  but its copied executable was affected by
  [HIGH CVE-2026-56848 and CVE-2026-58043](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases).
  Trivy does not classify the copied Node executable or `libatomic` as OS
  packages in the final SBOM; the source digest, verified binary hashes, exact
  version and separate advisory review cover this known inventory blind spot.
  The source's `libatomic1` package is `12.2.0-14+deb12u1` with one LOW and no
  higher finding. Storefront passed internal `/live` and decoder smoke;
  Backend loaded its packaged CLI and reached server creation with deliberately
  absent DB/Redis. Exact-revision CI and full runtime readiness are still
  required.
- The React Router update removes the GHSA-jjmj-jmhj-qwj2 audit ignore.
  Strict frozen installation, Backend's full build, and production-artifact
  security regressions passed in the source worktree; isolated-worktree gates
  and exact-revision CI are still required.

The three MEDIUM CodeQL alerts in the PostgreSQL recovery-client downloader
describe network bytes written to private files. That path uses HTTPS without
redirects, bounded responses, an independently pinned signing-key hash, a
verified repository signature, a signed package index, and exact package
size/SHA-256 checks before each write. The alerts remain open pending triage;
these controls do not by themselves close them.

## Credential and exfiltration review

The [Root secret-scan job 106061105021](https://github.com/traweezy/remorseless-records/actions/runs/35504105754/job/106061105021)
reported no Gitleaks findings on the full-history checkout. TruffleHog, run
with `--only-verified`, found zero verified secrets in the latest commit range.
GitHub secret scanning has zero alerts, including resolved alerts. The detector found
zero compromised packages. The reviewed Runtime Images validation jobs had
read-only tokens; the privileged publication job was skipped. No available
GitHub evidence establishes that a secret was stolen.

The Railway staging network and DNS review covered all seven services from
2026-09-19 00:00 through 2026-09-20 10:30 UTC, splitting saturated log queries
below the 1,000-record cap. Public-IP egress matched DNS answers for expected
Railway, Stripe, Medusa, Unsplash, and MeiliSearch endpoints. Five PostgreSQL flows
(~21 KB) targeted its own configured Railway TCP proxy. Large `100.64.*`
flows were service responses through Railway edge peers; the incident-window
Backend ~21 MB burst correlated with public `/store` catalog GETs. The Bucket's
1,180 reviewed HTTP requests on September 19–20 were GET/HEAD only, mostly
media, with no backup-like or auth-like path. No unmatched public egress was
observed in the network review. Backend/Storefront HTTP and deployment records
were reviewed for 09:45–10:30 UTC on September 20; no auth/admin request or
unexpected deployment was observed in that narrower incident window.

Read-only Railway trigger inspection found exactly one GitHub trigger for
each staging service, both on `staging` with `checkSuites: true` and
`validCheckSuites: 6`. On revision `689c52c`, Backend began building after
Root, Backend, and Runtime Images workflows succeeded but 17 seconds before
Storefront CI completed; Storefront began as its own CI completed. These
triggers do **not** establish a wait for every workflow before either service
builds. Both services skipped the later `b0c88b3` revision because watched
files did not change. No controlled failing-CI deployment test was performed.
Required status checks and a pull-request path on protected `staging`, with
direct pushes restricted, are therefore needed before the next ordinary merge;
the Railway trigger alone was insufficient as a release security gate.

Absence of those signals is **not proof of no theft**. The GitHub and Railway
network checks do not cover Railway account access or secret-variable reads,
StepSecurity's complete runner telemetry, GitHub account audit activity, or
payment/provider credential-use logs. Railway queries for 31 August and 8
September returned no records; evidence was available from 13 September, so
the older alert period remains unassessed. Those unavailable sources require
owner/provider review before a stronger assertion. Rotate an affected
credential immediately if its provider audit shows misuse or unexplained
access; the detector's false-positive reference alone does not establish a
compromise.

## Release hold

Do not resume feature work, publish runtime images, or promote `master` on the
strength of the earlier green workflows. Require a clean exact-revision scan,
CodeQL result review, dependency check, local tests, and protected branch
checks for the security revision. Keep this incident batch separate from the
uncommitted feature/recovery work and the unrelated `Default/` directory.
