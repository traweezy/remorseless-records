#!/bin/sh
set -eu

# This historical Docker Official Image digest is the checker provenance root.
# The moving 8.10.1-alpine3.23 tag must never replace the digest below.
image='redis:8.10.1-alpine3.23@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576'
image_id='sha256:00c30ddf0ef8074bbc7b7e5ea655bb6d359dc66694edd57d70fe95ce6ba531aa'
checker_sha='c9ed119a46bfe87ace4048eb22479da7d3ca4857f0ea5b1d1729e212bc5aabca'

[ "$(/usr/bin/docker --context default image inspect --format '{{.Id}}' "$image" 2>/dev/null)" = "$image_id" ] || exit 1
/usr/bin/docker --context default image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" 2>/dev/null |
  grep -Fx 'redis@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576' >/dev/null || exit 1
checksum="$(/usr/bin/docker --context default run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m --pids-limit 32 --entrypoint sha256sum "$image" /usr/local/bin/redis-check-aof 2>/dev/null)"
[ "$checksum" = "$checker_sha  /usr/local/bin/redis-check-aof" ] || exit 1

if [ "$#" -eq 1 ] && [ "$1" = '--version' ]; then
  exec /usr/bin/docker --context default run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m --pids-limit 32 --entrypoint redis-check-aof "$image" --version
fi
[ "$#" -eq 1 ] || exit 1
case "$1" in
  /*/appendonly.aof.manifest) ;;
  *) exit 1 ;;
esac
parent="$(dirname "$1")"
case "$parent" in
  *','*|*':'*) exit 1 ;;
esac
exec /usr/bin/docker --context default run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 64 --user "$(id -u):$(id -g)" --mount "type=bind,source=$parent,target=/aof" --entrypoint redis-check-aof "$image" /aof/appendonly.aof.manifest
