#!/bin/sh
# Consistent backup of PostgreSQL plus immutable uploads and retained SQLite sources.
set -eu
[ -f compose.yaml ] || { echo 'Run from the project directory.' >&2; exit 1; }
umask 077
compose() {
 if [ -f .env ] && grep -Eq '^[[:space:]]*CHAT_DOMAIN[[:space:]]*=[[:space:]]*[^[:space:]#]+' .env; then
  docker compose -f compose.yaml -f compose.https.yaml --profile calls "$@"
 else docker compose -f compose.yaml --profile calls "$@"; fi
}
compose config --quiet
server_containers=$(compose ps --status running -q server)
postgres_container=$(compose ps -a -q postgres)
start_services() { if [ -n "$server_containers" ]; then docker start $server_containers >/dev/null; fi; }
mkdir -p backups
backup="backups/volna-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
cleanup() { rm -f "$backup.tmp"; start_services >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
compose stop server
create_backup() {
if [ -n "$postgres_container" ]; then
 compose up -d --wait --wait-timeout 120 postgres || return
 # The server image supplies pg_dump 17. A helper container mounts the same /data.
 compose run --rm --no-deps -T --entrypoint sh server -ec '
  stage=$(mktemp -d /data/.pg-backup.XXXXXX)
  trap '\''rm -rf "$stage"'\'' EXIT
  pg_dump --dbname="$DATABASE_URL" --format=custom --file="$stage/volna.dump"
  tar -C /data --exclude="./.pg-backup.*" -czf - . -C "$stage" volna.dump
 ' > "$backup.tmp"
else
 # Before the one-time migration only SQLite and uploads exist.
 compose run --rm --no-deps -T --entrypoint tar server -C /data -czf - . > "$backup.tmp"
fi
}
if ! create_backup; then
 echo 'Backup failed. Update aborted.' >&2
 exit 1
fi
mv "$backup.tmp" "$backup"
start_services
trap - EXIT HUP INT TERM
echo "Backup: $backup"
