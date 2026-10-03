FROM redis:8.10.2-alpine3.23@sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23

LABEL org.opencontainers.image.description="Disposable Redis integration fixture; not a deployment image"
LABEL org.opencontainers.image.source="https://github.com/traweezy/remorseless-records"

# Fix the added Perl runtime and its new OS dependency to exact official APK
# bytes, since Alpine's signed package index may advance between CI runs.
ADD --checksum=sha256:9995840a76ac97ec006259391b7a81b73b73c5cf2f462bf12bb2250afbf665b9 https://dl-cdn.alpinelinux.org/alpine/v3.23/main/x86_64/libbz2-1.0.8-r6.apk /tmp/libbz2.apk
ADD --checksum=sha256:aed631849b8ccf66751452977ab7c64e1088143961a6bccc8cff3f37da5084fc https://dl-cdn.alpinelinux.org/alpine/v3.23/main/x86_64/perl-5.42.2-r0.apk /tmp/perl.apk

# Keep Redis, its modules and the official privilege-dropping entrypoint intact.
# Exact signed Alpine packages remediate the pinned base's OS advisories.
RUN apk --no-cache \
    --repositories-file /dev/null \
    --repository https://dl-cdn.alpinelinux.org/alpine/v3.23/main \
    --timeout 30 \
    add \
    libcrypto3=3.5.9-r0 \
    libssl3=3.5.9-r0 \
    setpriv=2.41.6-r1 \
    /tmp/libbz2.apk \
    /tmp/perl.apk \
    && rm /tmp/libbz2.apk /tmp/perl.apk
