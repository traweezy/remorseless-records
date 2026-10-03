FROM node:26.9.0-bookworm-slim@sha256:582460f614631b59b824ac6020533b9bf339c7fdf3a6d7db31abb6b4065f0212 AS node-base
RUN node -e 'require("node:fs").writeFileSync("/ca-certificates.crt",require("node:tls").rootCertificates.join("\n"))'
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:e792ab3d241a468a4fd7519ddbbebe66b49b5f365771716ea688ad40b6c6f1c2 AS runtime-base

FROM debian:trixie-slim@sha256:7792b1f7702a86946cd518db72b6a407302c3e9bc1635634368b878189e8221c AS postgres-build
COPY --from=node-base /ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources && \
    printf 'Acquire::https::CaInfo "/etc/ssl/certs/ca-certificates.crt";\n' > /etc/apt/apt.conf.d/99-bootstrap-ca && \
    apt-get update && apt-get install -y --no-install-recommends build-essential bison flex bzip2 ca-certificates libssl-dev=3.5.7-1~deb13u3 libssl3t64=3.5.7-1~deb13u3 openssl-provider-legacy=3.5.7-1~deb13u3
ADD --checksum=sha256:c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.bz2 /tmp/postgresql.tar.bz2
RUN mkdir /src && tar -xjf /tmp/postgresql.tar.bz2 -C /src --strip-components=1 && cd /src && ./configure --prefix=/opt/postgresql --with-ssl=openssl --without-readline --without-icu --without-ldap --without-gssapi --without-lz4 --without-zstd --without-zlib && make -j4 && make install
RUN mkdir -p /runtime/usr/local/bin /runtime/usr/lib/x86_64-linux-gnu /runtime/usr/share/doc/postgresql /runtime/var/lib/dpkg/status.d && \
    cp /opt/postgresql/bin/pg_dump /opt/postgresql/bin/pg_restore /opt/postgresql/bin/psql /runtime/usr/local/bin/ && \
    cp -L /opt/postgresql/lib/libpq.so.5 /runtime/usr/lib/x86_64-linux-gnu/ && \
    cp -L /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /runtime/usr/lib/x86_64-linux-gnu/ && \
    cp /src/COPYRIGHT /runtime/usr/share/doc/postgresql/ && \
    dpkg-query -s libssl3t64 > /runtime/var/lib/dpkg/status.d/rr-libssl && \
    cp -a /usr/share/doc/libssl3t64 /runtime/usr/share/doc/

FROM node-base AS dependencies
RUN npm install --global pnpm@11.17.0 && test "$(pnpm --version)" = 11.17.0
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY storefront/package.json ./storefront/package.json
COPY operations/package.json ./operations/package.json
COPY patches ./patches
RUN pnpm install --frozen-lockfile --filter @remorseless/recovery --ignore-scripts && pnpm --ignore-scripts --filter @remorseless/recovery deploy --prod --legacy /output
RUN test "$(node --version)" = v26.9.0 && \
    echo '05757b064ad2a221b41874794da42361c9bab033c7c33c1f1b458c25a7de7e59  /usr/local/bin/node' | sha256sum -c - && \
    cp -L /usr/lib/x86_64-linux-gnu/libatomic.so.1 /libatomic.so.1 && \
    echo '107ab9f7661a1c47cddfb5cd1def99ec537a50a9a537fbe38cdde1b34b8ba280  /libatomic.so.1' | sha256sum -c -

FROM runtime-base
ARG REVISION
LABEL org.opencontainers.image.source="https://github.com/traweezy/remorseless-records" \
    org.opencontainers.image.revision=$REVISION \
    org.opencontainers.image.description="Remorseless restricted database and media backups" \
    com.remorseless.postgresql.version="16.15"
ENV HOME=/home/nonroot NODE_ENV=production LD_LIBRARY_PATH=/usr/local/lib PATH=/usr/local/bin:/usr/bin:/bin
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=dependencies /libatomic.so.1 /usr/lib/x86_64-linux-gnu/libatomic.so.1
COPY --from=postgres-build /runtime/ /
WORKDIR /app
COPY --from=dependencies --chown=65532:65532 /output/ ./operations/
COPY --chown=65532:65532 scripts/ ./scripts/
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["scripts/railway-scheduled-backup.mjs"]
