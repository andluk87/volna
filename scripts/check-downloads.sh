#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
case "${1:-all}" in
 android|all) docker compose exec -T web sh -ec 'test -s /usr/share/nginx/html/download/volna-android.apk && wget -q -O /dev/null http://127.0.0.1/download/volna-android.apk && wget -q -O /dev/null http://127.0.0.1/download/volna-android-version.json' ;;
esac
case "${1:-all}" in
 windows|all)
 version=$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')
 docker compose exec -T web sh -ec 'test -s /usr/share/nginx/html/download/volna-windows.exe && wget -q -O /dev/null http://127.0.0.1/download/volna-windows.exe && wget -q -O /tmp/volna-windows-update.yml http://127.0.0.1/download/windows/latest.yml && grep -F "version: $1" /tmp/volna-windows-update.yml >/dev/null && test -s "/usr/share/nginx/html/download/windows/Volna-Setup-$1.exe"' sh "$version"
 echo 'Verified Windows download and update feed.' ;;
esac
