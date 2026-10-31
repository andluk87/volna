# Волна 0.12.95 — приглашения внутри Android, Windows и Web

Добавлена регистрация `volna://invite/<код>` в установщике Windows. Приглашение открывается и при закрытом приложении, и в уже запущенном клиенте; ссылка внутри клиента обрабатывается в нём. Если нужен вход по QR, приглашение сохраняется в памяти до завершения входа. Вступление требует нажатия «Вступить».

В браузере Windows появилась кнопка «Открыть в Волне», скачивание Windows-установщика и возможность продолжить в браузере. Авторизованный в браузере пользователь также видит кнопку открытия приложения в диалоге приглашения. Принимаются только корректные коды и HTTPS-приглашения настроенного сервера; внешние сайты не получают доступ к IPC.

## Обновление одной вставкой

В существующем каталоге проекта с `.env`:

```sh
( set -eu; test -f compose.yaml && test -f .env; volna_update_dir=$(mktemp -d); trap 'rm -rf "$volna_update_dir"' EXIT; git clone --depth 1 --branch v0.12.95 https://github.com/andluk87/volna.git "$volna_update_dir/source"; git -C "$volna_update_dir/source" archive --output="$volna_update_dir/source.tar" HEAD; sh "$volna_update_dir/source/scripts/backup.sh"; if [ -d android-native/app/src ]; then mkdir -p backups; volna_source_backup=$(mktemp -d "$PWD/backups/android-source-0.12.95-XXXXXXXX"); mv android-native/app/src "$volna_source_backup/src"; fi; tar -xf "$volna_update_dir/source.tar" -C .; VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh )
```

Обновите Web и Android до 0.12.95. Установите Windows 0.12.95 поверх текущей версии: установщик зарегистрирует обработчик ссылок. При первом открытии браузер может запросить подтверждение запуска VLN. Данные и аккаунты сохраняются. В Android ссылки-приглашения в тексте сообщения также направляются явно в приложение без браузера. В Web приглашение своего сервера открывается в текущем интерфейсе без новой вкладки. Остальные функции предыдущего выпуска сохранены.

Проверки: 234 Node-теста, браузерные сценарии Android/Windows/Linux, имитация IPC Electron с проверкой ожидания входа и повторного приглашения, открытие ссылки внутри текущего интерфейса, production-сборки Web и Windows renderer, сборка APK 12095 и целевые Android unit/UI тесты; отдельный тест подтверждает явный Intent в MainActivity при нажатии на приглашение в сообщении. Реальная установка и системный запуск протокола Windows в этой Linux-среде не проверялись.
