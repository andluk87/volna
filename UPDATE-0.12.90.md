# VLN 0.12.90 — качество расшифровки голосовых

Стандартный локальный профиль Whisper изменён с `base / beam=1` на `small / beam=5`. Добавлена кнопка **«Распознать заново»** под раскрытым текстом голосового в Android, Web и Windows. Она запускает новую расшифровку вместо возврата старого сохранённого результата. При ошибке прежний текст сохраняется.

Из прежней папки проекта с `compose.yaml` и `.env`, одной вставкой:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.90 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.90-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; python3 scripts/improve-transcription.py; VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh )
```

Команда переводит старый быстрый профиль в `.env` на новый и сохраняет отдельную приватную копию настроек в `backups/`. Пользовательские модели (`medium`, `large-v3` и т. п.), язык и остальные параметры не заменяются. Если ваша модель уже была более крупной, она сохраняется.

После сборки обновите Android и Windows до 0.12.90; в Web перезагрузите страницу. Новая модель при первом запуске скачает веса в существующий volume. Нужен доступ контейнера к хранилищу моделей, дополнительное место и больше ресурсов CPU/RAM; распознавание может стать медленнее. Пока `ready:false`, дождитесь загрузки. Данные и старые результаты не удаляются.

Откройте голосовое → «А» → «Распознать заново». Без этой кнопки старый текст остаётся в кэше и сам не меняется. [Проверка модели и подробности](docs/TRANSCRIPTION-QUALITY.md).

Проверены 229 Node-тестов, 208 Android-тестов, 9 Python HTTP/runtime-тестов с тестовой моделью, серверные права и повторная расшифровка, миграция `.env`, клиентские интерфейсы и сборки. Реальная точность на ваших записях пока не измерена: для оценки нужны проблемные аудио и эталонный текст. Новые настройки дают модели больше возможностей, но не гарантируют безошибочную речь.
