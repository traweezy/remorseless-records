FROM redis:8.10.2-alpine3.23@sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23

ADD --checksum=sha256:9995840a76ac97ec006259391b7a81b73b73c5cf2f462bf12bb2250afbf665b9 https://dl-cdn.alpinelinux.org/alpine/v3.23/main/x86_64/libbz2-1.0.8-r6.apk /tmp/libbz2.apk
ADD --checksum=sha256:aed631849b8ccf66751452977ab7c64e1088143961a6bccc8cff3f37da5084fc https://dl-cdn.alpinelinux.org/alpine/v3.23/main/x86_64/perl-5.42.2-r0.apk /tmp/perl.apk
# Preserve the existing guarded capture/queue probes during the image migration.
RUN apk --no-cache --repositories-file /dev/null \
    --repository https://dl-cdn.alpinelinux.org/alpine/v3.23/main --timeout 30 \
    add /tmp/libbz2.apk /tmp/perl.apk && rm /tmp/libbz2.apk /tmp/perl.apk && \
    mkdir -p /opt/bitnami/redis/bin && \
    ln -s /usr/local/bin/redis-cli /opt/bitnami/redis/bin/redis-cli
ARG RAILWAY_GIT_COMMIT_SHA
ARG REVISION=$RAILWAY_GIT_COMMIT_SHA
LABEL org.opencontainers.image.revision=$REVISION \
    com.remorseless.redis.version="8.10.2" \
    org.opencontainers.image.source="https://github.com/traweezy/remorseless-records" \
    org.opencontainers.image.description="Persistent staging Redis; existing Bitnami volume layout"
COPY --chmod=0555 docker/redis/start.sh /usr/local/bin/remorseless-redis
USER 1000:1000
WORKDIR /bitnami/redis/data
ENTRYPOINT ["/usr/local/bin/remorseless-redis"]
CMD []
