#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
[ "$#" -eq 0 ] || { echo 'Usage: sh scripts/build-windows.sh' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo 'Docker is required to build the Windows installer.' >&2; exit 1; }
[ -f compose.yaml ] && [ -f .env ] || { echo 'Run from the project with compose.yaml and the existing .env file.' >&2; exit 1; }
case "${VOLNA_BUILD_NETWORK:-default}" in
  default) ;;
  host) [ -f compose.build-host.yaml ] || { echo 'Missing compose.build-host.yaml.' >&2; exit 1; } ;;
  *) echo 'VOLNA_BUILD_NETWORK must be default or host.' >&2; exit 1 ;;
esac
compose() {
  if [ "${VOLNA_BUILD_NETWORK:-default}" = host ]; then
    docker compose -f compose.yaml -f compose.build-host.yaml --profile build "$@"
  else
    docker compose --profile build "$@"
  fi
}
mkdir -p artifacts/windows-release client/public/download
python3 scripts/check-windows-space.py
compose config --quiet
compose run --build --rm windows-builder
python3 scripts/publish-windows.py
if [ "${VOLNA_BUILD_PUBLISH_ONLY:-0}" = 1 ]; then exit 0; fi
sh scripts/update.sh
sh scripts/check-downloads.sh windows
echo 'Windows client and in-app updates published. Download: /download/volna-windows.exe'
