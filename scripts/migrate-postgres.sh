#!/bin/sh
# One-time offline migration. Existing containers and SQLite files are retained.
set -eu
[ -f compose.yaml ] && [ -f .env ] || { echo 'Run from the existing Volna installation with its .env.' >&2; exit 1; }
umask 077
python3 - <<'PY'
from pathlib import Path
import re,secrets
p=Path('.env');s=p.read_text()
m=re.search(r'^POSTGRES_PASSWORD=(.*)$',s,re.M)
if m and m.group(1).strip():
 if not re.fullmatch(r'[a-fA-F0-9]{64}',m.group(1).strip()):
  raise SystemExit('POSTGRES_PASSWORD must be 64 hexadecimal characters; see POSTGRESQL.md.')
else:
 line='POSTGRES_PASSWORD='+secrets.token_hex(32)
 s=re.sub(r'^POSTGRES_PASSWORD=.*$',line,s,flags=re.M) if m else s.rstrip()+'\n'+line+'\n'
 p.write_text(s);p.chmod(0o600)
PY
compose() {
 set -- "$@"
 if [ "${VOLNA_BUILD_NETWORK:-default}" = host ]; then set -- -f compose.build-host.yaml "$@"; fi
 if grep -Eq '^[[:space:]]*CHAT_DOMAIN[[:space:]]*=[[:space:]]*[^[:space:]#]+' .env; then set -- -f compose.https.yaml "$@"; fi
 docker compose -f compose.yaml "$@"
}
compose config --quiet
compose build server
# Backup while the original SQLite server is still available for an automatic restart.
sh scripts/backup.sh
compose stop server
# On failure leave writes stopped. Do not automatically restart against a different DB.
trap 'echo "Migration did not complete. SQLite and the backup are retained; server remains stopped. See POSTGRESQL.md." >&2' EXIT
compose up -d --wait --wait-timeout 120 postgres
compose run --rm --no-deps -T --entrypoint node server scripts/migrate-postgres.mjs /data/volna.db
compose up -d --no-deps --wait --wait-timeout 120 server
trap - EXIT
echo 'PostgreSQL migration and API health checks completed. SQLite and uploads retained.'
echo 'No client rebuild is required. See POSTGRESQL.md for backup and restore.'
