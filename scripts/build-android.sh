#!/bin/sh
# Build the Android APK, publish it, then update Volna.
set -eu
cd "$(dirname "$0")/.."
enable_calls=0
case "${1:-}" in
  '') [ "$#" -eq 0 ] || { echo 'Usage: sh scripts/build-android.sh [--enable-calls]' >&2; exit 1; } ;;
  --enable-calls) [ "$#" -eq 1 ] || { echo 'Usage: sh scripts/build-android.sh [--enable-calls]' >&2; exit 1; }; enable_calls=1 ;;
  *) echo 'Usage: sh scripts/build-android.sh [--enable-calls]' >&2; exit 1 ;;
esac
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is required to build the Android APK.' >&2
  exit 1
fi
if [ ! -f compose.yaml ] || [ ! -f .env ]; then
  echo 'Run from the project with compose.yaml and the existing .env file.' >&2
  exit 1
fi
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
if [ "$enable_calls" -eq 1 ]; then python3 scripts/configure-calls.py; fi
mkdir -p artifacts client/public/download
compose config --quiet
compose run --build --rm android-builder
apk=artifacts/Volna-debug.apk
if [ ! -s "$apk" ]; then
  echo "Android builder did not produce $apk." >&2
  exit 1
fi
python3 - "$apk" <<'PY'
import hashlib, json, re, sys, zipfile
from pathlib import Path
if not zipfile.is_zipfile(sys.argv[1]):
    raise SystemExit('The Android builder output is not a valid APK/ZIP file.')
gradle = Path('android-native/app/build.gradle.kts').read_text()
code = re.search(r'val\s+volnaVersionCode\s*=\s*([0-9_]+)', gradle)
name = re.search(r'val\s+volnaVersionName\s*=\s*"([^"]+)"', gradle)
if not code or not name:
    raise SystemExit('Cannot read Android versionCode/versionName from Gradle.')
apk = Path(sys.argv[1])
manifest = {
    'version_code': int(code.group(1).replace('_', '')),
    'version_name': name.group(1),
    'apk_path': '/download/volna-android.apk',
    'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
}
Path('client/public/download/volna-android-version.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
PY
# Whitelist the verified hash of the APK built with this installation's signing key.
# Preserve older signing certificates until their installed APKs are retired.
python3 - <<'PYHASH'
import re
from pathlib import Path
value = Path('artifacts/Volna-sms-app-hash.txt').read_text().strip()
if not re.fullmatch(r'[A-Za-z0-9+/]{11}', value):
    raise SystemExit('Missing or invalid verified SMS Retriever hash.')
p = Path('.env')
s = p.read_text()
entries = re.findall(r'^ANDROID_SMS_APP_HASHES=(.*)$', s, re.M)
hashes = [h.strip() for entry in entries for h in entry.strip().strip('"').strip("'").split(',') if re.fullmatch(r'[A-Za-z0-9+/]{11}', h.strip())]
if value not in hashes:
    hashes.append(value)
s = re.sub(r'^ANDROID_SMS_APP_HASHES=.*\n?', '', s, flags=re.M)
p.write_text(s.rstrip() + '\nANDROID_SMS_APP_HASHES=' + ','.join(dict.fromkeys(hashes)) + '\n')
PYHASH
install -m 0644 "$apk" client/public/download/volna-android.apk
if [ "${VOLNA_BUILD_PUBLISH_ONLY:-0}" = 1 ]; then exit 0; fi
sh scripts/update.sh
if [ "$enable_calls" -eq 1 ] && command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 3478/tcp
  ufw allow 3478/udp
  ufw allow 49160:49200/udp
fi
docker compose exec -T web sh -ec 'test -s /usr/share/nginx/html/download/volna-android.apk && wget -q -O /dev/null http://127.0.0.1/download/volna-android.apk'
version_name=$(python3 -c 'import json; print(json.load(open("client/public/download/volna-android-version.json"))["version_name"])')
docker compose exec -T web sh -ec 'wget -q -O /tmp/volna-update.json http://127.0.0.1/download/volna-android-version.json && grep -F "$1" /tmp/volna-update.json >/dev/null' sh "$version_name"
echo 'Verified Android download and update manifest.'
if [ "$enable_calls" -eq 1 ]; then
  echo 'TURN enabled. In the VPS provider firewall allow TCP/UDP 3478 and UDP 49160-49200.'
fi
