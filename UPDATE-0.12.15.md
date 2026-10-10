# Обновление Волны до 0.12.15

Новый SMS-вход требует обновления **сервера и Android APK**. Обновление только контейнера не изменит интерфейс уже установленного приложения. Windows и Web продолжают работать.

Выполните блок целиком в прежнем каталоге установки с `compose.yaml` и `.env`. Создаётся резервная копия данных; `.env`, APK signing key и данные сохраняются. Локальные изменения исходников заменяются версией GitHub. Сборка использует `VITE_API_URL` из существующего `.env` — HTTPS-адрес вашей Волны.

```sh
(
  set -eu
  test -f compose.yaml && test -f .env
  volna_update_dir=$(mktemp -d)
  trap 'rm -rf "$volna_update_dir"' EXIT
  git clone --depth 1 --branch v0.12.15 \
    https://github.com/andluk87/volna.git "$volna_update_dir/source"
  git -C "$volna_update_dir/source" archive \
    --output="$volna_update_dir/source.tar" HEAD
  sh "$volna_update_dir/source/scripts/backup.sh"
  tar -xf "$volna_update_dir/source.tar" -C .
  VOLNA_BUILD_NETWORK=host VOLNA_BUILD_PUBLISH_ONLY=1 sh scripts/build-android.sh
  VOLNA_BUILD_NETWORK=host sh scripts/update.sh
)
```

Первая Android-сборка с новыми зависимостями может занять несколько минут. APK размещается на `https://ВАШ_CHAT_DOMAIN/download/volna-android.apk`. Установите его на телефон поверх прежнего APK или используйте проверку обновлений в приложении.

Хеш подписи для SMS Retriever вычисляется из собранного APK автоматически, добавляется в `ANDROID_SMS_APP_HASHES` вашего `.env` и применяется к серверу при обновлении. Выбранный SMS-провайдер и его реквизиты сохраняются; доступны Notificore и HTTP-шлюз. Старые APK продолжают входить по прежнему SMS-коду до установки обновления.

Не удаляйте `artifacts/android-home`: для обновления приложения нужна прежняя подпись. Не используйте пример хеша из ТЗ. Для собственной release/Play подписи следуйте [инструкции Android SMS](ANDROID-SMS.md).

После установки проверьте один вход на реальном телефоне с Google Play services: SMS содержит код, метку попытки и хеш; код заполняется и проверяется автоматически. Без Google Play services доступен ручной ввод. Доставка SMS и реальное событие Retriever требуют проверки на вашем телефоне; в облачной среде реальные SMS не отправляются.

Проверки выпуска: 112 серверных тестов, 36 Android unit-тестов, сборка подписанного APK 0.12.15, проверка сертификата/хеша/версии, браузерные проверки панели и production-сборка Web. Реальные SMS не отправлялись; проверка на физическом телефоне описана в [ANDROID-SMS.md](ANDROID-SMS.md).
