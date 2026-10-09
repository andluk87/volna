# Волна 0.11.41 — исправление Android-сборки

В присланном журнале первая ошибка — `Unresolved reference detectTapGestures` в NativeExpressionPanel.kt. Исправлены импорт функции расширения и её вызов внутри pointerInput. Ошибки awaitRelease и корутин возникли при разборе этого вызова. Android versionName 0.11.41, versionCode 11041; Web/API/Windows также 0.11.41.

Полный архив сохраняет весь проект 0.11.40: Android, Windows, Web/API, распознавание, оба Docker-сборщика, панель эмодзи/стикеров/GIF и оформление.

## Обновление

Распакуйте поверх существующего проекта, сохраняя `.env`, тома Docker и весь `artifacts` с кэшами и ключом подписи:

```sh
cd ~
unzip -o volna-messenger-0.11.41.zip -d .
cd volna-messenger
VOLNA_BUILD_NETWORK=host sh scripts/build-android.sh
```

Noto/Unicode/CLDR уже успешно скачаны в вашем журнале, поэтому удалять их или очищать кэш не требуется. Режим auto сначала использует сохранённые Gradle-зависимости. Для Android и Windows вместе:

```sh
VOLNA_BUILD_NETWORK=host sh scripts/build-clients.sh
```

После успешной сборки ожидается `Verified compiled Android version: Volna 0.11.41 (11041).` Скрипт публикует APK и обновляет сервер/Web. Затем установите предложенное обновление Android поверх прежнего приложения. Windows отдельно можно собрать `VOLNA_BUILD_NETWORK=host sh scripts/build-windows.sh`.

## Проверка и границы

Новый APK здесь не компилировался: нет Android SDK/Docker. Исправление относится к конкретной ошибке Kotlin из вашего журнала. Доступные проверки и результаты приведены в VALIDATION.md. Компиляцию и Android JVM-тесты запускает Docker-сборщик перед публикацией. Возможные новые ошибки следующего этапа нужно оценивать по следующему журналу, а не считать сборку заранее подтверждённой.

Описание функций и оставшихся пунктов ТЗ: ANDROID-EXPRESSIONS-THEMES-0.11.40.md; расширенная инструкция: UPDATE-0.11.40.md (команды используйте с текущим архивом 0.11.41).
