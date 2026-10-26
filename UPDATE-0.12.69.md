# VLN 0.12.69 — эмодзи внутри текста

Встроенные эмодзи в смешанном тексте увеличены до 1.25 размера букв и выровнены относительно строки. Размер букв, времени и галочек не меняется. Windows/Web: сообщения и поле ввода; Android: текстовые сообщения, ввод и подписи. Одиночные крупные эмодзи сохраняют прежний размер. Unicode и копирование сохраняются.

Из прежней папки сервера с compose.yaml и .env:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.69 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.69-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; sh scripts/build-clients.sh )
```

После сборки установите Android/Windows поверх прежней версии; Web перезагрузите.

Проверено: сборка Android, 129 Android-тестов, Web production build, сценарии Web/Windows в Chromium (одиночный эмодзи, смешанный текст, наведение, закрепление, вкладки, поиск, копирование и отправка Unicode). Windows-установщик в Linux не запускался.
