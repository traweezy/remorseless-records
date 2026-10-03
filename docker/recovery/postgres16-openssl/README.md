# PostgreSQL 16 recovery OpenSSL correction

This recipe applies two signed Debian package updates to the existing reduced
PostgreSQL 16.15 recovery image. It is for isolated recovery only. It does not
change the live Railway database image or establish complete reproducibility
of the original reduced image, whose original private build recipe is absent.

Before building, independently verify that the local `default` Docker daemon's
`remorseless-pg16-recovery-base:76db58e52e571729` tag resolves to
`sha256:76db58e52e571729aa4ab51a5c597189e6f570086345c29b68b358067a6547e8`.
Create that tag only from this exact local ID; never pull the tag. The builder
is pinned to the linux/amd64 Debian manifest. APT verifies repository signatures
and the recipe checks both exact package SHA-256 values before extraction.

```sh
docker --context default build --pull=false \
  -f docker/recovery/postgres16-openssl/Dockerfile \
  -t remorseless-pg16-recovery:openssl-candidate \
  docker/recovery/postgres16-openssl
```

The original image carries a minimal package-status inventory, with no
`/var/lib/dpkg/info` files or package manager. The merge script requires exactly
the two original `3.5.7-1~deb13u2` package records and replaces them with verified
`3.5.7-1~deb13u3` controls. It preserves the remaining inventory. The extracted
payload includes libraries, engines, provider and documentation; neither package
contains a maintainer script. This is an overlay, not an APT installation into
the reduced runtime. Library paths/SONAMEs are unchanged.

Before accepting any build, compare its entire exported filesystem to the exact
base plus the extracted, hash-verified package payload and merged status. Allow
only Docker-generated hostname/hosts/resolver files to differ independently;
require all `/opt/postgresql` files to remain identical. Verify the original
image's identity again. Run the reviewed Trivy scanner against the final exact
image ID with a fresh database, without ignores; UNKNOWN, HIGH and CRITICAL
findings all block use. Retain package controls, signed APT metadata, report,
SBOM, database timestamps/hashes and filesystem comparison privately. A package
scan does not cover the source-built server: also review PostgreSQL's current
[version 16 security table](https://www.postgresql.org/support/security/16/).

The October 3 corrected artifact is
`sha256:df109059f8fdae1b25c5ee9a032cdf9897323783020e0fb7f09771b20928bd67`.
It was built before adding the explicit package checksum assertion to this
recipe; independent post-build verification checked the same package hashes and
all 2,768 non-directory filesystem entries. Only eight file contents changed;
the PostgreSQL binaries and all unrelated file contents/permissions were
unchanged. Rebuilding may produce a different image ID; do not update the target
runner's pin without repeating the full verification and restore acceptance.
See the recovery runbooks for dated scan and restored-target evidence.
