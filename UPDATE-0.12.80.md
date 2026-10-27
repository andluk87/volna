# VLN 0.12.80 — вибрация приоритетных звонков

Android: приоритетные звонки теперь сопровождаются повторяющейся вибрацией, включая беззвучный режим и звонки другого аккаунта. «Не беспокоить» и запрет уведомлений сохраняются. Вибрация останавливается при ответе, отклонении или завершении звонка.

Из прежней папки сервера с `compose.yaml` и `.env`, одной вставкой:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.80 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.80-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; sh scripts/build-clients.sh )
```

После сборки установите Android-обновление через `Настройки → Обновления`. Данные и ключ подписи сохраняются.

Проверка на телефоне: включите «Приоритетные звонки» в профиле контакта, включите беззвучный режим и получите звонок. Должны работать мелодия и повторяющаяся вибрация; после ответа или отклонения вибрация прекращается. Повторите для второго аккаунта. В режиме «Не беспокоить» приоритетный звонок не включает принудительную вибрацию.

Физическую вибрацию на телефоне здесь проверить нельзя; автоматические проверки выполняются в Android/Robolectric.

Проверено: 188 Android unit/UI-тестов, включая вибрацию в беззвучном режиме, соблюдение «Не беспокоить» и независимую остановку вызовов.
