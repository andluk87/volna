# Полный выпуск Волны 0.11.37

Архив `volna-messenger-0.11.37.zip` содержит весь исходный проект: сервер/API, Web, нативный Android на Kotlin/Compose, Windows на Electron, Docker-сборщики, встроенные обновления клиентов, исправление запуска Whisper и backup. Версии согласованы: Web/Windows/API 0.11.37, Android versionName 0.11.37 и versionCode 11037.

## Обновление на вашем VPS

Загрузите архив в домашний каталог рядом с действующим `volna-messenger`. Распакуйте поверх проекта, сохранив существующие `.env` и `artifacts`:

```sh
cd ~
unzip -o volna-messenger-0.11.37.zip -d .
cd volna-messenger
VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
```

Скрипт последовательно собирает Android и Windows в Docker, проверяет и публикует их файлы, затем один раз обновляет сервер, Web и сервис распознавания. При ошибке любого клиента обновление сервисов не продолжается. Режим `host` подходит Linux VPS: сборочные шаги и контейнеры сборщиков используют сеть хоста. Если DNS работает в обычной сети Docker, доступна команда `sh scripts/build-clients.sh`.

Ключ подписи Android находится в `artifacts/android-home`; он необходим для установки поверх предыдущего APK и встроенного обновления. SDK/Gradle/npm/Electron/NSIS-кеши в `artifacts` сохраняются. `.env` с Telegram/TURN и адресом сервера архив не заменяет. Ограничения CPU сборщика не добавлены.

Если TURN уже настроен и звонки работают, используйте команду выше. Для первоначальной настройки звонков предусмотрено `VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh --enable-calls`.

## Где будут Android и Windows

После успешной сборки и публикации:

- Android APK: `https://volna.lknet.ru/download/volna-android.apk`.
- Android манифест обновления: `https://volna.lknet.ru/download/volna-android-version.json` — version_name 0.11.37, version_code 11037.
- Windows установщик: `https://volna.lknet.ru/download/volna-windows.exe`.
- Windows feed: `https://volna.lknet.ru/download/windows/latest.yml` — version 0.11.37.
- Версионный установщик: `/download/windows/Volna-Setup-0.11.37.exe`.

На странице входа остаются ссылки обоих клиентов. Установленные клиенты проверяют обновления через свои манифесты/feed. После публикации нового выпуска в приложении появляется обновление; пользователь подтверждает установку средствами Android/Windows. Android должен использовать прежний ключ подписи.

В архиве исходников нет готовых APK/EXE: эти файлы создаёт Docker на VPS. Здесь Docker отсутствует, поэтому сборка настоящих APK/EXE 0.11.37 не заявляется.

## Отдельные сборки

```sh
# Android и обновление сервисов
VOLNA_BUILD_NETWORK=host sh scripts/build-android.sh

# Windows и обновление сервисов
VOLNA_BUILD_NETWORK=host sh scripts/build-windows.sh

# Сервер/Web/распознавание
VOLNA_BUILD_NETWORK=host sh scripts/update.sh
```

Общую команду `build-clients.sh` используйте для выпуска обоих клиентов; запускать после неё отдельные сборки не требуется.

## Что исправлено

Whisper начинает загрузку в фоне и сначала проверяет полный локальный кеш. Ошибки загрузки повторяются через 60 секунд и видны в `/health`; `/ready` возвращает 503, пока модель не готова. Backup возвращает ранее работавшие серверные контейнеры без пересоздания из новых образов. Web отображает версию из client/package.json, чтобы номер интерфейса совпадал с выпуском.

Подробная диагностика модели: [TRANSCRIPTION-STARTUP-FIX.md](TRANSCRIPTION-STARTUP-FIX.md). Инструкции клиентов: [ANDROID-BUILD.md](ANDROID-BUILD.md), [WINDOWS-BUILD.md](WINDOWS-BUILD.md). Проверки и их ограничения: [VALIDATION.md](VALIDATION.md).
