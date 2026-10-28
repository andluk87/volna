# VLN 0.12.82 — ответ с цитатой

В Windows/Web выделите фрагмент текста сообщения и откройте меню правой кнопкой: «Ответить с цитатой». Над полем ввода показываются автор и выбранный фрагмент. Нажмите на эту полосу, чтобы открыть «Изменение цитаты», выделить другой фрагмент, перейти к оригиналу, убрать ответ или ответить в другом чате. Цитата ограничена 1024 символами.

Из прежней папки сервера с `compose.yaml` и `.env`, одной вставкой:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.82 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.82-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; sh scripts/build-clients.sh )
```

Обновите Windows поверх прежней версии, перезагрузите Web и установите Android через `Настройки → Обновления`. Данные и ключ подписи сохраняются.

Создание и изменение выделенной цитаты в этом выпуске доступны в Windows/Web. Android показывает сохранённый фрагмент в полученном ответе; обычный ответ в Android сохранён.

Проверка: выделите «Туалетная бумага» в списке, выберите «Ответить с цитатой», отправьте текст. В ответе должен быть только этот фрагмент, а не весь список. Повторите изменение цитаты, отмену и перенос в другой чат. Получатель другого чата не должен получать доступ к исходной переписке.

Проверено: 214 Node-тестов, браузерный сценарий Chromium с выделением, изменением, отменой и переносом цитаты; render-тесты React, сборки Web и интерфейса Windows. Android: 190 unit/UI-тестов, включая сохранение цитаты в кеше и переходы; APK ~103 МиБ со всеми четырьмя ABI, ниже лимита 120 МиБ. Нативный Windows EXE и физический телефон здесь не запускались.
