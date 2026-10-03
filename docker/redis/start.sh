#!/bin/sh
set -eu
umask 077

fail() { printf '%s\n' 'Redis startup contract rejected.' >&2; exit 1; }
[ "$#" -eq 0 ] || fail
[ "$(id -u)" -eq 1000 ] || fail
[ "${RAILWAY_VOLUME_MOUNT_PATH:-/bitnami}" = /bitnami ] || fail
[ "${REDISUSER:-default}" = default ] || fail
case "${REDISPASSWORD:-}" in ''|*[!A-Za-z0-9_-]*) fail ;; esac
[ "${#REDISPASSWORD}" -ge 20 ] && [ "${#REDISPASSWORD}" -le 256 ] || fail

# Fail closed on an empty or misplaced volume. Clone/recovery provisioning
# must restore a verified archive before starting this service.
data=/bitnami/redis/data
[ "$(realpath "$data")" = "$data" ] || fail
[ -d "$data/appendonlydir" ] && [ -w "$data" ] || fail
[ -s "$data/appendonlydir/appendonly.aof.manifest" ] || fail
links=$(find "$data" -xdev -type l -print -quit) || fail
[ -z "$links" ] || fail

# Keep the prior server's files untouched. Railway must stop the prior
# volume writer before this one-time copy; a failed copy is never activated.
stage=
config=
cleanup() {
  [ -z "$config" ] || rm -f "$config"
  [ -z "$stage" ] || rm -rf "$stage"
}
trap cleanup EXIT HUP INT TERM
if [ ! -e "$data/runtime" ]; then
  stage=$(mktemp -d "$data/.runtime-copy.XXXXXX")
  cp -R "$data/appendonlydir" "$stage/appendonlydir"
  redis-check-aof "$stage/appendonlydir/appendonly.aof.manifest" >/dev/null 2>&1 || fail
  printf '%s\n' 'remorseless-redis-v1' > "$stage/.initialized"
  mv "$stage" "$data/runtime"
  stage=
fi
[ -d "$data/runtime" ] && [ "$(cat "$data/runtime/.initialized")" = remorseless-redis-v1 ] || fail
[ -s "$data/runtime/appendonlydir/appendonly.aof.manifest" ] || fail

config=$(mktemp /tmp/remorseless-redis.XXXXXX)
password_hash=$(printf '%s' "$REDISPASSWORD" | sha256sum)
password_hash=${password_hash%% *}
cat > "$config" <<EOF
bind 0.0.0.0 ::
port 6379
unixsocket /tmp/remorseless-redis.sock
unixsocketperm 600
protected-mode yes
user default on #${password_hash} ~* &* +@all
daemonize no
dir /bitnami/redis/data/runtime
dbfilename dump.rdb
appendonly yes
appendfilename appendonly.aof
appenddirname appendonlydir
appendfsync everysec
no-appendfsync-on-rewrite no
aof-load-truncated no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
save 900 1 300 10 60 10000
maxmemory 512mb
maxmemory-policy noeviction
EOF
unset REDISPASSWORD REDIS_PASSWORD REDIS_URL REDIS_PRIVATE_URL password_hash
exec redis-server "$config"
