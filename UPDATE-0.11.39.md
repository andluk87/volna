# Волна 0.11.39 — исправление сборки Android

В присланном логе компилятор Kotlin сообщает о двух неизвестных символах. В этом выпуске:

- В `MainActivity.kt` добавлен импорт `androidx.compose.material3.LinearProgressIndicator` для индикатора отправки голосового.
- В `NativeHome.kt` иконка `Icons.Outlined.AddCall` заменена на используемую в проекте `Icons.Outlined.Call`.
- Версии API, Web, Windows и Android в исходниках согласованы: 0.11.39; Android versionCode — 11039. Все функции переработки Android 0.11.38 и Docker-сборщики сохранены.

## Повторить сборку Android

Поместите архив рядом с существующим проектом и распакуйте поверх него:

```sh
cd ~
unzip -o volna-messenger-0.11.39.zip -d .
cd volna-messenger
VOLNA_BUILD_NETWORK=host sh scripts/build-android.sh
```

Сохраняйте существующие `.env` и весь каталог `artifacts`, включая ключ подписи Android в `artifacts/android-home`, SDK и Gradle-кеш. Кеш Docker очищать не требуется. Архив не содержит базу, секреты или старые APK/EXE и не заменяет их при распаковке. Режим сети `host` предназначен для Linux VPS; если обычная сеть Docker работает, можно выполнить `sh scripts/build-android.sh`.

Скрипт запускает компиляцию и JVM-тесты Android в Docker, публикует APK и манифест обновления, затем обновляет сервер/Web. При неудачной сборке APK публикация и обновление сервисов не продолжаются. Повторная сборка Windows для исправления этих двух ошибок Android не требуется.

После успешной сборки новый APK доступен по адресу:

`https://volna.lknet.ru/download/volna-android.apk`

Проверка опубликованной версии:

```sh
curl -fsS https://volna.lknet.ru/download/volna-android-version.json
```

Ожидаются `version_name: 0.11.39` и `version_code: 11039`. Установите APK поверх предыдущего приложения или подтвердите обновление внутри Волны. Пересборка сервера сама по себе не меняет установленное Android-приложение.

## Если нужны оба клиента

В архив включён весь проект: Android, Windows, Web/API, распознавание, обновления и оба Docker-сборщика. Для выпуска обоих клиентов:

```sh
VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
```

Windows отдельно: `VOLNA_BUILD_NETWORK=host sh scripts/build-windows.sh`. Клиенты собираются последовательно; общий скрипт обновляет сервисы один раз после успешной публикации обоих.

## Проверки и границы

Проходят 86 Node-тестов, включая проверки исходного Android-клиента, согласованности версий и скриптов публикации. Новых зависимостей для исправления не добавлено. В этой среде нет Docker и Android SDK, поэтому успешная компиляция нового APK здесь не заявляется; её выполняет ваш Docker-сборщик. Предупреждение о deprecated Gradle features не является причиной показанного сбоя — остановка произошла из-за двух ошибок Kotlin.

Описание переработанного интерфейса и сценарии телефона: [UPDATE-0.11.38.md](UPDATE-0.11.38.md). Состояние ТЗ: [ANDROID-REDESIGN-0.11.38.md](ANDROID-REDESIGN-0.11.38.md). Результаты проверок: [VALIDATION.md](VALIDATION.md).
