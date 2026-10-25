# VLN 0.12.62 — прежний вид Android

По просьбе пользователя восстановлен интерфейс Android до изменений 0.12.60:

- папки — горизонтальными вкладками над списком чатов;
- темы группы — прежними карточками с действиями;
- в переписке — прежние вкладки переключения тем и поведение кнопки «Назад»;
- редактор оформления папок — прежний, без боковой панели.

Сохранённая боковая панель автоматически отображается как горизонтальные вкладки. Её стандартные размеры заменяются прежними, подписи возвращаются. Пользовательские цвета, размер текста, содержимое папок и старые горизонтальные настройки не удаляются.

Исправления авторизации и сохранения сеансов из 0.12.61, быстрый QR-вход, приоритетные звонки и восстановление службы после установки сохранены. Windows не откатывается; для возврата вида Android переустановка Windows не нужна.

## Обновление одной командой

Выполните из прежней папки сервера с `compose.yaml`, действующим `.env` и каталогом `artifacts` с ключом подписи Android:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.62 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.62-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; sh scripts/build-android.sh )
```

Команда делает резервную копию, сохраняет прежние Android-исходники в `backups/android-source-0.12.62-XXXXXXXX/src`, собирает и публикует APK, затем обновляет сервер/Web. Данные, настройки и ключ подписи остаются на месте. После завершения установите **Android 0.12.62 (12062)** поверх прежней версии.

## Проверка

Локально прошла сборка APK и полный набор из 120 JVM/UI-тестов Android, включая миграцию оформления и прежний горизонтальный интерфейс. Проверка на реальном телефоне остаётся необходимой.
