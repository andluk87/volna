# VLN 0.12.68 — геометрия одиночных эмодзи

Windows/Web: время и галочки под эмодзи, у правого края, без дополнительного столбца справа. Эмодзи занимает 96 CSS px (видимая графика около 88 px); отступы не зависят от длины времени. Android: тот же размер 96 sp, без бокового отступа пузыря, метаданные снизу. Обычные сообщения сохраняют прежний размер. Это статическая графика Telegram, а не анимированные одиночные эмодзи Telegram.

Из прежней папки сервера с compose.yaml и .env:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.68 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.68-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; sh scripts/build-clients.sh )
```

После сборки установите Android/Windows поверх прежней версии; Web перезагрузите.

Проверено: сборка Android, 129 Android-тестов, Web production build, сценарии Web/Windows в Chromium (одиночный эмодзи, смешанный текст, наведение, закрепление, вкладки, поиск, копирование и отправка Unicode). Windows-установщик в Linux не запускался.
