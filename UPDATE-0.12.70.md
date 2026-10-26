# VLN 0.12.70 — анимированные эмодзи Web/Windows

Одиночный стандартный эмодзи без вложения, подписи пересылки, ответа или пользовательского emoji-entity отображается как локальная векторная анимация. Она проигрывается один раз при появлении в видимой области и повторно по нажатию, Enter или пробелу. Размер 96 px и время под эмодзи сохранены.

Включены 599 исходных TGS из указанного датасета Hugging Face: 580 уникальных Unicode-последовательностей после объединения повторов и вариантов U+FE0F. Сопоставление использует первое вхождение. Неподдерживаемые эмодзи и ошибки загрузки оставляют обычную графику Telegram. Смешанный текст, ввод и реакции сохраняют статическое отображение. Текст сообщения и копирование остаются Unicode.

Файлы включены в клиент (около 17 MB), внешний доступ к Hugging Face при использовании не нужен. Плеер и данные загружаются только для видимых эмодзи; вне экрана и в скрытой вкладке воспроизведение приостанавливается. Энергосбережение, отключение анимаций и системное уменьшение движения отключают автоматическое воспроизведение; явное нажатие запускает анимацию.

Функциональные изменения касаются Web и Windows. В Android изменены только versionName/versionCode на 0.12.70 / 12070: скрипты публикации требуют согласованных версий всех клиентов. Синхронизированные эффекты нажатия между собеседниками и звуки не добавлены.

Из прежней папки сервера с `compose.yaml` и существующим `.env`, одной вставкой:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.70 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.70-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; sh scripts/build-clients.sh )
```

Команда скачивает закреплённый тег `v0.12.70`, создаёт резервную копию данных, сохраняет прежние исходники Android в `backups/`, обновляет исходники и запускает прежний общий сборщик Android/Windows и Web. Существующий `.env`, база, аккаунты, переписки и ключ подписи Android сохраняются. Сборка использует настроенные на сервере домен и параметры подключения.

После сборки установите Android/Windows поверх прежней версии; Web перезагрузите (`Ctrl+F5`). Проверьте сообщение из одного эмодзи: анимация проигрывается один раз и повторяется по нажатию. Исходные TGS уже в репозитории; `python3 scripts/prepare-animated-emoji.py` нужен только для воспроизведения импорта из закреплённой ревизии.

Проверки: `npm test`, `npm run test:render`, `npm run build --prefix client`, `node tests/animated-emoji-ui.mjs`, `node tests/telegram-emoji-ui.mjs`. Windows-интерфейс проверяется в Chromium с desktop bridge; готовый Windows EXE в этой среде не запускался.
