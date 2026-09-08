# Disposable integration fixture only; PostgreSQL itself remains the pinned build.
# Go checksums: https://go.dev/dl/?mode=json
FROM postgres:18.6-alpine3.24@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2 AS toolchain-amd64
ADD --checksum=sha256:63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445 https://go.dev/dl/go1.27.1.linux-amd64.tar.gz /tmp/go.tar.gz

FROM postgres:18.6-alpine3.24@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2 AS toolchain-arm64
ADD --checksum=sha256:3450b45a3f9ee8568792736a5c5e70a1f2e9b36c35a8f74958c03e51d7d92bec https://go.dev/dl/go1.27.1.linux-arm64.tar.gz /tmp/go.tar.gz

FROM toolchain-${TARGETARCH} AS gosu-build
# gosu 1.19 source, independently matched to Alpine's published archive checksum.
ADD --checksum=sha256:33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b https://codeload.github.com/tianon/gosu/tar.gz/6456aaa0f3c854d199d0f037f068eb97515b7513 /tmp/gosu.tar.gz
ENV CGO_ENABLED=0 \
    GOTOOLCHAIN=local \
    GOPATH=/opt/gopath \
    GOCACHE=/opt/go-cache \
    GOPROXY=https://proxy.golang.org \
    GOSUMDB=sum.golang.org \
    GOFLAGS=-mod=readonly
# Preserve gosu behavior and module provenance. The only module correction is
# x/sys v0.44.0 (CVE-2026-39824), requiring the minimum go directive 1.25.0.
# Exact before/after hashes reject any other go.mod/go.sum drift.
RUN mkdir -p /opt/gosu-src /out/licenses/gosu \
    && tar -xzf /tmp/go.tar.gz -C /opt \
    && tar -xzf /tmp/gosu.tar.gz -C /opt/gosu-src --strip-components=1 \
    && cd /opt/gosu-src \
    && echo '0475f1708db81d718b633faf2d9dd64695037eabdc8562125060607bcb01b2ba  go.mod' | sha256sum -c - \
    && echo '2a8f3fb6adb84839bbb9999f12f1416fb86c184135aaa1c2e489b35203c08346  go.sum' | sha256sum -c - \
    && /opt/go/bin/go version \
    && /opt/go/bin/go mod edit -go=1.25.0 -require=golang.org/x/sys@v0.44.0 \
    && /opt/go/bin/go mod tidy \
    && echo 'c29d3a92f3cae2a45faab57ad6656fb54e8d77cd26248b3f859dcef6bbcc6e2a  go.mod' | sha256sum -c - \
    && echo 'a5ea1f3ca7128f3e5bd53f2601ac6fd70f2cd6c68bf7627aa09655ce9bcc1758  go.sum' | sha256sum -c - \
    && /opt/go/bin/go mod verify \
    && /opt/go/bin/go build -trimpath -buildvcs=false -o /out/gosu . \
    && /opt/go/bin/go version -m /out/gosu \
    && cp LICENSE /out/licenses/gosu/LICENSE \
    && cp go.mod go.sum /out/licenses/gosu/ \
    && cp /opt/go/LICENSE /out/licenses/gosu/go.LICENSE \
    && cp /opt/gopath/pkg/mod/github.com/moby/sys/user@v0.1.0/LICENSE /out/licenses/gosu/moby-sys-user.LICENSE \
    && cp /opt/gopath/pkg/mod/golang.org/x/sys@v0.44.0/LICENSE /out/licenses/gosu/x-sys.LICENSE \
    && /out/gosu --version \
    && /out/gosu nobody id

FROM postgres:18.6-alpine3.24@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2
LABEL com.remorseless.integration.fixture="postgres" \
    com.remorseless.integration.gosu.revision="6456aaa0f3c854d199d0f037f068eb97515b7513" \
    com.remorseless.integration.gosu.toolchain="go1.27.1"
# Existing Alpine trusted keys verify this exact official repository transaction.
RUN apk --no-cache \
    --repositories-file /dev/null \
    --repository https://dl-cdn.alpinelinux.org/alpine/v3.24/main \
    --timeout 30 \
    add libcrypto3=3.5.8-r0 libssl3=3.5.8-r0 libuuid=2.42.3-r1 libcurl=8.22.0-r0 \
    && apk list --installed --manifest
COPY --from=gosu-build --chmod=755 /out/gosu /usr/local/bin/gosu
COPY --from=gosu-build /out/licenses/gosu /usr/local/share/licenses/gosu
