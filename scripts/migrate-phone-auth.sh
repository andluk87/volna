#!/bin/sh
# One-time, explicitly requested replacement of the old account database.
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo 'Keep the existing .env and add the Notificore configuration first.' >&2; exit 1; }
compose() {
  if [ "${VOLNA_BUILD_NETWORK:-default}" = host ]; then docker compose -f compose.yaml -f compose.build-host.yaml "$@";
  else docker compose "$@"; fi
}
# External backup is completed before reset. Failure aborts the entire operation.
sh scripts/backup.sh
compose build server
compose stop server
compose run --rm --no-deps -T --entrypoint node server server/reset-phone-auth.mjs --reset-legacy
# New service is started by update.sh/build-clients.sh after the clients are built.
echo 'Phone-auth migration prepared. Build clients and update services next.'
