"""Inspect resolved Compose settings without printing credentials."""
import json
import re
import sys

try:
    config = json.load(sys.stdin)
    environment = config["services"]["server"]["environment"]
    host = str(environment.get("TURN_HOST") or "").strip()
    secret = str(environment.get("TURN_SECRET") or "").strip()
except (ValueError, KeyError, TypeError, AttributeError):
    raise SystemExit("Не удалось прочитать настройки TURN из Docker Compose.")

if bool(host) != bool(secret):
    raise SystemExit("TURN настроен частично. Выполните sh scripts/enable-calls.sh или sh scripts/build-android.sh --enable-calls.")
if host:
    if not re.fullmatch(r"[a-zA-Z0-9.-]+", host):
        raise SystemExit("TURN_HOST должен быть доменом или IPv4 без https:// и пути.")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", secret):
        raise SystemExit("Некорректный TURN_SECRET. Выполните sh scripts/enable-calls.sh; существующий секрет не будет заменён молча.")
print("1" if host else "0")
