# VLN 0.12.83 — Android: шрифт и размеры пузырей

Карточки звонков шире и ниже, «Пропущенный звонок» помещается в одну строку при стандартном масштабе на телефоне из референса. Обычные сообщения используют более компактный шрифт и межстрочный интервал; длинным сообщениям доступно больше ширины, короткие остаются узкими. Скругления и промежутки приближены к присланному скриншоту Telegram.

Из прежней папки сервера с `compose.yaml` и `.env`, одной вставкой:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.83 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.83-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; sh scripts/build-clients.sh )
```

После сборки установите Android через `Настройки → Обновления`. Данные и ключ подписи сохраняются. Доработка размеров относится к Android.

Проверка: сравните пропущенные, входящие и отменённые звонки, короткое «Спасибо», длинный текст и список покупок. Проверьте также увеличенный размер текста: переносы допускаются, обрезки быть не должно. Настройки масштаба интерфейса, размера текста и шрифта сохраняются, поэтому они влияют на фактический вид. Физический телефон здесь недоступен для проверки.

Проверено: 193 Android unit/UI-теста, включая ширину/высоту карточки, одну строку заголовка на экране 393 dp и отсутствие обрезки при увеличенном тексте на узком экране. Собран APK со всеми четырьмя ABI, ниже лимита обновления 120 МиБ.
