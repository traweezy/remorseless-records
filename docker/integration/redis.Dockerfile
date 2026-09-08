FROM redis:8.10.1-alpine3.23@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576

LABEL org.opencontainers.image.description="Disposable Redis integration fixture; not a deployment image"
LABEL org.opencontainers.image.source="https://github.com/traweezy/remorseless-records"

# Keep Redis, its modules and the official privilege-dropping entrypoint intact.
# Exact signed Alpine packages remediate the pinned base's OS advisories.
RUN apk --no-cache \
    --repositories-file /dev/null \
    --repository https://dl-cdn.alpinelinux.org/alpine/v3.23/main \
    --timeout 30 \
    add \
    libcrypto3=3.5.8-r0 \
    libssl3=3.5.8-r0 \
    setpriv=2.41.6-r1
