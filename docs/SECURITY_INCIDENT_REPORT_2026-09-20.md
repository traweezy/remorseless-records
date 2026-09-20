# Security gate incident — 2026-09-20

Status: immediate scanner and branch controls verified on staging at
`712c9bfe28c83890f60edfb617af029015cab922`. No confirmed theft signal was found in
the available evidence, but account/session and provider request history are
not fully accessible. Feature work remains paused for the report and residual
security decisions.

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
Dependabot marked both records fixed at 2026-09-20 14:12 UTC; neither was
dismissed.

These scanner findings establish exposure and ineffective gates, not
exploitation. The Runtime Images publication job did not publish the affected
candidate images on `staging`; Railway's source-built deployed images are a
different artifact and need their own evidence.

## Remediation and verification

The first exact-revision run at `8c907d7` failed closed. Both CodeQL jobs
rejected five new HIGH findings in security-test assertions after the earlier
20 HIGH alerts were fixed. Both image jobs stopped before scanning because the
hardened runner lacked `gcr.io:443` for the new pinned distroless base; those
jobs produced no CI vulnerability counts. The corrective batch changes those
test assertions and adds only the observed registry endpoint to the reviewed
egress policy. The later `e385225` run fixed the image path but correctly
failed CodeQL on one test assertion. The final `712c9bf` run passed all four
workflows, including both CodeQL gates, both image scans, builds, unit and
integration tests, Storefront browser, accessibility, and Lighthouse jobs.
Railway staging records show both services skipped `8c907d7` because its CI
suite failed and skipped `e385225` because no watched application files
changed. Both services also skipped `712c9bf` because no watched application
files changed; none of these security revisions became an online service
deployment.

- Runtime-image scan and artifact verification now reject every UNKNOWN,
  HIGH, and CRITICAL finding regardless of fix availability. The filesystem
  scans no longer ignore unfixed results.
- All five Shai-Hulud uses now fail on HIGH. The legitimate pinned
  TruffleHog reference has been expressed without the detector's false-positive
  literal while preserving the pin check.
- Backend and Storefront CodeQL jobs at `712c9bf` inspect their local SARIF
  and fail on HIGH/CRITICAL findings. The gate rejects missing or malformed
  SARIF and correctly rejected all 20 earlier HIGH findings. This follow-up
  binds the three reviewed MEDIUM PostgreSQL downloads to exact rule, path,
  line fingerprints, and a pinned provisioner source hash. Once merged, the
  follow-up gate rejects every new MEDIUM finding and invalidates the three
  exceptions if the provisioner changes. GitHub keeps those alerts visible.
- The known HIGH CodeQL source patterns have been rewritten to use pinned file
  descriptors, exclusive/private writes, and exact URL matching. GitHub's
  final analysis marked all earlier and corrective HIGH alerts fixed, with
  zero open HIGH/CRITICAL alerts. The final CodeQL jobs both passed.
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
  higher finding. Final exact-revision Runtime Images CI passed build, runtime
  smoke, Trivy scan, artifact verification, and evidence upload for both
  candidates: Backend UNKNOWN=0/HIGH=0/CRITICAL=0, LOW=7/MEDIUM=15;
  Storefront UNKNOWN=0/HIGH=0/CRITICAL=0, LOW=7/MEDIUM=13. The candidate
  images remain unpublished on `staging`; Railway still serves its earlier
  source-built application revision.
- The React Router update removes the GHSA-jjmj-jmhj-qwj2 audit ignore.
  Strict frozen installation, production builds, coverage, and
  production-artifact security regressions passed locally and in CI.

Railway subsequently accepted exact-commit Backend and Storefront deployments
for `3003b777` after all four workflows passed. Both services reported that
revision and healthy readiness, but read-only process checks found Node
`v26.5.0` in the live Railpack images: the root `.nvmrc` still pinned the
older runtime even though the separately scanned candidate images use
`v26.9.0`. The Node security remediation therefore requires a second
exact-commit application rollout. The follow-up aligns root and service-local
Node pins with the scanned image and makes their parity a quality gate;
acceptance requires live process-version, readiness, and route checks after
the follow-up deployment. The prior `3003b777` rollout is not evidence that
the patched Node runtime reached Railway.

GitHub branch protection now requires pull requests, strict status checks,
admin enforcement, and resolved conversations. Staging requires 23 checks;
master requires the same 23 plus Browser Smoke, accessibility, and Lighthouse
(26 total). Every required check is bound to GitHub Actions app ID 15368.
Force pushes and deletions remain disabled. The final `712c9bf` run passed
all four workflows before these rules were read back through the API.

The three MEDIUM CodeQL alerts in the PostgreSQL recovery-client downloader
describe network bytes written to private files. That path uses HTTPS without
redirects and bounded responses. The signing key has an independently pinned
hash; the repository `InRelease` is written privately, then its signature is
verified before trusting its metadata. Package size and SHA-256 are checked
before package writes. CodeQL does not model those checks as sanitizers;
calling the intentional writes false positives would be inaccurate. The alerts
remain open for visibility. The follow-up exact-fingerprint and source-hash
baseline rejects new MEDIUM findings and invalidates the exception if the
provisioner changes. This is a
documented residual security decision, not a claim that the network-to-file
operation is absent.

## Credential and exfiltration review

The [Root secret-scan job 106061105021](https://github.com/traweezy/remorseless-records/actions/runs/35504105754/job/106061105021)
reported no Gitleaks findings on the full-history checkout. TruffleHog, run
with `--only-verified`, found zero verified secrets in the latest commit range.
GitHub secret scanning has zero alerts, including resolved alerts. The detector
found zero compromised packages. The reviewed Runtime Images validation jobs had
read-only tokens; the privileged publication job was skipped. No available
GitHub evidence establishes that a secret was stolen.

The Railway staging network and DNS review covered all seven services from
2026-09-19 00:00 through 2026-09-20 10:30 UTC, splitting saturated log queries
below the 1,000-record cap. Public-IP egress matched DNS answers for expected
Railway, Stripe, Medusa, Unsplash, and MeiliSearch endpoints. Five
PostgreSQL flows (~21 KB) targeted its own configured Railway TCP proxy.
Large `100.64.*` flows were service responses through Railway edge peers; the
incident-window Backend ~21 MB burst correlated with public `/store` catalog
GETs. The Bucket's
1,180 reviewed HTTP requests on September 19–20 were GET/HEAD only, mostly
media, with no backup-like or auth-like path. No unmatched public egress was
observed in the network review. Backend/Storefront HTTP and deployment records
were reviewed for 09:45–10:30 UTC on September 20; no auth/admin request or
unexpected deployment was observed in that narrower incident window.

The initial authenticated Railway CLI workspace audit was paged across the full
2026-08-31 through 2026-09-20 window before the later read-only SSH runtime
checks: 275 events, consisting of 148
GitHub-source `staging` deployments for Backend/Storefront, 122 successful
SSH authentications, and five backups. The SSH entries use one Railway user
matching the current CLI login and one key fingerprint. Four source-IP groups
appear; the current host matches the two most recent authentications, while
the three older groups have no trustworthy workstation-IP record for
attribution. The audit stream contains no variable, token, or account-login
event, but Railway denied the CLI's account-session and audit-event-catalog
queries, and the stream does not establish whether variable reads are logged.

The authenticated, user-scoped GitHub CLI activity feed returned 210
`traweezy` events in that window. Its 93 pushes to this repository all
targeted `staging`. This feed cannot reveal another identity's access or token
use. It is a development-activity feed, not the personal Security log: it
cannot show sign-ins, token grants, OAuth authorizations, or 2FA changes. The
personal Security log requires the account's Settings export; the CLI offers
no equivalent personal-account audit endpoint.

The Stripe CLI had no authenticated historical-log session, but the staging
Backend supplied a test-mode Stripe key to a read-only API query. The test
account returned seven v1 events between 31 August and 20 September and zero
v2 events: balance, dispute, and payout events, all in test mode, with no
associated request ID. The query covered every page. Only a test-mode
credential was used for this audit; no live credential or its logs was
inspected. Stripe's historical API request logs are a Dashboard/Workbench
surface, not a CLI history endpoint.
Read-only or failed credential use would not appear in these event lists, so
the result cannot establish that either key was never used or copied.

The staging Backend also has a Resend API key and a TaxRate.io lookup key.
A read-only request to [Resend's request-log API](https://resend.com/docs/api-reference/logs/list-logs)
using the deployed key returned HTTP 403; the response does not establish
whether the key is restricted or why access was denied. No historical
TaxRate.io request-log API was found in its published documentation. The
MinIO, MeiliSearch, PostgreSQL, and Redis credentials belong to services
inside the Railway project; no independent audit sink for their credential
use is configured. Their available service and network logs were covered by
the Railway review above, but provider/account-level usage history remains
unavailable through these credentials.

Read-only Railway trigger inspection found exactly one GitHub trigger for
each staging service, both on `staging` with `checkSuites: true` and
`validCheckSuites: 6`. On revision `689c52c`, Backend began building after
Root, Backend, and Runtime Images workflows succeeded but 17 seconds before
Storefront CI completed; Storefront began as its own CI completed. These
triggers do **not** establish a wait for every workflow before either service
builds. Both services skipped the later `b0c88b3` revision because watched
files did not change. The failed `8c907d7` CI suite caused both services to
skip that revision, but no controlled test of every check-suite dependency was
performed.
Historical Railway deployment-audit payloads show `checkSuites:false` even
while the current trigger objects show `checkSuites:true`; the payload field's
meaning is undocumented, so it cannot prove historical wait-for-CI behavior.
Required status checks and a pull-request path now protect `staging`, with
direct pushes restricted; the Railway trigger alone was insufficient as a
release security gate.

Absence of those signals is **not proof of no theft**. The CLI cannot inspect
Railway account sessions or establish whether secret-variable reads are
audited. It cannot read GitHub's personal Security log or StepSecurity's
complete runner telemetry. Railway network-log queries for 31 August and 8
September returned no records, although the workspace audit covers those
dates. Stripe historical request logs and live-account history require
Dashboard/provider access. Rotate an affected credential immediately if its
provider audit shows misuse or
unexplained access; the detector's false-positive reference alone does not
establish a compromise.

## Release hold

The exact-revision scanner, dependency, test, and build gates passed at
`712c9bf`; branch protection was configured and read back through the API.
The follow-up change is subject to the MEDIUM gate and protected merge path.
Keep feature work separate from this incident until the
remaining account/provider audit limits and three reviewed MEDIUM findings are
reported to the owner. Do not publish runtime images or promote `master`
without the separate release review and production acceptance. Preserve the
uncommitted feature/recovery work and the unrelated `Default/` directory.
