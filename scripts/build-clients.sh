#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
case "${1:-}" in
 '') [ "$#" -eq 0 ] || { echo 'Usage: sh scripts/build-clients.sh [--enable-calls]' >&2; exit 1; } ;;
 --enable-calls) [ "$#" -eq 1 ] || { echo 'Usage: sh scripts/build-clients.sh [--enable-calls]' >&2; exit 1; } ;;
 *) echo 'Usage: sh scripts/build-clients.sh [--enable-calls]' >&2; exit 1 ;;
esac
VOLNA_BUILD_PUBLISH_ONLY=1 sh scripts/build-android.sh "$@"
VOLNA_BUILD_PUBLISH_ONLY=1 sh scripts/build-windows.sh
sh scripts/update.sh
sh scripts/check-downloads.sh all
echo 'Android and Windows clients published; Volna services updated once.'
