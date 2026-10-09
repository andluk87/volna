#!/bin/sh
# Run once on the Linux VPS from the existing project directory.
set -eu
[ -f .env ] && [ -f compose.yaml ] || { echo 'Запустите из папки проекта с .env и compose.yaml' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Нужен Python 3: sudo apt-get install python3' >&2; exit 1; }
python3 scripts/configure-calls.py
# Reuse the regular build + backup process.
sh scripts/update.sh
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 3478/tcp
  ufw allow 3478/udp
  ufw allow 49160:49200/udp
fi
echo 'Звонки настроены. В firewall панели VPS разрешите TCP/UDP 3478 и UDP 49160–49200.'
echo 'Откройте Волну на двух устройствах, разрешите микрофон и нажмите телефон в личном чате.'
echo 'Проверка TURN: docker compose --profile calls logs --tail=60 turn'
