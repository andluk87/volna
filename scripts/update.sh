#!/bin/sh
# Run after copying source files, keeping the existing .env.
set -eu
if [ ! -f compose.yaml ] || [ ! -f .env ]; then
  echo 'Run from the existing project directory containing compose.yaml and your .env.' >&2
  exit 1
fi
version=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1)
if [ -z "$version" ]; then echo 'Cannot read the Volna version from package.json.' >&2; exit 1; fi
echo "Updating Volna to $version in $(pwd)."
case "${VOLNA_BUILD_NETWORK:-default}" in
  default) ;;
  host) [ -f compose.build-host.yaml ] || { echo 'Missing compose.build-host.yaml.' >&2; exit 1; } ;;
  *) echo 'VOLNA_BUILD_NETWORK must be default or host.' >&2; exit 1 ;;
esac
https=0
calls=0
if grep -Eq '^[[:space:]]*CHAT_DOMAIN[[:space:]]*=[[:space:]]*[^[:space:]#]+' .env; then
  if [ ! -f compose.https.yaml ]; then echo 'Missing compose.https.yaml; update aborted.' >&2; exit 1; fi
  https=1
fi
compose() {
  set -- --profile calls "$@"
  if [ "${VOLNA_BUILD_NETWORK:-default}" = host ]; then
    set -- -f compose.build-host.yaml "$@"
  fi
  if [ "$https" -eq 1 ]; then
    set -- -f compose.https.yaml "$@"
  fi
  docker compose -f compose.yaml "$@"
}
# Validate without printing secrets. Failed builds leave running containers intact.
compose config --quiet
calls=$(compose config --format json | python3 scripts/calls-config.py)
if [ "$calls" -eq 0 ]; then
  echo 'TURN is not configured. To enable calls across networks: sh scripts/enable-calls.sh'
fi
compose build server web transcription
sh scripts/backup.sh
set -- server web transcription
if [ "$calls" -eq 1 ]; then set -- "$@" turn; fi
if [ "$https" -eq 1 ]; then set -- "$@" gateway; fi
if ! compose up -d --wait --wait-timeout 600 "$@"; then
  echo 'Update did not become ready. The data backup is in backups/.' >&2
  compose ps -a
  compose logs --no-color --tail=80 transcription >&2 || true
  exit 1
fi
if ! compose exec -T web sh -ec 'grep -R -F -q "$1" /usr/share/nginx/html/assets' sh "$version"; then
  echo "The running web container does not contain Volna $version. Check that this is the correct project directory and Compose project." >&2
  compose ps -a
  exit 1
fi
echo "Verified web assets: Volna $version."
# Catch a TURN process that exits just after Compose reports it running.
if [ "$calls" -eq 1 ]; then
  container=$(compose ps -a -q turn)
  restarts=$(docker inspect --format '{{.RestartCount}}' "$container")
  sleep 5
  if [ -z "$container" ] || [ "$(docker inspect --format '{{.State.Status}} {{.RestartCount}}' "$container")" != "running $restarts" ]; then
    echo 'TURN failed its startup check. Run: docker compose logs --tail=100 turn' >&2
    exit 1
  fi
fi
compose ps
echo 'Update complete. Refresh the browser or restart the installed Volna app.'
