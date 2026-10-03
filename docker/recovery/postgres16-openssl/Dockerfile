# Requires the locally verified base image described in README.md.
FROM remorseless-pg16-recovery-base:76db58e52e571729 AS original
FROM debian:trixie-slim@sha256:7792b1f7702a86946cd518db72b6a407302c3e9bc1635634368b878189e8221c AS packages
RUN apt-get update && mkdir /packages /controls /overlay && cd /packages && apt-get download libssl3t64=3.5.7-1~deb13u3 openssl-provider-legacy=3.5.7-1~deb13u3 && printf '%s\n' 'ff16bc048bcd7d1b256094450b79c77947d8e76fe2a24bd99b91021d591fa074  libssl3t64_3.5.7-1~deb13u3_amd64.deb' 'c12e0266c4780749a4702b8959ac979689f4182e18eed85a8a5eb90ed0e16eab  openssl-provider-legacy_3.5.7-1~deb13u3_amd64.deb' | sha256sum --check --strict && for package in *.deb; do name=$(dpkg-deb -f "$package" Package); dpkg-deb --extract "$package" /overlay; dpkg-deb --control "$package" "/controls/$name"; done
COPY --from=original /var/lib/dpkg/status /original-status
COPY merge-status.pl /merge-status.pl
RUN mkdir -p /overlay/var/lib/dpkg && perl /merge-status.pl
FROM original
COPY --from=packages /overlay/ /
LABEL com.remorseless.recovery.openssl-packages="3.5.7-1~deb13u3"
