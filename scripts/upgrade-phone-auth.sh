#!/bin/sh
# Breaking upgrade: builds clients first, backs up and replaces legacy accounts, then starts new services.
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo 'Missing .env. Add NOTIFICORE_API_KEY and NOTIFICORE_ORIGINATOR first.' >&2; exit 1; }
docker compose config --format json | python3 -c 'import json,sys; e=json.load(sys.stdin)["services"]["server"].get("environment",{}); sys.exit(0 if e.get("NOTIFICORE_API_KEY") and e.get("NOTIFICORE_ORIGINATOR") else "Configure NOTIFICORE_API_KEY and NOTIFICORE_ORIGINATOR before upgrading.")'
# Obsolete authentication sources are not carried into the rebuilt images.
rm -f server/telegram-auth.mjs server/telegram-http.mjs server/passwords.mjs server/check-telegram-jwks.mjs client/src/PasswordDialog.jsx client/src/telegram-login.mjs
VOLNA_BUILD_PUBLISH_ONLY=1 sh scripts/build-android.sh
VOLNA_BUILD_PUBLISH_ONLY=1 sh scripts/build-windows.sh
sh scripts/migrate-phone-auth.sh
sh scripts/update.sh
sh scripts/check-downloads.sh all
