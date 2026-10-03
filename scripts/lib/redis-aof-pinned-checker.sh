#!/bin/sh
set -eu

# This historical Docker Official Image digest is the checker provenance root.
# The moving 8.10.2-alpine3.23 tag must never replace the digest below.
image='redis:8.10.2-alpine3.23@sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23'
image_id='sha256:15f5a4aad4c3ba34b9874ddbc7f755b469dbd7b8a9e88c12690c52ef6c72465c'
checker_sha='df1291685ab15c4708c5556298146a93f498387aa6265aa0988da88d9952e41d'

[ "$(/usr/bin/docker --context default context inspect default --format '{{json .Endpoints.docker.Host}}' 2>/dev/null)" = '"unix:///var/run/docker.sock"' ] || exit 1
[ -S /var/run/docker.sock ] || exit 1
[ ! -L /var/run/docker.sock ] || exit 1
[ "$(/usr/bin/docker --context default image inspect --format '{{.Id}}' "$image" 2>/dev/null)" = "$image_id" ] || exit 1
/usr/bin/docker --context default image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" 2>/dev/null |
  grep -Fx 'redis@sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23' >/dev/null || exit 1
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
