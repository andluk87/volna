#!/bin/sh
# Run from the existing project directory. Does not remove or recreate volumes.
set -eu
if [ ! -f compose.yaml ]; then echo 'Run from the project directory.' >&2; exit 1; fi
umask 077
https=0
if [ -f .env ] && grep -Eq '^[[:space:]]*CHAT_DOMAIN[[:space:]]*=[[:space:]]*[^[:space:]#]+' .env; then
  if [ ! -f compose.https.yaml ]; then echo 'Missing compose.https.yaml; backup aborted.' >&2; exit 1; fi
  https=1
fi
compose() {
  if [ "$https" -eq 1 ]; then
    docker compose -f compose.yaml -f compose.https.yaml --profile calls "$@"
  else
    docker compose -f compose.yaml --profile calls "$@"
  fi
}
compose config --quiet
# Preserve the exact running containers. Compose up could recreate them using
# newly built images and wait for Whisper before the update has even started.
server_containers=$(compose ps --status running -q server)
start_services() {
  if [ -n "$server_containers" ]; then
    # Docker IDs contain no spaces; splitting supports multiple server replicas.
    docker start $server_containers >/dev/null
  fi
}
mkdir -p backups
backup="backups/volna-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
restart() { rm -f "$backup.tmp"; start_services >/dev/null 2>&1 || true; }
trap restart EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
compose stop server
if compose run --rm --no-deps -T --entrypoint tar server -C /data -czf - . > "$backup.tmp"; then
  mv "$backup.tmp" "$backup"
  echo "Backup: $backup"
else
  rm -f "$backup.tmp"
  echo 'Backup failed. Update aborted.' >&2
  exit 1
fi
start_services
trap - EXIT HUP INT TERM
