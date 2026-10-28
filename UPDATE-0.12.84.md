# VLN 0.12.84 — Windows: исправлено выделение фрагмента

В сообщениях Windows/Web выделение мышью сбрасывалось при обычном обновлении интерфейса. Устранено пересоздание DOM узлов форматированного текста. Выделение теперь остаётся на месте; по правой кнопке доступно «Ответить с цитатой».

Из прежней папки сервера с `compose.yaml` и `.env`, одной вставкой:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.84 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.84-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; sh scripts/build-clients.sh )
```

После сборки установите Windows-клиент поверх прежней версии и полностью перезапустите VLN через выход из приложения в трее. Web перезагрузите через Ctrl+F5. Данные и вход сохраняются.

Проверка: выделите мышью строку «Туалетная бумага», подождите несколько секунд, нажмите правой кнопкой внутри выделения и выберите «Ответить с цитатой». Фрагмент не должен исчезать после обновлений интерфейса. Проверьте также полужирный текст и раскрытый спойлер.

Проблема воспроизведена в Chromium до исправления и устранена после него. Проверяется настоящий компонент MessageText с перетаскиванием мыши и обновлениями каждые 100 мс. Нативный Windows EXE в этой среде не запускался.

Проверено: 214 Node-тестов, render-тесты React и браузерный сценарий с настоящим MessageText, выделением мышью и обновлениями родителя. Собраны Web и интерфейс Windows.
